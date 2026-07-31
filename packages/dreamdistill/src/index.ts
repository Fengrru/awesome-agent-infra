/**
 * DreamDistill — AI Self-Improvement Through Memory Consolidation & Workflow Crystallization
 *
 * Two complementary cycles for autonomous system evolution:
 * - DreamJob (7-day): merge duplicates, remove invalid, compress, update confidence
 * - DistillJob (30-day): analyze sessions, crystallize patterns into skills/commands/agents/SOPs
 *
 * @module dreamdistill
 */

export { DreamJob, createDreamJob } from "./dream-job"
export { DistillJob, createDistillJob } from "./distill-job"

export {
  DEFAULT_DREAM_CONFIG,
  DEFAULT_DISTILL_CONFIG,
  clampConfidence,
  textSimilarity,
  extractFilePaths,
} from "./types"

export type {
  ProviderAdapter,
  MemorySection,
  MemoryEntry,
  IProjectMemory,
  EventRow,
  IEventArchiver,
  ISkillRegistrar,
  DreamConfig,
  DreamResult,
  DreamMetrics,
  DistillConfig,
  DistillResult,
  DistillMetrics,
  SessionPattern,
  DistilledArtifact,
} from "./types"
