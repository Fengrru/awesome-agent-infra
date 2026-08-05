/**
 * Calibration baselines and feature extraction.
 * @module agent-metacog/baselines
 */

import type { BaselineResult, StreamFeatures } from "./calibrator-types"
import { mean, sigmoid } from "./linalg"

// ═══════════════════════════════════════════════════════════════════════════
// CalibrationBaselines
// ═══════════════════════════════════════════════════════════════════════════

// biome-ignore lint/complexity/noStaticOnlyClass: public API shape, kept for backward compatibility
export class CalibrationBaselines {
  static rawConfidence(features: StreamFeatures): number {
    const likes = features.tokenLogLikelihoods
    const n = likes.length
    if (n === 0) return 0.5
    let sum = 0
    for (let i = 0; i < n; i++) sum += Math.exp(likes[i]!)
    const avg = sum / n
    return Math.min(Math.max(sigmoid(Math.log(avg + 1e-8)), 0), 1)
  }

  static temperatureScaling(
    confidences: number[],
    labels: number[],
    temperature?: number,
  ): { calibrated: number[]; temperature: number } {
    let bestTemp = temperature ?? 1.0
    let bestECE = Number.POSITIVE_INFINITY

    if (!temperature) {
      for (let t = 0.5; t <= 2.0; t += 0.1) {
        const scaled = confidences.map((c) => c / t)
        let ece = 0
        const bins = 10
        const binCounts: number[] = new Array(bins).fill(0)
        const binAcc: number[] = new Array(bins).fill(0)
        const binConf: number[] = new Array(bins).fill(0)
        for (let i = 0; i < scaled.length; i++) {
          const bin = Math.min(Math.floor(scaled[i]! * bins), bins - 1)
          binCounts[bin]++
          binAcc[bin] += labels[i]!
          binConf[bin] += scaled[i]!
        }
        for (let b = 0; b < bins; b++) {
          if (binCounts[b]! > 0) {
            const acc = binAcc[b]! / binCounts[b]!
            const avgConf = binConf[b]! / binCounts[b]!
            ece += (binCounts[b]! / scaled.length) * Math.abs(acc - avgConf)
          }
        }
        if (ece < bestECE) {
          bestECE = ece
          bestTemp = t
        }
      }
    }

    return { calibrated: confidences.map((c) => c / bestTemp), temperature: bestTemp }
  }

  static tokenLikelihood(features: StreamFeatures): number {
    const likes = features.tokenLogLikelihoods
    const n = likes.length
    if (n === 0) return 0.5
    let sum = 0
    for (let i = 0; i < n; i++) sum += Math.abs(likes[i]!)
    return sigmoid(sum / n)
  }

  static selfEvaluation(text: string): number {
    let score = 0.5
    const len = text.length
    if (len === 0) return 0.5
    const wordCount = text.split(/\s+/).filter(Boolean).length
    const avgWordLen = wordCount > 0 ? len / wordCount : len
    if (/\d/.test(text)) score += 0.05
    if (/[A-Z]/.test(text)) score += 0.05
    if (/[a-z]/.test(text)) score += 0.05
    if (/[^a-zA-Z0-9\s]/.test(text)) score += 0.05
    if (wordCount > 5) score += 0.1
    if (wordCount > 20) score += 0.05
    if (avgWordLen > 3 && avgWordLen < 10) score += 0.05
    if (len > 50) score += 0.1
    return Math.min(Math.max(score, 0), 1)
  }

  static allBaselines(features: StreamFeatures, text: string, labels?: number[]): BaselineResult[] {
    const raw = CalibrationBaselines.rawConfidence(features)
    const tokLike = CalibrationBaselines.tokenLikelihood(features)
    const selfEval = CalibrationBaselines.selfEvaluation(text)

    const confs = features.tokenLogLikelihoods.map((l) => Math.exp(l))
    const sumConf = confs.reduce((a, b) => a + b, 0)
    const normConfs = confs.map((c) => c / (sumConf || 1))
    const labelVals = labels ?? normConfs.map((c) => (c > mean(normConfs) ? 1 : 0))

    const eceRaw = (() => {
      const bins = 10
      const binCounts: number[] = new Array(bins).fill(0)
      const binAcc: number[] = new Array(bins).fill(0)
      const binConf: number[] = new Array(bins).fill(0)
      for (let i = 0; i < normConfs.length; i++) {
        const bin = Math.min(Math.floor(raw * bins), bins - 1)
        binCounts[bin]++
        binAcc[bin] += labelVals[i]!
        binConf[bin] += raw
      }
      let ece = 0
      for (let b = 0; b < bins; b++) {
        if (binCounts[b]! > 0)
          ece += (binCounts[b]! / normConfs.length) * Math.abs(binAcc[b]! / binCounts[b]! - binConf[b]! / binCounts[b]!)
      }
      return ece / bins
    })()

    const brierCompute = (conf: number, labs: number[]) => {
      let sum = 0
      for (const l of labs) sum += (conf - l) * (conf - l)
      return sum / labs.length
    }

    return [
      { name: "Raw Confidence", method: "raw", confidence: raw, ece: eceRaw, brierScore: brierCompute(raw, labelVals) },
      {
        name: "Token Likelihood",
        method: "likelihood",
        confidence: tokLike,
        ece: Math.abs(tokLike - mean(labelVals)),
        brierScore: brierCompute(tokLike, labelVals),
      },
      {
        name: "Self Evaluation",
        method: "self_eval",
        confidence: selfEval,
        ece: Math.abs(selfEval - mean(labelVals)),
        brierScore: brierCompute(selfEval, labelVals),
      },
    ]
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FeatureExtractor
// ═══════════════════════════════════════════════════════════════════════════

export class FeatureExtractor {
  readonly config: Record<string, unknown>

  constructor(config: Record<string, unknown> = {}) {
    this.config = { ...config }
  }

  extract(hiddenStates: number[][], attentionWeights: number[][][], logProbs: number[]): StreamFeatures {
    const attentionEntropy = this.computeAttentionEntropy(attentionWeights)
    return { hiddenStates, attentionEntropy, tokenLogLikelihoods: logProbs }
  }

  private computeAttentionEntropy(attentionWeights: number[][][]): number[] {
    const numHeads = attentionWeights.length
    if (numHeads === 0) return []
    const seqLen = attentionWeights[0]!.length
    const entropies: number[] = new Array(seqLen).fill(0)
    for (let h = 0; h < numHeads; h++) {
      const headWeights = attentionWeights[h]!
      for (let i = 0; i < seqLen; i++) entropies[i] += this.entropy(headWeights[i]!)
    }
    for (let i = 0; i < seqLen; i++) entropies[i] /= numHeads
    return entropies
  }

  private entropy(probs: number[]): number {
    let h = 0
    for (let i = 0; i < probs.length; i++) {
      const p = probs[i]!
      if (p > 0) h -= p * Math.log(p + 1e-12)
    }
    return h
  }
}
