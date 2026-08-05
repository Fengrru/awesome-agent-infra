/**
 * AgentMetacog — metacognitive monitoring and calibration for AI agents.
 *
 * Tracks what the agent knows, detects knowledge decay via the Ebbinghaus
 * forgetting curve, identifies knowledge gaps from interaction history,
 * triggers memory consolidation, and calibrates LLM output confidence by
 * fusing three feature streams (semantic, attention entropy, token
 * likelihood) through a lightweight transformer.
 *
 * ## Module layout
 * - `types`            — shared types and interfaces
 * - `ebbinghaus`       — Ebbinghaus forgetting curve utilities
 * - `confidence`       — query complexity, confidence estimation, coverage
 * - `metacog`          — AgentMetacog core class
 * - `health`           — SleepConsolidator, memory health monitoring
 * - `calibrator-types` — calibrator config types, stream features, results
 * - `linalg`           — linear algebra primitives (matMul, softmax, gelu, etc.)
 * - `transformer`      — SinusoidalPE, MultiHeadAttention, MetacognitiveTransformer
 * - `calibrator`       — ConfidenceCalibrator: ECE/Brier computation + training
 * - `baselines`        — CalibrationBaselines + FeatureExtractor
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
export { AgentMetacog, createAgentMetacog } from "./metacog"
export { SleepConsolidator, monitorMemoryHealth, getOptimizationRecommendations } from "./health"

// ─── Confidence calibration (merged from @fengrru/metacog-calibrator) ──────
export type {
  CalibratorConfig,
  StreamFeatures,
  CalibrationResult,
  TrainingHistory,
  BaselineResult,
} from "./calibrator-types"
export { DEFAULT_CALIBRATOR_CONFIG, DEFAULT_BASE_HIDDEN_SIZE } from "./calibrator-types"
export { SinusoidalPE, MultiHeadAttention, TransformerLayer, MetacognitiveTransformer } from "./transformer"
export { ConfidenceCalibrator, createConfidenceCalibrator } from "./calibrator"
export { CalibrationBaselines, FeatureExtractor } from "./baselines"
