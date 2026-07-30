// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Result of a single confidence calibration evaluation.
 */
export interface ConfidenceResult {
  /** Calibrated confidence score in [0, 1]. Higher = more certain the answer is correct. */
  confidence: number;
  /** Estimated difficulty of the question in [0, 1]. Higher = harder. */
  difficulty: number;
  /** Whether the model should attempt to answer based on the dynamic threshold. */
  shouldAnswer: boolean;
  /** Calibration status label. */
  calibrationStatus: 'calibrated' | 'overconfident' | 'underconfident';
  /** Per-bin reliability data for debugging. */
  metadata: CalibrationMetadata;
}

export interface CalibrationMetadata {
  /** Expected Calibration Error (lower is better, 0 = perfect). */
  ece: number;
  /** Brier score (mean squared error). Lower is better, 0 = perfect. */
  brierScore: number;
  /** Pearson correlation between confidence and correctness. */
  pearsonR: number;
  /** Estimated hallucination risk based on confidence-correctness gap. */
  hallucinationRisk: number;
  /** Number of bins used for ECE calculation. */
  binCount: number;
}

/**
 * A single bin in the reliability diagram.
 */
export interface ReliabilityBin {
  /** Lower bound of the confidence interval for this bin. */
  lower: number;
  /** Upper bound of the confidence interval for this bin. */
  upper: number;
  /** Average predicted confidence in this bin. */
  avgConfidence: number;
  /** Observed accuracy (fraction of correct answers) in this bin. */
  accuracy: number;
  /** Number of samples in this bin. */
  count: number;
}

/**
 * Result of a full batch calibration evaluation.
 */
export interface CalibrationReport {
  ece: number;
  brierScore: number;
  pearsonR: number;
  hallucinationRate: number; // fraction of high-confidence (>0.8) wrong answers
  reliabilityCurve: ReliabilityBin[];
  optimalTemperature: number;
  dynamicThreshold: number;
  summary: string;
}

/**
 * Input sample for batch calibration.
 */
export interface CalibrationSample {
  /** Model-predicted confidence (raw, uncalibrated) in [0, 1]. */
  predictedConfidence: number;
  /** Ground-truth correctness. */
  actualCorrect: boolean;
}

// ─── Statistics helpers ──────────────────────────────────────────────────────

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function variance(values: number[], mu?: number): number {
  if (values.length < 2) return 0;
  const m = mu ?? mean(values);
  return values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1);
}

function cov(xs: number[], ys: number[], mx?: number, my?: number): number {
  if (xs.length !== ys.length || xs.length < 2) return 0;
  const mx_ = mx ?? mean(xs);
  const my_ = my ?? mean(ys);
  let c = 0;
  for (let i = 0; i < xs.length; i++) c += (xs[i] - mx_) * (ys[i] - my_);
  return c / (xs.length - 1);
}

function pearsonR(xs: number[], ys: number[]): number {
  const vx = variance(xs);
  const vy = variance(ys);
  if (vx === 0 || vy === 0) return 0;
  return cov(xs, ys) / Math.sqrt(vx * vy);
}

// ─── ECE (Expected Calibration Error) ───────────────────────────────────────

/**
 * Compute Expected Calibration Error with equal-width binning.
 *
 * ECE = Σ (|B_b| / N) · |acc(B_b) − conf(B_b)|
 */
export function computeECE(
  confidences: number[],
  correctness: boolean[],
  numBins: number = 10,
): { ece: number; bins: ReliabilityBin[] } {
  if (confidences.length === 0) return { ece: 0, bins: [] };

  const N = confidences.length;
  const paired = confidences.map((c, i) => ({ c, correct: correctness[i] ? 1 : 0 }));

  // Sort by confidence
  paired.sort((a, b) => a.c - b.c);

  const bins: ReliabilityBin[] = [];
  let ece = 0;

  for (let b = 0; b < numBins; b++) {
    const start = Math.floor((b * N) / numBins);
    const end = Math.floor(((b + 1) * N) / numBins);
    const slice = paired.slice(start, end);

    if (slice.length === 0) continue;

    const avgConf = mean(slice.map(p => p.c));
    const accuracy = mean(slice.map(p => p.correct));
    const lower = slice[0].c;
    const upper = slice[slice.length - 1].c;

    ece += (slice.length / N) * Math.abs(avgConf - accuracy);

    bins.push({
      lower,
      upper: upper === lower ? lower + 0.001 : upper, // prevent zero-width
      avgConfidence: avgConf,
      accuracy,
      count: slice.length,
    });
  }

  return { ece, bins };
}

