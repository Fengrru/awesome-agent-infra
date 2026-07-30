/**
 * Memory Engine v2 — biologically-inspired memory system.
 *
 * Five-tier memory architecture with sleep consolidation, meta-memory
 * awareness, and attention-based retrieval.
 *
 * ## Module layout
 * - `types`        — enums, interfaces, default configs, helpers
 * - `tfidf`        — text vectorization utilities
 * - `stores`       — WorkingMemory, ShortTermMemory, LongTermMemory, EpisodicMemory, SemanticMemory
 * - `consolidation` — SleepConsolidation with slow-wave/REM/association stages
 * - `retrieval`    — MetaMemory awareness + AttentionRetrieval
 * - `engine`       — MemoryEngine orchestrator
 *
 * @module memory-engine-v2
 */

// ─── Types ──────────────────────────────────────────────────────────────
export {
  MemoryType,
  MemoryPriority,
  SleepStage,
  ConfidenceLevel,
} from "./types"

export type {
  MemoryItem,
  AttentionWeight,
  ConsolidationResult,
  MemoryAwareness,
  MemoryDecision,
  MemoryConfig,
  SleepConfig,
  MetaMemoryConfig,
  AttentionConfig,
} from "./types"

export {
  DEFAULT_MEMORY_CONFIG,
  DEFAULT_SLEEP_CONFIG,
  DEFAULT_META_MEMORY_CONFIG,
  DEFAULT_ATTENTION_CONFIG,
  generateId,
  clamp,
  createMemoryItem,
} from "./types"

// ─── TF-IDF ─────────────────────────────────────────────────────────────
export { tokenize, computeIDF, computeTFIDFVector, cosineSimilarity } from "./tfidf"

// ─── Stores ─────────────────────────────────────────────────────────────
export { WorkingMemory, ShortTermMemory, LongTermMemory, EpisodicMemory, SemanticMemory } from "./stores"

// ─── Consolidation ──────────────────────────────────────────────────────
export { SleepConsolidation } from "./consolidation"

// ─── Retrieval ──────────────────────────────────────────────────────────
export { MetaMemory, AttentionRetrieval } from "./retrieval"

// ─── Engine ─────────────────────────────────────────────────────────────
export { MemoryEngine } from "./engine"
