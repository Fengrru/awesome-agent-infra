/**
 * Consistency-aware retrieval — five retrieval modes with status-based
 * filtering (Table 3, Section 4.5).
 *
 * The retrieval layer distinguishes "latest data" from "latest valid data,"
 * filtering out information whose causal ancestors have been revised.
 *
 * Modes:
 * - `LATEST_VALID`: exclude OBSOLETE + STALE (default safe retrieval).
 * - `CONSISTENT_ONLY`: only nodes with σ = VALID.
 * - `INCLUDE_STALE`: include STALE with warning metadata.
 * - `ALL_VERSIONS`: return latest regardless of status.
 * - `AT_TIME`: return versions valid at a given timestamp.
 *
 * Also supports live vector index validation: entries whose node version
 * has advanced since indexing are automatically skipped (Section 4.5).
 *
 * @module memory-graph/retrieval
 */

import type { MemoryGraph } from "./graph"
import type { MemoryNodeVersion, RetrievalConfig, RetrievalMode } from "./types"
import { ConsistencyStatus, DEFAULT_RETRIEVAL_CONFIG, RetrievalMode as RM } from "./types"

// ─── Result types ───────────────────────────────────────────────────────

/**
 * A single retrieval result with optional staleness warning.
 */
export interface RetrievalResult {
  node: MemoryNodeVersion
  /** Relevance score (0-1), based on token overlap with query. */
  relevance: number
  /** If mode is INCLUDE_STALE and node is STALE, this contains the warning. */
  warning?: string
}

// ─── Consistency-Aware Retriever ────────────────────────────────────────

export class ConsistencyRetriever {
  config: RetrievalConfig

  constructor(config?: Partial<RetrievalConfig>) {
    this.config = { ...DEFAULT_RETRIEVAL_CONFIG, ...config }
  }

  /**
   * Retrieve nodes from the graph using the specified retrieval mode.
   *
   * @param graph - The memory graph to query.
   * @param query - Optional search query for relevance scoring.
   * @param mode - Retrieval mode (defaults to config.defaultMode).
   * @param timestamp - Timestamp for AT_TIME mode.
   * @returns Array of retrieval results sorted by relevance descending.
   */
  retrieve(graph: MemoryGraph, query?: string, mode?: RetrievalMode, timestamp?: number): RetrievalResult[] {
    const effectiveMode = mode ?? this.config.defaultMode
    const allIds = graph.getAllNodeIds()
    const results: RetrievalResult[] = []

    for (const id of allIds) {
      const node = this.resolveNode(graph, id, effectiveMode, timestamp)
      if (!node) continue

      const passes = this.statusFilter(node, effectiveMode)
      if (!passes) continue

      const relevance = this.computeRelevance(query, node)
      const result: RetrievalResult = { node, relevance }

      if (effectiveMode === RM.INCLUDE_STALE && node.consistencyStatus === ConsistencyStatus.STALE) {
        result.warning = `Node '${id}' is STALE. Reasons: ${node.staleReasons.join("; ")}`
      }

      results.push(result)
    }

    // Sort by relevance descending
    results.sort((a, b) => b.relevance - a.relevance)

    return results.slice(0, this.config.topK)
  }

  /**
   * Validate a set of indexed entries against the current graph state.
   *
   * Useful for live vector index validation (Section 4.5): when the graph
   * is used alongside an external vector index, this method checks which
   * indexed entries are still valid (node version hasn't advanced since
   * indexing, and node isn't STALE/OBSOLETE).
   *
   * @param graph - The memory graph.
   * @param indexedEntries - Array of { nodeId, indexedVersion } pairs.
   * @returns Array of { nodeId, valid } — entries that pass validation.
   */
  validateIndex(
    graph: MemoryGraph,
    indexedEntries: { nodeId: string; indexedVersion: number }[],
  ): { nodeId: string; valid: boolean }[] {
    return indexedEntries.map((entry) => {
      const node = graph.getNode(entry.nodeId)
      if (!node) return { nodeId: entry.nodeId, valid: false }
      if (node.version > entry.indexedVersion) return { nodeId: entry.nodeId, valid: false }
      if (node.consistencyStatus !== ConsistencyStatus.VALID) return { nodeId: entry.nodeId, valid: false }
      return { nodeId: entry.nodeId, valid: true }
    })
  }

  // ── Private ───────────────────────────────────────────────────────

  /**
   * Resolve which version of a node to return based on the retrieval mode.
   */
  private resolveNode(
    graph: MemoryGraph,
    id: string,
    mode: RetrievalMode,
    timestamp?: number,
  ): MemoryNodeVersion | undefined {
    if (mode === RM.AT_TIME && timestamp !== undefined) {
      return graph.getNodeAtTime(id, timestamp)
    }
    return graph.getNode(id)
  }

  /**
   * Filter a node by consistency status based on the retrieval mode.
   */
  private statusFilter(node: MemoryNodeVersion, mode: RetrievalMode): boolean {
    switch (mode) {
      case RM.LATEST_VALID:
        // Exclude OBSOLETE + STALE + CONFLICT
        return !node.obsolete && node.consistencyStatus === ConsistencyStatus.VALID

      case RM.CONSISTENT_ONLY:
        // Only σ = VALID (also exclude OBSOLETE)
        return !node.obsolete && node.consistencyStatus === ConsistencyStatus.VALID

      case RM.INCLUDE_STALE:
        // Include STALE with warning, exclude OBSOLETE
        return !node.obsolete

      case RM.ALL_VERSIONS:
        // Return latest regardless of status, exclude OBSOLETE
        return !node.obsolete

      case RM.AT_TIME:
        // Historical snapshot — return as-is
        return true

      default:
        return !node.obsolete && node.consistencyStatus === ConsistencyStatus.VALID
    }
  }

  /**
   * Compute relevance score via token overlap (Jaccard-like).
   *
   * If query is empty, returns 1.0 (no filtering).
   */
  private computeRelevance(query: string | undefined, node: MemoryNodeVersion): number {
    if (!query || query.trim().length === 0) return 1.0

    const contentStr = JSON.stringify(node.content).toLowerCase()
    const queryTokens = this.tokenize(query)
    const contentTokens = new Set(this.tokenize(contentStr))

    if (queryTokens.length === 0) return 0

    let matchCount = 0
    for (const token of queryTokens) {
      if (contentTokens.has(token)) matchCount++
    }

    return matchCount / queryTokens.length
  }

  /**
   * Simple tokenizer: lowercase, split on non-alpha, filter short tokens.
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1)
  }
}

/**
 * Create a {@link ConsistencyRetriever} instance.
 *
 * @param config - Optional retrieval configuration overrides.
 * @returns A new {@link ConsistencyRetriever}.
 */
export function createConsistencyRetriever(config?: Partial<RetrievalConfig>): ConsistencyRetriever {
  return new ConsistencyRetriever(config)
}