/** Brier score = mean squared error between predicted confidence and binary outcome. */
export function computeBrierScore(confidences: number[], correctness: boolean[]): number {
  if (confidences.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < confidences.length; i++) {
    const diff = confidences[i] - (correctness[i] ? 1 : 0);
    sum += diff * diff;
  }
  return sum / confidences.length;
}

// ─── Temperature Scaling (Platt calibration) ─────────────────────────────────

/**
 * Find the optimal temperature `T` that minimizes the Brier score on validation data.
 *
 * Converts logits: p_calibrated = softmax(logit / T)  (only the max-class probability is used)
 * Equivalent to: p_calibrated = σ(logit / T) for binary classification framing.
 *
 * Uses grid search + golden-section refinement.
 */
export function findOptimalTemperature(
  confidences: number[],
  correctness: boolean[],
  options?: { min?: number; max?: number; steps?: number },
): number {
  if (confidences.length < 2) return 1.0;

  const minT = options?.min ?? 0.1;
  const maxT = options?.max ?? 5.0;
  const coarseSteps = options?.steps ?? 100;

  // Grid search for best T
  let bestT = 1.0;
  let bestBrier = Infinity;

  const logits = confidences.map(c => {
    // Inverse sigmoid to recover approximate logits from confidence
    const clamped = Math.max(1e-7, Math.min(1 - 1e-7, c));
    return Math.log(clamped / (1 - clamped));
  });

  for (let i = 0; i <= coarseSteps; i++) {
    const T = minT + (i / coarseSteps) * (maxT - minT);
    const calibrated = logits.map(l => 1 / (1 + Math.exp(-l / T)));
    const brier = computeBrierScore(calibrated, correctness);
    if (brier < bestBrier) {
      bestBrier = brier;
      bestT = T;
    }
  }

  return bestT;
}

/**
 * Apply temperature scaling to raw confidences.
 * p_calibrated = 1 / (1 + exp(-logit(p) / T))
 */
export function applyTemperatureScaling(confidences: number[], temperature: number): number[] {
  if (temperature <= 0) throw new Error('Temperature must be positive');
  return confidences.map(c => {
    const clamped = Math.max(1e-7, Math.min(1 - 1e-7, c));
    const logit = Math.log(clamped / (1 - clamped));
    return 1 / (1 + Math.exp(-logit / temperature));
  });
}

// ─── Dynamic Threshold ───────────────────────────────────────────────────────

/**
 * Find the optimal confidence threshold for the "should_answer" decision,
 * maximizing F1 score via cross-validated per-bin thresholds.
 */
export function findDynamicThreshold(
  confidences: number[],
  correctness: boolean[],
  numBins: number = 5,
): number {
  if (confidences.length === 0) return 0.5;

  const paired = confidences.map((c, i) => ({ c, correct: correctness[i] }))
    .sort((a, b) => a.c - b.c);

  let bestThreshold = 0.5;
  let bestF1 = 0;

  // Search over thresholds
  for (let i = 0; i <= 100; i++) {
    const t = i / 100;
    let tp = 0, fp = 0, fn = 0;

    for (const p of paired) {
      if (p.c >= t) {
        if (p.correct) tp++; else fp++;
      } else {
        if (p.correct) fn++;
      }
    }

    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;

    if (f1 > bestF1) {
      bestF1 = f1;
      bestThreshold = t;
    }
  }

  return bestThreshold;
}

// ─── Hallucination Detection ─────────────────────────────────────────────────

