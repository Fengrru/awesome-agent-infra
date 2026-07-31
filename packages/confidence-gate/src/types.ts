/**
 * Confidence Gate — shared types and default configuration.
 * @module confidence-gate/types
 */

/**
 * Result of a single confidence calibration evaluation.
 */
export interface ConfidenceResult {
  /** Calibrated confidence score in [0, 1]. Higher = more certain the answer is correct. */
  confidence: number
  /** Estimated difficulty of the question in [0, 1]. Higher = harder. */
  difficulty: number
  /** Whether the model should attempt to answer based on the dynamic threshold. */
  shouldAnswer: boolean
  /** Calibration status label. */
  calibrationStatus: "calibrated" | "overconfident" | "underconfident"
  /** Per-bin reliability data for debugging. */
  metadata: CalibrationMetadata
}

export interface CalibrationMetadata {
  /** Expected Calibration Error (lower is better, 0 = perfect). */
  ece: number
  /** Brier score (mean squared error). Lower is better, 0 = perfect. */
  brierScore: number
  /** Pearson correlation between confidence and correctness. */
  pearsonR: number
  /** Estimated hallucination risk based on confidence-correctness gap. */
  hallucinationRisk: number
  /** Number of bins used for ECE calculation. */
  binCount: number
}

/**
 * A single bin in the reliability diagram.
 */
export interface ReliabilityBin {
  /** Lower bound of the confidence interval for this bin. */
  lower: number
  /** Upper bound of the confidence interval for this bin. */
  upper: number
  /** Average predicted confidence in this bin. */
  avgConfidence: number
  /** Observed accuracy (fraction of correct answers) in this bin. */
  accuracy: number
  /** Number of samples in this bin. */
  count: number
}

/**
 * Result of a full batch calibration evaluation.
 */
export interface CalibrationReport {
  ece: number
  brierScore: number
  pearsonR: number
  hallucinationRate: number // fraction of high-confidence (>0.8) wrong answers
  reliabilityCurve: ReliabilityBin[]
  optimalTemperature: number
  dynamicThreshold: number
  summary: string
}

/**
 * Input sample for batch calibration.
 */
export interface CalibrationSample {
  /** Model-predicted confidence (raw, uncalibrated) in [0, 1]. */
  predictedConfidence: number
  /** Ground-truth correctness. */
  actualCorrect: boolean
}

export interface ConfidenceGateConfig {
  /** Number of bins for ECE computation. Default: 10 */
  eceBins: number
  /** Confidence threshold above which hallucination risk is assessed. Default: 0.8 */
  hallucinationThreshold: number
  /** Default temperature for scaling. Will be overridden if calibration data is provided. */
  defaultTemperature: number
  /** Whether to apply temperature scaling before evaluation. */
  applyScaling: boolean
  /** Dynamic threshold detection mode. */
  thresholdMode: "global" | "per-bin"
}

export const DEFAULT_CONFIG: ConfidenceGateConfig = {
  eceBins: 10,
  hallucinationThreshold: 0.8,
  defaultTemperature: 1.0,
  applyScaling: true,
  thresholdMode: "global",
}

/** Per-difficulty-bin evaluation result. */
export interface DifficultyBinResult {
  /** Difficulty range label. */
  label: string
  /** Min difficulty in this bin. */
  difficultyMin: number
  /** Max difficulty in this bin. */
  difficultyMax: number
  /** Number of samples. */
  count: number
  /** ECE within this bin. */
  ece: number
  /** Brier score within this bin. */
  brier: number
  /** Accuracy within this bin. */
  accuracy: number
  /** Average confidence within this bin. */
  avgConfidence: number
}

/** Comprehensive evaluation result with difficulty stratification. */
export interface ComprehensiveEvaluation {
  /** Number of samples. */
  numSamples: number
  /** Overall ECE. */
  ece: number
  /** Overall Brier score. */
  brier: number
  /** Pearson correlation. */
  pearsonR: number
  /** Spearman rank correlation. */
  spearmanR: number
  /** Hallucination rate (high-conf wrong). */
  hallucinationRate: number
  /** Optimal temperature. */
  optimalTemperature: number
  /** Dynamic threshold. */
  dynamicThreshold: number
  /** Per-difficulty-bin breakdown. */
  difficultyBins: DifficultyBinResult[]
  /** Reliability curve bins. */
  reliabilityCurve: ReliabilityBin[]
  /** Calibration summary string. */
  summary: string
}

/** Result of the 4-quadrant unknown question accuracy analysis. */
export interface UnknownQuestionResult {
  /** 2x2 confusion matrix: [Answer][Reject]. */
  confusionMatrix: {
    trueAnswerTrueReject: number // Should answer and does — correct
    trueAnswerFalseReject: number // Should answer but doesn't — missed opportunity
    falseAnswerTrueReject: number // Shouldn't answer and doesn't — correct reject
    falseAnswerFalseReject: number // Shouldn't answer but does — overconfident failure
  }
  /** Accuracy when model chooses to answer. */
  answerAccuracy: number
  /** Accuracy when model should reject (but may answer anyway). */
  rejectAccuracy: number
  /** Overall accuracy including reject decisions. */
  overallAccuracy: number
  /** F1 score for the answer/reject decision. */
  decisionF1: number
}
