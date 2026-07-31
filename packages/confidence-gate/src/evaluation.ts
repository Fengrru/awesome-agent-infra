/**
 * Comprehensive model evaluation — difficulty-stratified analysis and
 * 4-quadrant unknown question accuracy.
 * @module confidence-gate/evaluation
 */

import {
  applyTemperatureScaling,
  computeBrierScore,
  computeECE,
  findDynamicThreshold,
  findOptimalTemperature,
  hallucinationRate,
} from "./calibration"
import { pearsonR, spearmanR } from "./stats"
import type { ComprehensiveEvaluation, DifficultyBinResult, UnknownQuestionResult } from "./types"

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
  const N = Math.min(confidences.length, correctness.length, difficulties.length)
  if (N === 0) {
    return {
      numSamples: 0,
      ece: 0,
      brier: 0,
      pearsonR: 0,
      spearmanR: 0,
      hallucinationRate: 0,
      optimalTemperature: 1.0,
      dynamicThreshold: 0.5,
      difficultyBins: [],
      reliabilityCurve: [],
      summary: "No samples",
    }
  }

  const T = findOptimalTemperature(confidences.slice(0, N), correctness.slice(0, N))
  const calibrated = applyTemperatureScaling(confidences.slice(0, N), T)

  const { ece, bins } = computeECE(calibrated, correctness.slice(0, N), config?.eceBins ?? 10)
  const brier = computeBrierScore(calibrated, correctness.slice(0, N))
  const pR = pearsonR(
    calibrated,
    correctness.slice(0, N).map((c) => (c ? 1 : 0)),
  )
  const sR = spearmanR(
    calibrated,
    correctness.slice(0, N).map((c) => (c ? 1 : 0)),
  )
  const hallu = hallucinationRate(calibrated, correctness.slice(0, N), config?.hallucinationThreshold ?? 0.8)
  const threshold = findDynamicThreshold(calibrated, correctness.slice(0, N))

  // Difficulty-stratified: 3 bins (easy: [0, 0.33), medium: [0.33, 0.67), hard: [0.67, 1])
  const diffLabels = ["easy", "medium", "hard"]
  const diffBoundaries = [0, 0.33, 0.67, 1.0]
  const diffBins: DifficultyBinResult[] = []

  for (let d = 0; d < 3; d++) {
    const lo = diffBoundaries[d]!
    const hi = diffBoundaries[d + 1]!

    const binConfs: number[] = []
    const binCorrects: boolean[] = []
    for (let i = 0; i < N; i++) {
      if (difficulties[i]! >= lo && difficulties[i]! < hi) {
        binConfs.push(calibrated[i]!)
        binCorrects.push(correctness[i]!)
      }
    }

    if (binConfs.length > 0) {
      const binECE = computeECE(binConfs, binCorrects, 5).ece
      const binBrier = computeBrierScore(binConfs, binCorrects)
      const binAcc = binCorrects.filter((c) => c).length / binCorrects.length
      const binAvgConf = binConfs.reduce((a, b) => a + b, 0) / binConfs.length
      diffBins.push({
        label: diffLabels[d]!,
        difficultyMin: lo,
        difficultyMax: hi,
        count: binConfs.length,
        ece: binECE,
        brier: binBrier,
        accuracy: binAcc,
        avgConfidence: binAvgConf,
      })
    }
  }

  // Summary
  const parts: string[] = []
  if (ece < 0.05) parts.push("Excellent calibration")
  else if (ece < 0.1) parts.push("Good calibration")
  else if (ece < 0.15) parts.push("Moderate calibration")
  else parts.push("Poor calibration")

  parts.push(`ECE=${ece.toFixed(3)}, Brier=${brier.toFixed(3)}, SpearmanR=${sR.toFixed(3)}`)

  if (diffBins.length > 0) {
    const hardBin = diffBins.find((b) => b.label === "hard")
    if (hardBin && hardBin.ece > 0.1) {
      parts.push(`Hard questions poorly calibrated (ECE=${hardBin.ece.toFixed(3)})`)
    }
  }

  return {
    numSamples: N,
    ece,
    brier,
    pearsonR: pR,
    spearmanR: sR,
    hallucinationRate: hallu,
    optimalTemperature: T,
    dynamicThreshold: threshold,
    difficultyBins: diffBins,
    reliabilityCurve: bins,
    summary: `${parts.join(". ")}.`,
  }
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
  let trueAnswerTrueReject = 0 // Q1: correct & should answer
  let trueAnswerFalseReject = 0 // Q2: correct & shouldn't answer (or reversed)
  let falseAnswerTrueReject = 0 // Q3: wrong & shouldn't answer
  let falseAnswerFalseReject = 0 // Q4: wrong & should answer

  for (let i = 0; i < confidences.length; i++) {
    const shouldAnswer = confidences[i]! >= threshold
    const isCorrect = correctness[i]!

    if (isCorrect && shouldAnswer) trueAnswerTrueReject++
    else if (isCorrect && !shouldAnswer) trueAnswerFalseReject++
    else if (!isCorrect && !shouldAnswer) falseAnswerTrueReject++
    else falseAnswerFalseReject++
  }

  const total = confidences.length

  // Accuracy when model chooses to answer
  const answerTotal = trueAnswerTrueReject + falseAnswerFalseReject
  const answerAccuracy = answerTotal > 0 ? trueAnswerTrueReject / answerTotal : 0

  // Accuracy when model should reject (doesn't answer)
  const rejectTotal = falseAnswerTrueReject + trueAnswerFalseReject
  const rejectAccuracy = rejectTotal > 0 ? falseAnswerTrueReject / rejectTotal : 0

  // Overall: correctly answered + correctly declined
  const overallAccuracy = total > 0 ? (trueAnswerTrueReject + falseAnswerTrueReject) / total : 0

  // Decision F1: how good is the answer/reject decision itself?
  // "Positive" = decide to answer, "Negative" = decide to reject
  // TP = answered correctly, FP = answered incorrectly, FN = should have answered but didn't, TN = correctly declined
  const tp = trueAnswerTrueReject
  const fp = falseAnswerFalseReject
  const fn = trueAnswerFalseReject
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0
  const decisionF1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0

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
  }
}
