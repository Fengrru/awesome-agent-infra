/**
 * ConfidenceCalibrator — multi-stream metacognitive calibration.
 * @module metacog-calibrator/calibrator
 */

import type { CalibratorConfig, StreamFeatures, CalibrationResult, TrainingHistory } from "./types"
import { DEFAULT_CALIBRATOR_CONFIG } from "./types"
import { MetacognitiveTransformer } from "./transformer"
import { randomMatrix, mean, matrixL2Norm } from "./linalg"

export class ConfidenceCalibrator {
  readonly config: CalibratorConfig
  readonly metacog: MetacognitiveTransformer
  private history: TrainingHistory
  private calibrated: boolean

  constructor(baseHiddenSize: number, config?: Partial<CalibratorConfig>) {
    this.config = { ...DEFAULT_CALIBRATOR_CONFIG, ...config }
    this.metacog = new MetacognitiveTransformer(baseHiddenSize, this.config)
    this.calibrated = false
    this.history = {
      epochs: [], losses: [], semanticLosses: [],
      confidenceLosses: [], calibrationErrors: [], finalLoss: 0,
    }
  }

  calibrate(features: StreamFeatures): CalibrationResult {
    const { confidence, difficulty, fusedFeatures } = this.metacog.forward(features)
    const scaled = this.metacog["temperatureScale"](confidence, this.config.temperature)
    const rawConfidence = mean(confidence)
    const avgConfidence = mean(scaled)
    const avgDifficulty = mean(difficulty)

    const likes = features.tokenLogLikelihoods
    const maxLike = Math.max(...likes.map(Math.abs))
    const normLikes = maxLike > 0 ? likes.map((l) => Math.abs(l) / maxLike) : likes.map(() => 0.5)
    const corrected = normLikes.map((l) => (l > 0.5 ? 1 : 0))

    const { ece, binCounts, binAccuracies } = this.computeECE(scaled, corrected, corrected)
    const brierScore = this.computeBrier(scaled, corrected)

    return {
      confidence: avgConfidence,
      difficulty: avgDifficulty,
      rawConfidence,
      ece,
      brierScore,
      tokenLevelConfidences: scaled,
      binCounts,
      binAccuracies,
    }
  }

  private computeECE(confidences: number[], predictions: number[], labels: number[]): { ece: number; binCounts: number[]; binAccuracies: number[] } {
    const n = confidences.length
    const { numBins, minSamplesPerBin } = this.config
    const binCounts: number[] = new Array(numBins).fill(0)
    const binCorrect: number[] = new Array(numBins).fill(0)
    const binConfSum: number[] = new Array(numBins).fill(0)

    for (let i = 0; i < n; i++) {
      const conf = confidences[i]!
      const binIdx = Math.min(Math.floor(conf * numBins), numBins - 1)
      binCounts[binIdx]++
      binConfSum[binIdx] += conf
      if (Math.round(predictions[i]!) === labels[i]!) binCorrect[binIdx]++
      else if (predictions[i]! >= 0.5 && labels[i]! >= 0.5) binCorrect[binIdx]++
    }

    const binAccuracies: number[] = new Array(numBins).fill(0)
    let ece = 0
    let totalWeight = 0

    for (let b = 0; b < numBins; b++) {
      if (binCounts[b]! >= minSamplesPerBin) {
        binAccuracies[b] = binCorrect[b]! / binCounts[b]!
        const avgConf = binConfSum[b]! / binCounts[b]!
        const weight = binCounts[b]! / n
        ece += weight * Math.abs(binAccuracies[b]! - avgConf)
        totalWeight += weight
      } else {
        binAccuracies[b] = 0
      }
    }

    if (totalWeight > 0) ece /= totalWeight
    return { ece, binCounts, binAccuracies }
  }

  private computeBrier(predictions: number[], labels: number[]): number {
    let sum = 0
    for (let i = 0; i < predictions.length; i++) { const diff = predictions[i]! - labels[i]!; sum += diff * diff }
    return sum / predictions.length
  }

  private computeLoss(
    outputs: { confidence: number[]; difficulty: number[] },
    features: StreamFeatures,
    labels: { correctness: number[]; difficulty: number[] },
  ): { total: number; semantic: number; confidence: number; difficulty: number; calibration: number; regularization: number } {
    const lw = this.config.lossWeights

    let semLoss = 0
    const likes = features.tokenLogLikelihoods
    const maxLike = Math.max(...likes.map(Math.abs))
    if (maxLike > 0) {
      const normLikes = likes.map((l) => Math.abs(l) / maxLike)
      let semSum = 0
      for (let i = 0; i < normLikes.length; i++) { const diff = outputs.confidence[i]! - normLikes[i]!; semSum += diff * diff }
      semLoss = semSum / normLikes.length
    }

    let confLoss = 0
    for (let i = 0; i < outputs.confidence.length; i++) { const diff = outputs.confidence[i]! - labels.correctness[i]!; confLoss += diff * diff }
    confLoss /= outputs.confidence.length

    let diffLoss = 0
    for (let i = 0; i < outputs.difficulty.length; i++) { const d = outputs.difficulty[i]! - labels.difficulty[i]!; diffLoss += d * d }
    diffLoss /= Math.max(1, outputs.difficulty.length)

    const calLoss = this.computeECE(outputs.confidence, labels.correctness.map((c) => (c >= 0.5 ? 1 : 0)), labels.correctness).ece

    let regLoss = 0
    const allWeights = [
      this.metacog["semanticProj"], this.metacog["attnProj"], this.metacog["likelProj"],
      this.metacog["fusionProj"], this.metacog["confidenceHead"], this.metacog["difficultyHead"],
    ]
    for (const w of allWeights) regLoss += matrixL2Norm(w)
    for (const layer of this.metacog["layers"]) {
      const attn = layer.attn
      regLoss += matrixL2Norm(attn["wQ"]) + matrixL2Norm(attn["wK"]) + matrixL2Norm(attn["wV"]) + matrixL2Norm(attn["wO"])
      regLoss += matrixL2Norm(layer["w1"]) + matrixL2Norm(layer["w2"])
    }

    const total = lw.semantic * semLoss + lw.confidence * confLoss + lw.difficulty * diffLoss + lw.calibration * calLoss + lw.regularization * regLoss
    return { total, semantic: semLoss, confidence: confLoss, difficulty: diffLoss, calibration: calLoss, regularization: regLoss }
  }

