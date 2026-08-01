/**
 * MemoryGraph — causal dependency graph with CoW versioning and
 * BFS-based cascade invalidation.
 *
 * Implements Algorithms 1-4 from the paper:
 * - Algorithm 1: CoW Node Update
 * - Algorithm 2: Cascade Invalidation (BFS with edge-type filtering)
 * - Algorithm 3: Reversible Propagation (Revalidate)
 * - Algorithm 4: Conflict Detection
 *
 * Enhanced strategies (Section 4.3):
 * - Adaptive depth for high-priority nodes
 * - Priority-queue ordering by edge strength
 * - Strength decay with hop distance
 *
 * @module memory-graph/graph
 */

import { ConsistencyStatus, DEFAULT_PROPAGATION_CONFIG, generateNodeId } from "./types"
import type { CausalEdge, EdgeRef, MemoryNodeVersion, PropagationConfig, RelationType } from "./types"

// ─── Internal state types ───────────────────────────────────────────────

interface GraphState {
  /** Version chains: entityId → ordered array of versions (index 0 = v0). */
  versions: Map<string, MemoryNodeVersion[]>
  /** Current outgoing edges: source → { target → edge }. */
  outgoing: Map<string, Map<string, CausalEdge>>
  /** Current incoming edges: target → { source → edge }. */
  incoming: Map<string, Map<string, CausalEdge>>
}

function createEmptyState(): GraphState {
  return {
    versions: new Map(),
    outgoing: new Map(),
    incoming: new Map(),
  }
}

function ensureOutgoing(state: GraphState, source: string): Map<string, CausalEdge> {
  let map = state.outgoing.get(source)
  if (!map) {
    map = new Map()
    state.outgoing.set(source, map)
  }
  return map
}

function ensureIncoming(state: GraphState, target: string): Map<string, CausalEdge> {
  let map = state.incoming.get(target)
  if (!map) {
    map = new Map()
    state.incoming.set(target, map)
  }
  return map
}

// ─── MemoryGraph ────────────────────────────────────────────────────────

export class MemoryGraph {
  private state: GraphState
  config: PropagationConfig

  constructor(config?: Partial<PropagationConfig>) {
    this.state = createEmptyState()
    this.config = { ...DEFAULT_PROPAGATION_CONFIG, ...config }
  }

  // ── Node CRUD ─────────────────────────────────────────────────────

  /**
   * Add a new memory node with initial content.
   *
   * Creates version 0 with VALID status.  Returns the created version.
   *
   * @param id - Entity identifier.  Auto-generated if omitted.
   * @param content - Key-value content dictionary.
   * @param confidence - Initial confidence in [0, 1] (default: 1.0).
   * @returns The newly created MemoryNodeVersion (v0).
   */
  addNode(id?: string, content: Record<string, unknown> = {}, confidence = 1.0): MemoryNodeVersion {
    const nodeId = id ?? generateNodeId()
    if (this.state.versions.has(nodeId)) {
      throw new Error(`Node already exists: ${nodeId}`)
    }
    const now = Date.now()
    const version: MemoryNodeVersion = {
      nodeId,
      version: 0,
      content: { ...content },
      causalParents: [],
      causalChildren: [],
      parentVersions: {},
      createdAt: now,
      obsolete: false,
      supersededBy: null,
      consistencyStatus: ConsistencyStatus.VALID,
      staleReasons: [],
      confidence: Math.max(0, Math.min(1, confidence)),
    }
    this.state.versions.set(nodeId, [version])
    return version
  }

  /**
   * Update a node via Copy-on-Write (Algorithm 1).
   *
   * 1. Merges new content with existing content.
   * 2. Increments the version counter.
   * 3. Snapshots current causal topology as immutable parents/children.
   * 4. Marks the previous version as OBSOLETE.
   * 5. Triggers cascade invalidation on all transitive dependents.
   *
   * @param id - Entity identifier.
   * @param newContent - Key-value updates to merge.
   * @param reason - Human-readable reason for the update.
   * @returns The newly created version, or null if the node does not exist.
   */
  updateNode(id: string, newContent: Record<string, unknown>, reason = "manual update"): MemoryNodeVersion | null {
    const chain = this.state.versions.get(id)
    if (!chain || chain.length === 0) return null

    const vold = chain[chain.length - 1]!

    // Algorithm 1, line 2: merge content
    const cmerged = { ...vold.content, ...newContent }

    // Algorithm 1, line 3: increment version
    const ver = vold.version + 1

    // Algorithm 1, lines 5-6: snapshot current topology
    const causalParents = this.snapshotIncoming(id)
    const causalChildren = this.snapshotOutgoing(id)

    const parentVersions: Record<string, number> = {}
    for (const parent of causalParents) {
      const parentChain = this.state.versions.get(parent.nodeId)
      if (parentChain && parentChain.length > 0) {
        parentVersions[parent.nodeId] = parentChain[parentChain.length - 1]!.version
      }
    }

    const now = Date.now()
    const vnew: MemoryNodeVersion = {
      nodeId: id,
      version: ver,
      content: cmerged,
      causalParents,
      causalChildren,
      parentVersions,
      createdAt: now,
      obsolete: false,
      supersededBy: null,
      consistencyStatus: ConsistencyStatus.VALID,
      staleReasons: [],
      confidence: vold.confidence,
    }

    // Algorithm 1, line 7: append to chain
    chain.push(vnew)

    // Algorithm 1, line 8: mark old as obsolete
    vold.obsolete = true
    vold.supersededBy = ver

    // Trigger cascade invalidation (Algorithm 2)
    this.cascadeInvalidate(id, ver, reason)

    return vnew
  }

