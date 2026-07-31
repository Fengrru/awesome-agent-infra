/**
 * Confidence Gate — LLM output confidence calibration and answer gating.
 *
 * Calibrates raw model confidence via temperature scaling, computes
 * ECE/Brier/correlation metrics, learns dynamic answer thresholds, and
 * estimates hallucination risk for accept/reject decisions on live outputs.
 *
 * ## Module layout
 * - `types`       — shared types, config, and defaults
 * - `stats`       — mean, variance, Pearson/Spearman correlation
 * - `calibration` — ECE, Brier, temperature scaling, thresholds, reliability
 * - `gate`        — ConfidenceGate core class + createConfidenceGate factory
 * - `evaluation`  — difficulty-stratified evaluation, 4-quadrant analysis
 *
 * @module confidence-gate
 */

// ─── Types ────────────────────────────────────────────────────────────────
export type {
  ConfidenceResult,
  CalibrationMetadata,
  ReliabilityBin,
  CalibrationReport,
  CalibrationSample,
  ConfidenceGateConfig,
  DifficultyBinResult,
  ComprehensiveEvaluation,
  UnknownQuestionResult,
} from "./types"
export { DEFAULT_CONFIG } from "./types"

// ─── Statistics ───────────────────────────────────────────────────────────
export { mean, variance, pearsonR as pearsonCorrelation, spearmanR } from "./stats"

// ─── Calibration primitives ───────────────────────────────────────────────
export {
  computeECE,
  computeBrierScore,
  findOptimalTemperature,
  applyTemperatureScaling,
  findDynamicThreshold,
  hallucinationRate,
  reliabilityDiagram,
} from "./calibration"

// ─── Gate ─────────────────────────────────────────────────────────────────
export { ConfidenceGate, createConfidenceGate } from "./gate"

// ─── Evaluation ───────────────────────────────────────────────────────────
export { evaluateModel, unknownQuestionAccuracy } from "./evaluation"