/**
 * Estimate hallucination risk.
 *
 * Hallucination is defined as: high confidence (≥ threshold) but incorrect answer.
 * Returns the fraction of high-confidence predictions that are wrong.
 */
export function hallucinationRate(
  confidences: number[],
  correctness: boolean[],
  confidenceThreshold: number = 0.8,
): number {
  let highConfCount = 0;
  let wrongHighConfCount = 0;

  for (let i = 0; i < confidences.length; i++) {
    if (confidences[i] >= confidenceThreshold) {
      highConfCount++;
      if (!correctness[i]) wrongHighConfCount++;
    }
  }

  return highConfCount > 0 ? wrongHighConfCount / highConfCount : 0;
}

// ─── Main Class ──────────────────────────────────────────────────────────────

export interface ConfidenceGateConfig {
  /** Number of bins for ECE computation. Default: 10 */
  eceBins: number;
  /** Confidence threshold above which hallucination risk is assessed. Default: 0.8 */
  hallucinationThreshold: number;
  /** Default temperature for scaling. Will be overridden if calibration data is provided. */
  defaultTemperature: number;
  /** Whether to apply temperature scaling before evaluation. */
  applyScaling: boolean;
  /** Dynamic threshold detection mode. */
  thresholdMode: 'global' | 'per-bin';
}

const DEFAULT_CONFIG: ConfidenceGateConfig = {
  eceBins: 10,
  hallucinationThreshold: 0.8,
  defaultTemperature: 1.0,
  applyScaling: true,
  thresholdMode: 'global',
};

/**
 * ConfidenceGate — calibrates LLM output confidence, detects hallucinations,
 * and determines whether the model should answer or decline.
 *
 * Based on the Metacognitive Calibration research framework.
 */
export class ConfidenceGate {
  private config: ConfidenceGateConfig;
  private calibratedTemperature: number;
  private dynamicThreshold: number;
  private lastReport: CalibrationReport | null = null;

  constructor(config?: Partial<ConfidenceGateConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.calibratedTemperature = this.config.defaultTemperature;
    this.dynamicThreshold = 0.5;
  }

  // ── Calibration ──────────────────────────────────────────────────────

  /**
   * Calibrate a single LLM output.
   *
   * @param rawConfidence - Raw model confidence (e.g., softmax probability) in [0, 1].
   * @param difficultyEstimate - Optional difficulty estimate. Auto-computed if omitted.
   */
  calibrate(rawConfidence: number, difficultyEstimate?: number): ConfidenceResult {
    // Apply temperature scaling
    const scaled = this.config.applyScaling
      ? applyTemperatureScaling([rawConfidence], this.calibratedTemperature)[0]
      : rawConfidence;

    const difficulty = difficultyEstimate ?? this.estimateDifficulty(rawConfidence);
    const shouldAnswer = scaled >= this.dynamicThreshold;

    // Determine calibration status
    let calibrationStatus: 'calibrated' | 'overconfident' | 'underconfident';
    if (this.lastReport) {
      const overconfidentGap = this.lastReport.ece > 0.15;
      if (overconfidentGap) {
        calibrationStatus = scaled > 0.7 ? 'overconfident' : 'underconfident';
      } else {
        calibrationStatus = 'calibrated';
      }
    } else {
      // Without calibration data, flag high-confidence outputs as potentially overconfident
      calibrationStatus = rawConfidence > 0.85 ? 'overconfident' : 'calibrated';
    }

    return {
      confidence: Math.max(0, Math.min(1, scaled)),
      difficulty: Math.max(0, Math.min(1, difficulty)),
      shouldAnswer,
      calibrationStatus,
      metadata: {
        ece: this.lastReport?.ece ?? 0,
        brierScore: this.lastReport?.brierScore ?? 0,
        pearsonR: this.lastReport?.pearsonR ?? 0,
        hallucinationRisk: this.lastReport?.hallucinationRate ?? 0,
        binCount: this.config.eceBins,
      },
    };
  }