  /**
   * Check if a node exists in the graph.
   */
  hasNode(id: string): boolean {
    return this.state.versions.has(id)
  }

  /**
   * Get the latest (current) version of a node.
   *
   * @returns The latest MemoryNodeVersion, or undefined if the node doesn't exist.
   */
  getNode(id: string): MemoryNodeVersion | undefined {
    const chain = this.state.versions.get(id)
    if (!chain || chain.length === 0) return undefined
    return chain[chain.length - 1]
  }

  /**
   * Get a specific version of a node by version number.
   *
   * @returns The requested version, or undefined if it doesn't exist.
   */
  getNodeVersion(id: string, ver: number): MemoryNodeVersion | undefined {
    const chain = this.state.versions.get(id)
    if (!chain) return undefined
    return chain[ver]
  }

  /**
   * Get the version of a node that was current at the given timestamp
   * (forensic / time-travel query).
   *
   * @returns The version valid at the timestamp, or undefined.
   */
  getNodeAtTime(id: string, timestamp: number): MemoryNodeVersion | undefined {
    const chain = this.state.versions.get(id)
    if (!chain || chain.length === 0) return undefined
    // Find the newest version created before or at the timestamp
    for (let i = chain.length - 1; i >= 0; i--) {
      if (chain[i]!.createdAt <= timestamp) return chain[i]
    }
    return undefined
  }

  /**
   * Get the full version history of a node.
   */
  getVersionHistory(id: string): readonly MemoryNodeVersion[] {
    return this.state.versions.get(id) ?? []
  }

  /**
   * Get all node IDs in the graph.
   */
  getAllNodeIds(): string[] {
    return [...this.state.versions.keys()]
  }

  // ── Edge CRUD ─────────────────────────────────────────────────────

  /**
   * Add a causal dependency edge from source to target.
   *
   * This means target depends on source.  When source is revised,
   * target will be marked STALE during cascade invalidation.
   *
   * @returns The created CausalEdge, or null if either node doesn't exist.
   */
  addEdge(source: string, target: string, relationType: RelationType, strength: number): CausalEdge | null {
    if (!this.state.versions.has(source) || !this.state.versions.has(target)) {
      return null
    }
    const edge: CausalEdge = {
      source,
      target,
      relationType,
      strength: Math.max(0, Math.min(1, strength)),
    }
    const outKey = `${target}::${relationType}`
    ensureOutgoing(this.state, source).set(outKey, edge)
    const inKey = `${source}::${relationType}`
    ensureIncoming(this.state, target).set(inKey, edge)
    return edge
  }

  /**
   * Remove a causal edge.  If relationType is omitted, removes all edges
   * between source and target.
   *
   * @returns true if at least one edge was removed.
   */
  removeEdge(source: string, target: string, relationType?: RelationType): boolean {
    let removed = false
    const outMap = this.state.outgoing.get(source)
    if (outMap) {
      for (const [key, edge] of outMap) {
        if (edge.target === target && (relationType === undefined || edge.relationType === relationType)) {
          outMap.delete(key)
          removed = true
        }
      }
      if (outMap.size === 0) this.state.outgoing.delete(source)
    }
    const inMap = this.state.incoming.get(target)
    if (inMap) {
      for (const [key, edge] of inMap) {
        if (edge.source === source && (relationType === undefined || edge.relationType === relationType)) {
          inMap.delete(key)
          removed = true
        }
      }
      if (inMap.size === 0) this.state.incoming.delete(target)
    }
    return removed
  }

  /**
   * Get all outgoing edges from a node.
   */
  getOutgoingEdges(nodeId: string): CausalEdge[] {
    const map = this.state.outgoing.get(nodeId)
    return map ? [...map.values()] : []
  }

  /**
   * Get all incoming edges to a node.
   */
  getIncomingEdges(nodeId: string): CausalEdge[] {
    const map = this.state.incoming.get(nodeId)
    return map ? [...map.values()] : []
  }

