/**
 * MemoryGraph types — core enums, interfaces, and configuration for
 * the causal dependency graph memory system.
 *
 * Maps to the formal model defined in Section 3 (Table 1 notation):
 * - Consistency status σ ∈ {VALID, STALE, CONFLICT}
 * - Edge types T = {DEPENDS_ON, CAUSES, INFLUENCES, CONTRADICTS, SUPPORTS}
 * - Memory state M_t = (G_t, V_t, R_t)
 *
 * @module memory-graph/types
 */

// ─── Consistency Status ─────────────────────────────────────────────────

/**
 * Consistency status of a memory node version.
 *
 * - `VALID`: content is known to be consistent with all causal ancestors.
 * - `STALE`: one or more causal ancestors have been revised; content may be outdated.
 * - `CONFLICT`: contradictory values from independent sources detected.
 *
 * Maps to σ in Definition 3.1.
 */
export const ConsistencyStatus = {
  VALID: "VALID",
  STALE: "STALE",
  CONFLICT: "CONFLICT",
} as const
export type ConsistencyStatus = (typeof ConsistencyStatus)[keyof typeof ConsistencyStatus]

// ─── Relation Types ─────────────────────────────────────────────────────

/**
 * Edge type vocabulary T (Definition 3.1, Table 1).
 *
 * - `DEPENDS_ON`: source was derived/computed from target (most common).
 * - `CAUSES`: target event causes source event.
 * - `INFLUENCES`: target weakly affects source.
 * - `CONTRADICTS`: source contradicts target.
 * - `SUPPORTS`: source provides evidence for target.
 */
export const RelationType = {
  DEPENDS_ON: "DEPENDS_ON",
  CAUSES: "CAUSES",
  INFLUENCES: "INFLUENCES",
  CONTRADICTS: "CONTRADICTS",
  SUPPORTS: "SUPPORTS",
} as const
export type RelationType = (typeof RelationType)[keyof typeof RelationType]

// ─── Retrieval Mode ─────────────────────────────────────────────────────

/**
 * Five retrieval modes (Table 3, Section 4.5).
 *
 * - `LATEST_VALID`: exclude OBSOLETE + STALE nodes (default safe retrieval).
 * - `CONSISTENT_ONLY`: only nodes with σ = VALID.
 * - `INCLUDE_STALE`: include STALE nodes with warning metadata.
 * - `ALL_VERSIONS`: return latest regardless of status.
 * - `AT_TIME`: return versions valid at a given timestamp (forensic analysis).
 */
export const RetrievalMode = {
  LATEST_VALID: "latest_valid",
  CONSISTENT_ONLY: "consistent_only",
  INCLUDE_STALE: "include_stale",
  ALL_VERSIONS: "all_versions",
  AT_TIME: "at_time",
} as const
export type RetrievalMode = (typeof RetrievalMode)[keyof typeof RetrievalMode]

// ─── Core Interfaces ────────────────────────────────────────────────────

/**
 * Immutable version of a memory node (Appendix B MemoryNode dataclass).
 *
 * Each update creates a new version via Copy-on-Write; historical versions
 * are never mutated (Theorem 3.2).  Metadata fields (obsolete, consistencyStatus,
 * staleReasons) may change to reflect lifecycle state.
 */
export interface MemoryNodeVersion {
  /** Entity identifier (stable across versions). */
  nodeId: string
  /** Monotonically increasing version number (Theorem 3.3). */
  version: number
  /** Key-value content dictionary. */
  content: Record<string, unknown>
  /** Snapshot of incoming causal edges at creation time (immutable). */
  causalParents: readonly EdgeRef[]
  /** Snapshot of outgoing causal edges at creation time (immutable). */
  causalChildren: readonly EdgeRef[]
  /** Version numbers of parent nodes at creation time. */
  parentVersions: Record<string, number>
  /** Wall-clock timestamp of creation (ms since epoch). */
  createdAt: number
  /** Whether this version has been superseded by a newer version. */
  obsolete: boolean
  /** If obsolete, the version number that superseded this one. */
  supersededBy: number | null
  /** Current consistency status σ. */
  consistencyStatus: ConsistencyStatus
  /** Human-readable reasons for STALE/CONFLICT status. */
  staleReasons: readonly string[]
  /** Confidence score in [0, 1]. */
  confidence: number
}

/**
 * Lightweight reference to a causal edge stored in a version snapshot.
 * Never hydrated from global indices (Theorem 3.2).
 */
export interface EdgeRef {
  nodeId: string
  relationType: RelationType
  strength: number
}

/**
 * Typed causal edge (Definition 3.1, Table 1).
 *
 * Each edge (u, v, τ, w) means v depends on u with relation type τ
 * and strength w ∈ [0, 1].  Live in the global graph topology, not
 * in per-version snapshots.
 */
export interface CausalEdge {
  source: string
  target: string
  relationType: RelationType
  strength: number
}

/**
 * Message attached to a node when it is marked STALE (Algorithm 2, line 14).
 */
export interface StaleMessage {
  /** The node that was updated, triggering the cascade. */
  updatedNodeId: string
  /** The new version number of the updated node. */
  updatedVersion: number
  /** Human-readable reason for the update. */
  reason: string
  /** Hop distance from the updated root. */
  depth: number
}

// ─── Config Interfaces ──────────────────────────────────────────────────

/**
 * Propagation configuration (Appendix C hyperparameters).
 *
 * Maps to: d_max, θ_min, T_active, γ, d_extra, max_versions, default_confidence.
 */
export interface PropagationConfig {
  /** Maximum BFS propagation depth d_max (default: 5). */
  maxDepth: number
  /** Minimum causal strength threshold θ_min (default: 0.1). */
  minCausalStrength: number
  /** Active edge types T_active traversed during propagation. */
  activeRelationTypes: readonly RelationType[]
  /** Strength decay factor γ per hop (default: 0.95). */
  strengthDecayFactor: number
  /** Extra depth d_extra for high-priority nodes (default: 2). */
  adaptiveDepthBoost: number
  /** Keywords that trigger adaptive depth boost. */
  highPriorityKeywords: readonly string[]
}

/**
 * Retrieval configuration.
 */
export interface RetrievalConfig {
  /** Default retrieval mode. */
  defaultMode: RetrievalMode
  /** Maximum results to return. */
  topK: number
}

// ─── Default Configs ────────────────────────────────────────────────────

export const DEFAULT_PROPAGATION_CONFIG: PropagationConfig = {
  maxDepth: 5,
  minCausalStrength: 0.1,
  activeRelationTypes: [
    RelationType.DEPENDS_ON,
    RelationType.CAUSES,
    RelationType.INFLUENCES,
    RelationType.CONTRADICTS,
    RelationType.SUPPORTS,
  ],
  strengthDecayFactor: 0.95,
  adaptiveDepthBoost: 2,
  highPriorityKeywords: ["fraud", "contract", "crime", "risk"],
}

export const DEFAULT_RETRIEVAL_CONFIG: RetrievalConfig = {
  defaultMode: RetrievalMode.LATEST_VALID,
  topK: 10,
}

// ─── Helper ─────────────────────────────────────────────────────────────

/**
 * Generate a unique node identifier.
 *
 * @returns A random UUID v4 string.
 */
export function generateNodeId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === "x" ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}
