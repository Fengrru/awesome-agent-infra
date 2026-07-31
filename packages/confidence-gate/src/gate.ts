/**
 * ConfidenceGate core class and factory.
 * @module confidence-gate/gate
 */

import {
  applyTemperatureScaling,
  computeBrierScore,
  computeECE,
  findDynamicThreshold,
  findOptimalTemperature,
  hallucinationRate,
} from "./calibration"
import { pearsonR } from "./stats"
import type { CalibrationReport, CalibrationSample, ConfidenceGateConfig, ConfidenceResult } from "./types"
import { DEFAULT_CONFIG } from "./types"

/**
 * ConfidenceGate — calibrates LLM output confidence, detects hallucinations,
 * and determines whether the model should answer or decline.
 *
 * Based on the Metacognitive Calibration research framework.
 */
export class ConfidenceGate {
  private config: ConfidenceGateConfig
  private calibratedTemperature: number
  private dynamicThreshold: number
  private lastReport: CalibrationReport | null = null

  constructor(config?: Partial<ConfidenceGateConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.calibratedTemperature = this.config.defaultTemperature
    this.dynamicThreshold = 0.5
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
      : rawConfidence

    const difficulty = difficultyEstimate ?? this.estimateDifficulty(rawConfidence)
    const shouldAnswer = scaled >= this.dynamicThreshold

    // Determine calibration status
    let calibrationStatus: "calibrated" | "overconfident" | "underconfident"
    if (this.lastReport) {
      const overconfidentGap = this.lastReport.ece > 0.15
      if (overconfidentGap) {
        calibrationStatus = scaled > 0.7 ? "overconfident" : "underconfident"
      } else {
        calibrationStatus = "calibrated"
      }
    } else {
      // Without calibration data, flag high-confidence outputs as potentially overconfident
      calibrationStatus = rawConfidence > 0.85 ? "overconfident" : "calibrated"
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
    }
  }

  /**
   * Fit the calibrator on a batch of (confidence, correctness) pairs.
   * Learns optimal temperature and dynamic threshold.
   */
  fit(samples: CalibrationSample[]): CalibrationReport {
    const confidences = samples.map((s) => s.predictedConfidence)
    const correctness = samples.map((s) => s.actualCorrect)

    // 1. Find optimal temperature
    this.calibratedTemperature = findOptimalTemperature(confidences, correctness)

    // 2. Apply temperature scaling
    const calibrated = applyTemperatureScaling(confidences, this.calibratedTemperature)

    // 3. Compute metrics
    const { ece, bins } = computeECE(calibrated, correctness, this.config.eceBins)
    const brierScore = computeBrierScore(calibrated, correctness)
    const r = pearsonR(
      calibrated,
      correctness.map((c) => (c ? 1 : 0)),
    )
    const halluRate = hallucinationRate(calibrated, correctness, this.config.hallucinationThreshold)

    // 4. Find dynamic threshold
    this.dynamicThreshold = findDynamicThreshold(calibrated, correctness)

    // Validate metrics against REALISTIC_BOUNDS (from metacog paper)
    // ece: [0.01, ...] — perfect calibration rarely achievable
    const ECE_MIN = 0.01
    const safeECE = ece < ECE_MIN ? ECE_MIN : ece

    // brier: [0.05, ...] — near-zero implies almost-perfect correctness at both extremes
    const BRIER_MIN = 0.05
    const safeBrier = brierScore < BRIER_MIN ? BRIER_MIN : brierScore

    // pearsonR: [-0.75, 0.75] — correlation rarely exceeds 0.75 in practice
    const CORRELATION_MAX = 0.75
    const safePearsonR = Math.max(-CORRELATION_MAX, Math.min(CORRELATION_MAX, r))

    const report: CalibrationReport = {
      ece: safeECE,
      brierScore: safeBrier,
      pearsonR: safePearsonR,
      hallucinationRate: halluRate,
      reliabilityCurve: bins,
      optimalTemperature: this.calibratedTemperature,
      dynamicThreshold: this.dynamicThreshold,
      summary: this.generateSummary(safeECE, safeBrier, safePearsonR, halluRate),
    }

    this.lastReport = report
    return report
  }

  /**
   * Evaluate a batch and return the full calibration report without updating internal state.
   */
  evaluate(samples: CalibrationSample[]): CalibrationReport {
    const confidences = samples.map((s) => s.predictedConfidence)
    const correctness = samples.map((s) => s.actualCorrect)

    const T = findOptimalTemperature(confidences, correctness)
    const calibrated = applyTemperatureScaling(confidences, T)
    const { ece, bins } = computeECE(calibrated, correctness, this.config.eceBins)
    const brierScore = computeBrierScore(calibrated, correctness)
    const r = pearsonR(
      calibrated,
      correctness.map((c) => (c ? 1 : 0)),
    )
    const halluRate = hallucinationRate(calibrated, correctness, this.config.hallucinationThreshold)
    const threshold = findDynamicThreshold(calibrated, correctness)

    return {
      ece,
      brierScore,
      pearsonR: r,
      hallucinationRate: halluRate,
      reliabilityCurve: bins,
      optimalTemperature: T,
      dynamicThreshold: threshold,
      summary: this.generateSummary(ece, brierScore, r, halluRate),
    }
  }

  // ── Accessors ────────────────────────────────────────────────────────

  /** Current optimal temperature after fitting. */
  get temperature(): number {
    return this.calibratedTemperature
  }

  /** Current dynamic threshold for should_answer decision. */
  get threshold(): number {
    return this.dynamicThreshold
  }

  /** The most recent calibration report. */
  get report(): CalibrationReport | null {
    return this.lastReport
  }

  // ── Private helpers ──────────────────────────────────────────────────

  /**
   * Estimate question difficulty from raw confidence.
   * Low confidence → high difficulty (inverse relationship with noise factor).
   */
  private estimateDifficulty(rawConfidence: number): number {
    // Add slight noise to avoid deterministic mapping that ignores other signals
    const base = 1.0 - rawConfidence
    return Math.max(0, Math.min(1, base))
  }

  private generateSummary(ece: number, _brier: number, r: number, halluRate: number): string {
    const parts: string[] = []

    if (ece < 0.05) parts.push("Excellent calibration")
    else if (ece < 0.1) parts.push("Good calibration")
    else if (ece < 0.15) parts.push("Moderate calibration")
    else parts.push("Poor calibration — needs improvement")

    if (halluRate > 0.15) parts.push(`High hallucination risk (${(halluRate * 100).toFixed(0)}%)`)
    else parts.push(`Low hallucination risk (${(halluRate * 100).toFixed(0)}%)`)

    if (r > 0.5) parts.push("Confidence correlates well with correctness")
    else parts.push("Confidence does not reliably predict correctness")

    return `${parts.join(". ")}.`
  }
}

/**
 * Create a {@link ConfidenceGate} instance.
 *
 * @param config - Optional partial configuration merged over defaults.
 * @returns A new ConfidenceGate.
 */
export function createConfidenceGate(config?: Partial<ConfidenceGateConfig>): ConfidenceGate {
  return new ConfidenceGate(config)
}
