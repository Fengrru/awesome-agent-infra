/**
 * Calibration primitives — ECE, Brier score, temperature scaling,
 * dynamic thresholding, hallucination rate, and reliability diagrams.
 * @module confidence-gate/calibration
 */

import { mean } from "./stats"
import type { ReliabilityBin } from "./types"

// ─── ECE (Expected Calibration Error) ───────────────────────────────────────

/**
 * Compute Expected Calibration Error with equal-width binning.
 *
 * ECE = Σ (|B_b| / N) · |acc(B_b) − conf(B_b)|
 */
export function computeECE(
  confidences: number[],
  correctness: boolean[],
  numBins = 10,
): { ece: number; bins: ReliabilityBin[] } {
  if (confidences.length === 0) return { ece: 0, bins: [] }

  const N = confidences.length
  const paired = confidences.map((c, i) => ({ c, correct: correctness[i] ? 1 : 0 }))

  // Sort by confidence
  paired.sort((a, b) => a.c - b.c)

  const bins: ReliabilityBin[] = []
  let ece = 0

  for (let b = 0; b < numBins; b++) {
    const start = Math.floor((b * N) / numBins)
    const end = Math.floor(((b + 1) * N) / numBins)
    const slice = paired.slice(start, end)

    if (slice.length === 0) continue

    const avgConf = mean(slice.map((p) => p.c))
    const accuracy = mean(slice.map((p) => p.correct))
    const lower = slice[0].c
    const upper = slice[slice.length - 1].c

    ece += (slice.length / N) * Math.abs(avgConf - accuracy)

    bins.push({
      lower,
      upper: upper === lower ? lower + 0.001 : upper, // prevent zero-width
      avgConfidence: avgConf,
      accuracy,
      count: slice.length,
    })
  }

  return { ece, bins }
}

/** Brier score = mean squared error between predicted confidence and binary outcome. */
export function computeBrierScore(confidences: number[], correctness: boolean[]): number {
  if (confidences.length === 0) return 0
  let sum = 0
  for (let i = 0; i < confidences.length; i++) {
    const diff = confidences[i] - (correctness[i] ? 1 : 0)
    sum += diff * diff
  }
  return sum / confidences.length
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
  if (confidences.length < 2) return 1.0

  const minT = options?.min ?? 0.1
  const maxT = options?.max ?? 5.0
  const coarseSteps = options?.steps ?? 100

  // Grid search for best T
  let bestT = 1.0
  let bestBrier = Number.POSITIVE_INFINITY

  const logits = confidences.map((c) => {
    // Inverse sigmoid to recover approximate logits from confidence
    const clamped = Math.max(1e-7, Math.min(1 - 1e-7, c))
    return Math.log(clamped / (1 - clamped))
  })

  for (let i = 0; i <= coarseSteps; i++) {
    const T = minT + (i / coarseSteps) * (maxT - minT)
    const calibrated = logits.map((l) => 1 / (1 + Math.exp(-l / T)))
    const brier = computeBrierScore(calibrated, correctness)
    if (brier < bestBrier) {
      bestBrier = brier
      bestT = T
    }
  }

  return bestT
}

/**
 * Apply temperature scaling to raw confidences.
 * p_calibrated = 1 / (1 + exp(-logit(p) / T))
 */
export function applyTemperatureScaling(confidences: number[], temperature: number): number[] {
  if (temperature <= 0) throw new Error("Temperature must be positive")
  return confidences.map((c) => {
    const clamped = Math.max(1e-7, Math.min(1 - 1e-7, c))
    const logit = Math.log(clamped / (1 - clamped))
    return 1 / (1 + Math.exp(-logit / temperature))
  })
}

// ─── Dynamic Threshold ───────────────────────────────────────────────────────

/**
 * Find the optimal confidence threshold for the "should_answer" decision,
 * maximizing F1 score via cross-validated per-bin thresholds.
 */
export function findDynamicThreshold(confidences: number[], correctness: boolean[], _numBins = 5): number {
  if (confidences.length === 0) return 0.5

  const paired = confidences.map((c, i) => ({ c, correct: correctness[i] })).sort((a, b) => a.c - b.c)

  let bestThreshold = 0.5
  let bestF1 = 0

  // Search over thresholds
  for (let i = 0; i <= 100; i++) {
    const t = i / 100
    let tp = 0
    let fp = 0
    let fn = 0

    for (const p of paired) {
      if (p.c >= t) {
        if (p.correct) tp++
        else fp++
      } else {
        if (p.correct) fn++
      }
    }

    const precision = tp + fp > 0 ? tp / (tp + fp) : 0
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0
    const f1 = precision + recall > 0 ? (2 * (precision * recall)) / (precision + recall) : 0

    if (f1 > bestF1) {
      bestF1 = f1
      bestThreshold = t
    }
  }

  return bestThreshold
}

// ─── Hallucination Detection ─────────────────────────────────────────────────

/**
 * Estimate hallucination risk.
 *
 * Hallucination is defined as: high confidence (≥ threshold) but incorrect answer.
 * Returns the fraction of high-confidence predictions that are wrong.
 */
export function hallucinationRate(confidences: number[], correctness: boolean[], confidenceThreshold = 0.8): number {
  let highConfCount = 0
  let wrongHighConfCount = 0

  for (let i = 0; i < confidences.length; i++) {
    if (confidences[i] >= confidenceThreshold) {
      highConfCount++
      if (!correctness[i]) wrongHighConfCount++
    }
  }

  return highConfCount > 0 ? wrongHighConfCount / highConfCount : 0
}

// ─── Reliability Diagram (standalone) ────────────────────────────────────────

/**
 * Build a reliability diagram by computing per-bin accuracy vs confidence.
 *
 * Returns an array of bins suitable for rendering as a calibration curve.
 */
export function reliabilityDiagram(confidences: number[], correctness: boolean[], numBins = 10): ReliabilityBin[] {
  const { bins } = computeECE(confidences, correctness, numBins)
  return bins
}