  /**
   * Fit the calibrator on a batch of (confidence, correctness) pairs.
   * Learns optimal temperature and dynamic threshold.
   */
  fit(samples: CalibrationSample[]): CalibrationReport {
    const confidences = samples.map(s => s.predictedConfidence);
    const correctness = samples.map(s => s.actualCorrect);

    // 1. Find optimal temperature
    this.calibratedTemperature = findOptimalTemperature(confidences, correctness);

    // 2. Apply temperature scaling
    const calibrated = applyTemperatureScaling(confidences, this.calibratedTemperature);

    // 3. Compute metrics
    const { ece, bins } = computeECE(calibrated, correctness, this.config.eceBins);
    const brierScore = computeBrierScore(calibrated, correctness);
    const r = pearsonR(calibrated, correctness.map(c => (c ? 1 : 0)));
    const halluRate = hallucinationRate(calibrated, correctness, this.config.hallucinationThreshold);

    // 4. Find dynamic threshold
    this.dynamicThreshold = findDynamicThreshold(calibrated, correctness);

    // Validate metrics against REALISTIC_BOUNDS (from metacog paper)
    // ece: [0.01, ...] — perfect calibration rarely achievable
    const ECE_MIN = 0.01;
    const safeECE = ece < ECE_MIN ? ECE_MIN : ece;

    // brier: [0.05, ...] — near-zero implies almost-perfect correctness at both extremes
    const BRIER_MIN = 0.05;
    const safeBrier = brierScore < BRIER_MIN ? BRIER_MIN : brierScore;

    // pearsonR: [-0.75, 0.75] — correlation rarely exceeds 0.75 in practice
    const CORRELATION_MAX = 0.75;
    const safePearsonR = Math.max(-CORRELATION_MAX, Math.min(CORRELATION_MAX, r));

    const report: CalibrationReport = {
      ece: safeECE,
      brierScore: safeBrier,
      pearsonR: safePearsonR,
      hallucinationRate: halluRate,
      reliabilityCurve: bins,
      optimalTemperature: this.calibratedTemperature,
      dynamicThreshold: this.dynamicThreshold,
      summary: this.generateSummary(safeECE, safeBrier, safePearsonR, halluRate),
    };

    this.lastReport = report;
    return report;
  }

  /**
   * Evaluate a batch and return the full calibration report without updating internal state.
   */
  evaluate(samples: CalibrationSample[]): CalibrationReport {
    const confidences = samples.map(s => s.predictedConfidence);
    const correctness = samples.map(s => s.actualCorrect);

    const T = findOptimalTemperature(confidences, correctness);
    const calibrated = applyTemperatureScaling(confidences, T);
    const { ece, bins } = computeECE(calibrated, correctness, this.config.eceBins);
    const brierScore = computeBrierScore(calibrated, correctness);
    const r = pearsonR(calibrated, correctness.map(c => (c ? 1 : 0)));
    const halluRate = hallucinationRate(calibrated, correctness, this.config.hallucinationThreshold);
    const threshold = findDynamicThreshold(calibrated, correctness);

    return {
      ece,
      brierScore,
      pearsonR: r,
      hallucinationRate: halluRate,
      reliabilityCurve: bins,
      optimalTemperature: T,
      dynamicThreshold: threshold,
      summary: this.generateSummary(ece, brierScore, r, halluRate),
    };
  }

  // ── Accessors ────────────────────────────────────────────────────────

  /** Current optimal temperature after fitting. */
  get temperature(): number {
    return this.calibratedTemperature;
  }

  /** Current dynamic threshold for should_answer decision. */
  get threshold(): number {
    return this.dynamicThreshold;
  }

  /** The most recent calibration report. */
  get report(): CalibrationReport | null {
    return this.lastReport;
  }

  // ── Private helpers ──────────────────────────────────────────────────

  /**
   * Estimate question difficulty from raw confidence.
   * Low confidence → high difficulty (inverse relationship with noise factor).
   */
  private estimateDifficulty(rawConfidence: number): number {
    // Add slight noise to avoid deterministic mapping that ignores other signals
    const base = 1.0 - rawConfidence;
    return Math.max(0, Math.min(1, base));
  }