  // ── Cascade Invalidation (Algorithm 2) ────────────────────────────

  /**
   * BFS cascade invalidation (Algorithm 2).
   *
   * Starting from the updated node, traverses outgoing causal edges
   * and marks all transitive dependents as STALE.  Respects:
   * - Edge type filtering (only T_active)
   * - Minimum strength threshold (θ_min)
   * - Maximum depth (d_max, with adaptive boost for high-priority nodes)
   * - Priority queue ordering (highest strength first)
   * - Strength decay with hop distance
   *
   * @param nodeId - The node that was updated.
   * @param newVersion - The new version number of the updated node.
   * @param reason - Human-readable reason for the update.
   * @returns Array of node IDs that were marked STALE.
   */
  cascadeInvalidate(nodeId: string, newVersion: number, reason: string): string[] {
    const activeTypes = new Set(this.config.activeRelationTypes)
    const effectiveMaxDepth = this.isHighPriority(nodeId)
      ? this.config.maxDepth + this.config.adaptiveDepthBoost
      : this.config.maxDepth

    // BFS queue: [currentNodeId, depth]
    const queue: [string, number][] = [[nodeId, 0]]
    const visited = new Set<string>([nodeId])
    const staleSet: string[] = []

    while (queue.length > 0) {
      // Dequeue — but first sort by edge strength (priority queue, Section 4.3.2)
      // We sort the queue so the highest-priority paths are processed first
      queue.sort((a, b) => b[1] - a[1]) // deeper first = process all depth-d before d+1
      const [currentId, depth] = queue.shift()!

      if (depth >= effectiveMaxDepth) continue

      const outEdges = this.getOutgoingEdges(currentId)

      // Priority queue: sort by strength descending (Section 4.3.2)
      const sorted = [...outEdges].sort((a, b) => b.strength - a.strength)

      for (const edge of sorted) {
        const childId = edge.target

        // Skip if not an active edge type
        if (!activeTypes.has(edge.relationType)) continue

        // Skip if already visited
        if (visited.has(childId)) continue

        // Strength decay (Section 4.3.3, Equation 1)
        const decayedStrength = this.decayedStrength(edge.strength, depth + 1)
        if (decayedStrength < this.config.minCausalStrength) continue

        // Algorithm 2, line 14: build stale message
        const msg = this.buildStaleMessage(currentId, nodeId, newVersion, reason, depth + 1)

        // Algorithm 2, line 15: mark child as STALE
        const child = this.getNode(childId)
        if (child) {
          child.consistencyStatus = ConsistencyStatus.STALE
          child.staleReasons = [...child.staleReasons, msg]
          visited.add(childId)
          staleSet.push(childId)
          queue.push([childId, depth + 1])
        }
      }
    }

    return staleSet
  }

  // ── Revalidate (Algorithm 3) ──────────────────────────────────────

  /**
   * Reversible propagation — restore VALID status (Algorithm 3).
   *
   * When a parent is corrected back to its original value, this BFS
   * restores all transitive dependents from STALE to VALID.  Symmetric
   * to cascadeInvalidate but calls markValid instead of markStale.
   *
   * @param nodeId - The node that was corrected.
   * @param reason - Human-readable reason for the correction.
   * @returns Array of node IDs that were restored to VALID.
   */
  revalidate(nodeId: string, _reason: string): string[] {
    const activeTypes = new Set(this.config.activeRelationTypes)
    const effectiveMaxDepth = this.isHighPriority(nodeId)
      ? this.config.maxDepth + this.config.adaptiveDepthBoost
      : this.config.maxDepth

    const queue: [string, number][] = [[nodeId, 0]]
    const visited = new Set<string>([nodeId])
    const revalidatedSet: string[] = []

    // First, revalidate the root node itself
    const root = this.getNode(nodeId)
    if (root) {
      root.consistencyStatus = ConsistencyStatus.VALID
      root.staleReasons = []
      revalidatedSet.push(nodeId)
    }

    while (queue.length > 0) {
      queue.sort((a, b) => b[1] - a[1])
      const [currentId, depth] = queue.shift()!

      if (depth >= effectiveMaxDepth) continue

      const outEdges = this.getOutgoingEdges(currentId)
      const sorted = [...outEdges].sort((a, b) => b.strength - a.strength)

      for (const edge of sorted) {
        const childId = edge.target

        if (!activeTypes.has(edge.relationType)) continue
        if (visited.has(childId)) continue

        const decayedStrength = this.decayedStrength(edge.strength, depth + 1)
        if (decayedStrength < this.config.minCausalStrength) continue

        const child = this.getNode(childId)
        if (child && child.consistencyStatus === ConsistencyStatus.STALE) {
          child.consistencyStatus = ConsistencyStatus.VALID
          child.staleReasons = []
          visited.add(childId)
          revalidatedSet.push(childId)
          queue.push([childId, depth + 1])
        }
      }
    }

    return revalidatedSet
  }