  trainStep(features: StreamFeatures, labels: { correctness: number[]; difficulty: number[] }, learningRate: number): number {
    const outputs = this.metacog.forward(features)
    const loss = this.computeLoss(outputs, features, labels)
    const lr = learningRate

    const updateMatrix = (W: number[][], gradScale: number) => {
      const noise = randomMatrix(W.length, W[0]!.length, 0.01)
      for (let i = 0; i < W.length; i++) {
        const rowW = W[i]!; const rowN = noise[i]!
        for (let j = 0; j < rowW.length; j++) rowW[j] -= lr * gradScale * rowN[j]! * loss.total + lr * 0.0001 * rowW[j]!
      }
    }

    updateMatrix(this.metacog["confidenceHead"], 2.0)
    updateMatrix(this.metacog["difficultyHead"], 2.0)
    updateMatrix(this.metacog["semanticProj"], 0.5)
    updateMatrix(this.metacog["attnProj"], 0.5)
    updateMatrix(this.metacog["likelProj"], 0.5)
    updateMatrix(this.metacog["fusionProj"], 0.5)

    for (const layer of this.metacog["layers"]) {
      updateMatrix(layer.attn["wQ"], 1.0); updateMatrix(layer.attn["wK"], 1.0)
      updateMatrix(layer.attn["wV"], 1.0); updateMatrix(layer.attn["wO"], 1.0)
      updateMatrix(layer["w1"], 1.0); updateMatrix(layer["w2"], 1.0)
    }

    return loss.total
  }

  train(
    batches: Array<{ features: StreamFeatures; labels: { correctness: number[]; difficulty: number[] } }>,
    numEpochs: number = 10,
    learningRate: number = 0.01,
    onEpoch?: (epoch: number, totalLoss: number) => void,
  ): TrainingHistory {
    this.history = { epochs: [], losses: [], semanticLosses: [], confidenceLosses: [], calibrationErrors: [], finalLoss: 0 }
    let finalLoss = 0

    for (let epoch = 0; epoch < numEpochs; epoch++) {
      let epochLoss = 0, epochSem = 0, epochConf = 0, epochCal = 0
      for (const batch of batches) {
        const outputs = this.metacog.forward(batch.features)
        const loss = this.computeLoss(outputs, batch.features, batch.labels)
        epochLoss += loss.total; epochSem += loss.semantic; epochConf += loss.confidence; epochCal += loss.calibration
        this.trainStep(batch.features, batch.labels, learningRate)
      }
      const avgLoss = epochLoss / batches.length
      finalLoss = avgLoss
      this.history.epochs.push(epoch + 1)
      this.history.losses.push(avgLoss)
      this.history.semanticLosses.push(epochSem / batches.length)
      this.history.confidenceLosses.push(epochConf / batches.length)
      this.history.calibrationErrors.push(epochCal / batches.length)
      if (onEpoch) onEpoch(epoch + 1, avgLoss)
    }

    this.history.finalLoss = finalLoss
    this.calibrated = true
    return this.history
  }

  reset(): void {
    const baseHiddenSize = this.metacog["semanticProj"].length
    this.metacog["semanticProj"] = randomMatrix(baseHiddenSize, this.config.hiddenDim)
    this.metacog["attnProj"] = randomMatrix(1, this.config.hiddenDim)
    this.metacog["likelProj"] = randomMatrix(1, this.config.hiddenDim)
    this.metacog["fusionProj"] = randomMatrix(this.config.hiddenDim, this.config.hiddenDim)
    this.metacog["confidenceHead"] = randomMatrix(this.config.hiddenDim, 1)
    this.metacog["difficultyHead"] = randomMatrix(this.config.hiddenDim, 1)
    this.calibrated = false
    this.history = { epochs: [], losses: [], semanticLosses: [], confidenceLosses: [], calibrationErrors: [], finalLoss: 0 }
  }

  getStatistics(): { calibrated: boolean; epochs: number; finalLoss: number } {
    return { calibrated: this.calibrated, epochs: this.history.epochs.length, finalLoss: this.history.finalLoss }
  }
}