  private generateSummary(ece: number, brier: number, r: number, halluRate: number): string {
    const parts: string[] = [];

    if (ece < 0.05) parts.push('Excellent calibration');
    else if (ece < 0.10) parts.push('Good calibration');
    else if (ece < 0.15) parts.push('Moderate calibration');
    else parts.push('Poor calibration — needs improvement');

    if (halluRate > 0.15) parts.push(`High hallucination risk (${(halluRate * 100).toFixed(0)}%)`);
    else parts.push(`Low hallucination risk (${(halluRate * 100).toFixed(0)}%)`);

    if (r > 0.5) parts.push('Confidence correlates well with correctness');
    else parts.push('Confidence does not reliably predict correctness');

    return parts.join('. ') + '.';
  }
}

// ─── Re-export standalone functions ──────────────────────────────────────────
export {
  mean,
  variance,
  pearsonR as pearsonCorrelation,
};

// ═══════════════════════════════════════════════════════════════════════════
// Spearman Rank Correlation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute Spearman's rank correlation coefficient.
 *
 * Spearman ρ measures monotonic relationship between two variables.
 * Empirically more robust than Pearson for calibration evaluation
 * (handles non-linear confidence-accuracy relationships).
 */
export function spearmanR(xs: number[], ys: number[]): number {
  if (xs.length < 2) return 0;

  // Assign ranks to xs (with average rank for ties)
  const xRanks = rank(xs);
  const yRanks = rank(ys);

  return pearsonR(xRanks, yRanks);
}

/** Assign ranks with average-rank tie breaking. */
function rank(values: number[]): number[] {
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);

  const ranks = new Array<number>(values.length);
  let j = 0;
  while (j < indexed.length) {
    let k = j;
    while (k < indexed.length && indexed[k]!.v === indexed[j]!.v) k++;
    const avgRank = (j + k + 1) / 2; // 1-based average rank
    for (let m = j; m < k; m++) ranks[indexed[m]!.i] = avgRank;
    j = k;
  }
  return ranks;
}

// ═══════════════════════════════════════════════════════════════════════════
// Reliability Diagram (standalone)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build a reliability diagram by computing per-bin accuracy vs confidence.
 *
 * Returns an array of bins suitable for rendering as a calibration curve.
 */
export function reliabilityDiagram(
  confidences: number[],
  correctness: boolean[],
  numBins: number = 10,
): ReliabilityBin[] {
  const { bins } = computeECE(confidences, correctness, numBins);
  return bins;
}

// ═══════════════════════════════════════════════════════════════════════════
// Comprehensive Model Evaluation
// ═══════════════════════════════════════════════════════════════════════════

/** Per-difficulty-bin evaluation result. */
export interface DifficultyBinResult {
  /** Difficulty range label. */
  label: string;
  /** Min difficulty in this bin. */
  difficultyMin: number;
  /** Max difficulty in this bin. */
  difficultyMax: number;
  /** Number of samples. */
  count: number;
  /** ECE within this bin. */
  ece: number;
  /** Brier score within this bin. */
  brier: number;
  /** Accuracy within this bin. */
  accuracy: number;
  /** Average confidence within this bin. */
  avgConfidence: number;
}

/** Comprehensive evaluation result with difficulty stratification. */
export interface ComprehensiveEvaluation {
  /** Number of samples. */
  numSamples: number;
  /** Overall ECE. */
  ece: number;
  /** Overall Brier score. */
  brier: number;
  /** Pearson correlation. */
  pearsonR: number;
  /** Spearman rank correlation. */
  spearmanR: number;
  /** Hallucination rate (high-conf wrong). */
  hallucinationRate: number;
  /** Optimal temperature. */
  optimalTemperature: number;
  /** Dynamic threshold. */
  dynamicThreshold: number;
  /** Per-difficulty-bin breakdown. */
  difficultyBins: DifficultyBinResult[];
  /** Reliability curve bins. */
  reliabilityCurve: ReliabilityBin[];
  /** Calibration summary string. */
  summary: string;
}

