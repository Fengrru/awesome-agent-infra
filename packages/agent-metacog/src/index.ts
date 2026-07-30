/**
 * AgentMetacog — metacognitive monitoring for AI agents.
 *
 * Tracks what the agent knows, detects knowledge decay via the Ebbinghaus
 * forgetting curve, identifies knowledge gaps from interaction history,
 * and triggers memory consolidation.
 *
 * ## Module layout
 * - `types`      — shared types and interfaces
 * - `ebbinghaus` — Ebbinghaus forgetting curve utilities
 * - `confidence` — query complexity, confidence estimation, coverage
 * - `metacog`    — AgentMetacog core class
 * - `health`     — SleepConsolidator, memory health monitoring
 *
 * @module agent-metacog
 */

export type {
  GapSeverity,
  KnowledgeGap,
  DomainKnowledge,
  KnowledgeBoundary,
  ForgettingAlert,
  ConsolidationTask,
  MetacogState,
  InteractionRecord,
  MetacogConfig,
  MemoryStatistics,
  SleepStage,
  SleepConsolidationState,
  DomainHealthItem,
  MemoryHealthReport,
} from "./types"

export { DEFAULT_CONFIG } from "./types"
export { ebbinghausRetention, nextReviewDays } from "./ebbinghaus"
export { estimateConfidence, estimateQueryComplexity, isComputationQuery, estimateCoverage } from "./confidence"
export { AgentMetacog } from "./metacog"
export { SleepConsolidator, monitorMemoryHealth, getOptimizationRecommendations } from "./health"
