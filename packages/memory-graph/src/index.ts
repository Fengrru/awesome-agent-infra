/**
 * Memory Graph — causal dependency graph for AI agent memory revision.
 *
 * Models memory as a revisable causal dependency graph three principles:
 * - P1: Immutable Semantic Versioning (Copy-on-Write)
 * - P2: Dependency-Preserving Revision (BFS cascade invalidation)
 * - P3: Consistency-Aware Retrieval (5 retrieval modes)
 *
 * ## Module layout
 * - `types`     — enums, interfaces, configs, helpers
 * - `graph`     — MemoryGraph with CoW versioning + BFS cascade
 * - `retrieval` — ConsistencyRetriever with 5 retrieval modes
 *
 * @module memory-graph
 */

// ─── Types ──────────────────────────────────────────────────────────────
export {
  ConsistencyStatus,
  RelationType,
  RetrievalMode,
} from "./types"

export type {
  MemoryNodeVersion,
  EdgeRef,
  CausalEdge,
  StaleMessage,
  PropagationConfig,
  RetrievalConfig,
} from "./types"

export {
  DEFAULT_PROPAGATION_CONFIG,
  DEFAULT_RETRIEVAL_CONFIG,
  generateNodeId,
} from "./types"

// ─── Graph ──────────────────────────────────────────────────────────────
export { MemoryGraph, createMemoryGraph } from "./graph"

// ─── Retrieval ──────────────────────────────────────────────────────────
export { ConsistencyRetriever, createConsistencyRetriever } from "./retrieval"
export type { RetrievalResult } from "./retrieval"