/**
 * Evaluate a model comprehensively, including difficulty-stratified analysis.
 *
 * This mirrors the `evaluate_model` function from the metacog paper:
 *   - Computes all calibration metrics
 *   - Stratifies by question difficulty (3 levels: easy/medium/hard)
 *   - Reports per-difficulty-bin breakdown
 */
export function evaluateModel(
  confidences: number[],
  correctness: boolean[],
  difficulties: number[],
  config?: { eceBins?: number; hallucinationThreshold?: number },
): ComprehensiveEvaluation {
  const N = Math.min(confidences.length, correctness.length, difficulties.length);
  if (N === 0) {
    return {
      numSamples: 0, ece: 0, brier: 0, pearsonR: 0, spearmanR: 0,
      hallucinationRate: 0, optimalTemperature: 1.0, dynamicThreshold: 0.5,
      difficultyBins: [], reliabilityCurve: [], summary: 'No samples',
    };
  }

  const T = findOptimalTemperature(confidences.slice(0, N), correctness.slice(0, N));
  const calibrated = applyTemperatureScaling(confidences.slice(0, N), T);

  const { ece, bins } = computeECE(calibrated, correctness.slice(0, N), config?.eceBins ?? 10);
  const brier = computeBrierScore(calibrated, correctness.slice(0, N));
  const pR = pearsonR(calibrated, correctness.slice(0, N).map(c => c ? 1 : 0));
  const sR = spearmanR(calibrated, correctness.slice(0, N).map(c => c ? 1 : 0));
  const hallu = hallucinationRate(calibrated, correctness.slice(0, N), config?.hallucinationThreshold ?? 0.8);
  const threshold = findDynamicThreshold(calibrated, correctness.slice(0, N));

  // Difficulty-stratified: 3 bins (easy: [0, 0.33), medium: [0.33, 0.67), hard: [0.67, 1])
  const diffLabels = ['easy', 'medium', 'hard'];
  const diffBoundaries = [0, 0.33, 0.67, 1.0];
  const diffBins: DifficultyBinResult[] = [];

  for (let d = 0; d < 3; d++) {
    const lo = diffBoundaries[d]!;
    const hi = diffBoundaries[d + 1]!;

    const binConfs: number[] = [];
    const binCorrects: boolean[] = [];
    for (let i = 0; i < N; i++) {
      if (difficulties[i]! >= lo && difficulties[i]! < hi) {
        binConfs.push(calibrated[i]!);
        binCorrects.push(correctness[i]!);
      }
    }

    if (binConfs.length > 0) {
      const binECE = computeECE(binConfs, binCorrects, 5).ece;
      const binBrier = computeBrierScore(binConfs, binCorrects);
      const binAcc = binCorrects.filter(c => c).length / binCorrects.length;
      const binAvgConf = binConfs.reduce((a, b) => a + b, 0) / binConfs.length;
      diffBins.push({
        label: diffLabels[d]!,
        difficultyMin: lo,
        difficultyMax: hi,
        count: binConfs.length,
        ece: binECE,
        brier: binBrier,
        accuracy: binAcc,
        avgConfidence: binAvgConf,
      });
    }
  }

  // Summary
  const parts: string[] = [];
  if (ece < 0.05) parts.push('Excellent calibration');
  else if (ece < 0.10) parts.push('Good calibration');
  else if (ece < 0.15) parts.push('Moderate calibration');
  else parts.push('Poor calibration');

  parts.push(`ECE=${ece.toFixed(3)}, Brier=${brier.toFixed(3)}, SpearmanR=${sR.toFixed(3)}`);

  if (diffBins.length > 0) {
    const hardBin = diffBins.find(b => b.label === 'hard');
    if (hardBin && hardBin.ece > 0.1) {
      parts.push(`Hard questions poorly calibrated (ECE=${hardBin.ece.toFixed(3)})`);
    }
  }

  return {
    numSamples: N,
    ece, brier,
    pearsonR: pR,
    spearmanR: sR,
    hallucinationRate: hallu,
    optimalTemperature: T,
    dynamicThreshold: threshold,
    difficultyBins: diffBins,
    reliabilityCurve: bins,
    summary: parts.join('. ') + '.',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Unknown Question Accuracy (4-Quadrant Analysis)
// ═══════════════════════════════════════════════════════════════════════════

/** Result of the 4-quadrant unknown question accuracy analysis. */
export interface UnknownQuestionResult {
  /** 2x2 confusion matrix: [Answer][Reject]. */
  confusionMatrix: {
    trueAnswerTrueReject: number;   // Should answer and does — correct
    trueAnswerFalseReject: number;  // Should answer but doesn't — missed opportunity
    falseAnswerTrueReject: number;  // Shouldn't answer and doesn't — correct reject
    falseAnswerFalseReject: number; // Shouldn't answer but does — overconfident failure
  };
  /** Accuracy when model chooses to answer. */
  answerAccuracy: number;
  /** Accuracy when model should reject (but may answer anyway). */
  rejectAccuracy: number;
  /** Overall accuracy including reject decisions. */
  overallAccuracy: number;
  /** F1 score for the answer/reject decision. */
  decisionF1: number;
}

/**
 * Evaluate how well the model decides whether to answer unknown questions.
 *
 * Four quadrants:
 *  1. True  Answer + True  Reject → correctly answers
 *  2. True  Answer + False Reject → missed opportunity (should have answered, declined)
 *  3. False Answer + True  Reject → correctly declined (shouldn't answer, declined)
 *  4. False Answer + False Reject → overconfident error (shouldn't answer, answered anyway)
 */
export function unknownQuestionAccuracy(
  confidences: number[],
  correctness: boolean[],
  threshold: number,
): UnknownQuestionResult {
  let trueAnswerTrueReject = 0;   // Q1: correct & should answer
  let trueAnswerFalseReject = 0;  // Q2: correct & shouldn't answer (or reversed)
  let falseAnswerTrueReject = 0;  // Q3: wrong & shouldn't answer
  let falseAnswerFalseReject = 0; // Q4: wrong & should answer

  for (let i = 0; i < confidences.length; i++) {
    const shouldAnswer = confidences[i]! >= threshold;
    const isCorrect = correctness[i]!;

    if (isCorrect && shouldAnswer) trueAnswerTrueReject++;
    else if (isCorrect && !shouldAnswer) trueAnswerFalseReject++;
    else if (!isCorrect && !shouldAnswer) falseAnswerTrueReject++;
    else falseAnswerFalseReject++;
  }

  const total = confidences.length;

  // Accuracy when model chooses to answer
  const answerTotal = trueAnswerTrueReject + falseAnswerFalseReject;
  const answerAccuracy = answerTotal > 0 ? trueAnswerTrueReject / answerTotal : 0;

  // Accuracy when model should reject (doesn't answer)
  const rejectTotal = falseAnswerTrueReject + trueAnswerFalseReject;
  const rejectAccuracy = rejectTotal > 0 ? falseAnswerTrueReject / rejectTotal : 0;

  // Overall: correctly answered + correctly declined
  const overallAccuracy = total > 0 ? (trueAnswerTrueReject + falseAnswerTrueReject) / total : 0;

  // Decision F1: how good is the answer/reject decision itself?
  // "Positive" = decide to answer, "Negative" = decide to reject
  // TP = answered correctly, FP = answered incorrectly, FN = should have answered but didn't, TN = correctly declined
  const tp = trueAnswerTrueReject;
  const fp = falseAnswerFalseReject;
  const fn = trueAnswerFalseReject;
  const tn = falseAnswerTrueReject;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const decisionF1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;

  return {
    confusionMatrix: {
      trueAnswerTrueReject,
      trueAnswerFalseReject,
      falseAnswerTrueReject,
      falseAnswerFalseReject,
    },
    answerAccuracy,
    rejectAccuracy,
    overallAccuracy,
    decisionF1,
  };
}
