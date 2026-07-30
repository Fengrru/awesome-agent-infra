/**
 * Metacognitive Calibrator — multi-stream confidence & difficulty calibration.
 *
 * Fuses three feature streams (semantic, attention entropy, token likelihood)
 * through a lightweight transformer to produce calibrated confidence scores
 * and difficulty estimates for LLM outputs.
 *
 * ## Module layout
 * - `linalg`      — linear algebra primitives (matMul, softmax, sigmoid, gelu, etc.)
 * - `types`       — config types, stream features, calibration results
 * - `transformer` — SinusoidalPE, MultiHeadAttention, TransformerLayer, MetacognitiveTransformer
 * - `calibrator`  — ConfidenceCalibrator: ECE/Brier computation + training
 * - `baselines`   — CalibrationBaselines (raw, temperature scaling, etc.) + FeatureExtractor
 *
 * @module metacog-calibrator
 */

// ─── Types ────────────────────────────────────────────────────────────────
export type {
  CalibratorConfig,
  StreamFeatures,
  CalibrationResult,
  TrainingHistory,
  BaselineResult,
} from "./types"

export { DEFAULT_CALIBRATOR_CONFIG, DEFAULT_BASE_HIDDEN_SIZE } from "./types"

// ─── Transformer ──────────────────────────────────────────────────────────
export { SinusoidalPE, MultiHeadAttention, TransformerLayer, MetacognitiveTransformer } from "./transformer"

// ─── Calibrator ───────────────────────────────────────────────────────────
export { ConfidenceCalibrator } from "./calibrator"

// ─── Baselines ────────────────────────────────────────────────────────────
export { CalibrationBaselines, FeatureExtractor } from "./baselines"