  // ── Conflict Detection (Algorithm 4) ──────────────────────────────

  /**
   * Detect conflicting values between existing content and proposed new content
   * (Algorithm 4).  If conflicts are found, marks the latest version as CONFLICT.
   *
   * Returns the list of conflicting keys (empty if no conflicts).
   * Propagation is paused for CONFLICT nodes — they require manual resolution.
   *
   * @param id - Entity identifier.
   * @param newContent - Proposed new content to compare.
   * @returns Array of keys with conflicting values.
   */
  detectConflict(id: string, newContent: Record<string, unknown>): string[] {
    const node = this.getNode(id)
    if (!node) return []

    const conflicts: string[] = []
    for (const [key, newValue] of Object.entries(newContent)) {
      if (key in node.content && node.content[key] !== newValue) {
        conflicts.push(key)
      }
    }

    if (conflicts.length > 0) {
      node.consistencyStatus = ConsistencyStatus.CONFLICT
      node.staleReasons = [...node.staleReasons, `Conflict detected on keys: ${conflicts.join(", ")}`]
    }

    return conflicts
  }

  // ── Statistics ────────────────────────────────────────────────────

  /**
   * Get comprehensive graph statistics.
   */
  getStatistics(): Record<string, unknown> {
    let totalVersions = 0
    let validCount = 0
    let staleCount = 0
    let conflictCount = 0
    let obsoleteCount = 0

    for (const chain of this.state.versions.values()) {
      totalVersions += chain.length
      const latest = chain[chain.length - 1]
      if (latest) {
        switch (latest.consistencyStatus) {
          case ConsistencyStatus.VALID:
            validCount++
            break
          case ConsistencyStatus.STALE:
            staleCount++
            break
          case ConsistencyStatus.CONFLICT:
            conflictCount++
            break
        }
        if (latest.obsolete) obsoleteCount++
      }
    }

    let totalEdges = 0
    for (const outMap of this.state.outgoing.values()) {
      totalEdges += outMap.size
    }

    return {
      nodeCount: this.state.versions.size,
      totalVersions,
      edgeCount: totalEdges,
      consistencyDistribution: {
        valid: validCount,
        stale: staleCount,
        conflict: conflictCount,
      },
      obsoleteVersions: obsoleteCount,
      config: { ...this.config },
      avgVersionsPerNode: this.state.versions.size > 0 ? totalVersions / this.state.versions.size : 0,
    }
  }

  // ── Private helpers ───────────────────────────────────────────────

  /**
   * Snapshot current incoming edges as immutable EdgeRefs.
   */
  private snapshotIncoming(nodeId: string): EdgeRef[] {
    const inMap = this.state.incoming.get(nodeId)
    if (!inMap) return []
    return [...inMap.values()].map((e) => ({
      nodeId: e.source,
      relationType: e.relationType,
      strength: e.strength,
    }))
  }

  /**
   * Snapshot current outgoing edges as immutable EdgeRefs.
   */
  private snapshotOutgoing(nodeId: string): EdgeRef[] {
    const outMap = this.state.outgoing.get(nodeId)
    if (!outMap) return []
    return [...outMap.values()].map((e) => ({
      nodeId: e.target,
      relationType: e.relationType,
      strength: e.strength,
    }))
  }

  /**
   * Build a human-readable stale message (Algorithm 2, line 14).
   */
  private buildStaleMessage(
    parentId: string,
    updatedNodeId: string,
    updatedVersion: number,
    reason: string,
    depth: number,
  ): string {
    return `Stale: parent '${parentId}' updated (root: ${updatedNodeId} v${updatedVersion}) — ${reason} (depth ${depth})`
  }

  /**
   * Check if a node's content contains high-priority keywords
   * triggering adaptive depth boost (Section 4.3.1).
   */
  private isHighPriority(nodeId: string): boolean {
    const node = this.getNode(nodeId)
    if (!node) return false
    const contentStr = JSON.stringify(node.content).toLowerCase()
    return this.config.highPriorityKeywords.some((kw) => contentStr.includes(kw.toLowerCase()))
  }

  /**
   * Apply strength decay with hop distance (Section 4.3.3, Equation 1):
   * w_decayed = w_original * γ^d
   */
  private decayedStrength(originalStrength: number, depth: number): number {
    return originalStrength * this.config.strengthDecayFactor ** depth
  }
}

/**
 * Create a {@link MemoryGraph} instance.
 *
 * @param config - Optional propagation configuration overrides.
 * @returns A new {@link MemoryGraph}.
 */
export function createMemoryGraph(config?: Partial<PropagationConfig>): MemoryGraph {
  return new MemoryGraph(config)
}
