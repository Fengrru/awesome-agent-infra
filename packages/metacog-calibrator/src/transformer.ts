/**
 * Transformer layers for metacognitive confidence calibration.
 * @module metacog-calibrator/transformer
 */

import type { CalibratorConfig, StreamFeatures } from "./types"
import { randomMatrix, matMul, addMatrices, scaleVector, scaleMatrix, softmax2D, sigmoid, dropMask, gelu } from "./linalg"

export class SinusoidalPE {
  readonly dim: number
  readonly maxLen: number
  private cache: number[][]

  constructor(dim: number, maxLen: number = 2048) {
    this.dim = dim
    this.maxLen = maxLen
    this.cache = []
  }

  encode(seqLen: number): number[][] {
    if (seqLen <= this.cache.length) return this.cache.slice(0, seqLen)
    const start = this.cache.length
    const pe: number[][] = []
    for (let pos = 0; pos < seqLen; pos++) {
      if (pos < this.cache.length) { pe.push(this.cache[pos]!); continue }
      const row: number[] = new Array(this.dim)
      for (let i = 0; i < this.dim; i += 2) {
        const div = Math.pow(10000, (2 * Math.floor(i / 2)) / this.dim)
        const angle = pos / div
        row[i] = Math.sin(angle)
        if (i + 1 < this.dim) row[i + 1] = Math.cos(angle)
      }
      pe.push(row)
    }
    this.cache = pe
    return pe
  }
}

export class MultiHeadAttention {
  readonly dModel: number
  readonly numHeads: number
  readonly dK: number
  private wQ: number[][]
  private wK: number[][]
  private wV: number[][]
  private wO: number[][]
  private dropoutRate: number

  constructor(dModel: number, numHeads: number, dropoutRate: number = 0.1) {
    this.dModel = dModel
    this.numHeads = numHeads
    this.dK = dModel / numHeads
    this.dropoutRate = dropoutRate
    this.wQ = randomMatrix(dModel, dModel)
    this.wK = randomMatrix(dModel, dModel)
    this.wV = randomMatrix(dModel, dModel)
    this.wO = randomMatrix(dModel, dModel)
  }

  private scaledDotProductAttention(q: number[][], k: number[][], v: number[][], mask?: number[][]): { output: number[][]; attentionWeights: number[][][] } {
    const seqLen = q.length
    const heads = q[0]!.length / this.dK
    const numHeads = Math.round(heads)
    const dK = this.dK
    const attended: number[][] = Array.from({ length: seqLen }, () => new Array(numHeads * dK))
    const allWeights: number[][][] = []

    for (let h = 0; h < numHeads; h++) {
      const hStart = h * dK
      const qh: number[][] = Array.from({ length: seqLen }, (_, i) => {
        const row = new Array(dK); const srcRow = q[i]!
        for (let j = 0; j < dK; j++) row[j] = srcRow[hStart + j]!
        return row
      })
      const kh: number[][] = Array.from({ length: seqLen }, (_, i) => {
        const row = new Array(dK); const srcRow = k[i]!
        for (let j = 0; j < dK; j++) row[j] = srcRow[hStart + j]!
        return row
      })
      const vh: number[][] = Array.from({ length: seqLen }, (_, i) => {
        const row = new Array(dK); const srcRow = v[i]!
        for (let j = 0; j < dK; j++) row[j] = srcRow[hStart + j]!
        return row
      })

      const scores: number[][] = Array.from({ length: seqLen }, () => new Array(seqLen))
      const scale = 1 / Math.sqrt(dK)
      for (let i = 0; i < seqLen; i++) {
        const rowQ = qh[i]!
        const rowS = scores[i]!
        for (let j = 0; j < seqLen; j++) {
          let s = 0; const rowK = kh[j]!
          for (let t = 0; t < dK; t++) s += rowQ[t]! * rowK[t]!
          rowS[j] = s * scale
        }
      }

      if (mask) {
        for (let i = 0; i < seqLen; i++) {
          const rowS = scores[i]!; const rowM = mask[i]!
          for (let j = 0; j < seqLen; j++) { if (rowM![j] === 0) rowS[j] = -1e9 }
        }
      }

      const weights = softmax2D(scores)
      allWeights.push(weights)

      for (let i = 0; i < seqLen; i++) {
        const rowW = weights[i]!; const rowOut = attended[i]!
        for (let t = 0; t < dK; t++) {
          let val = 0
          for (let j = 0; j < seqLen; j++) val += rowW[j]! * vh[j]![t]!
          rowOut[hStart + t] = val
        }
      }
    }

    return { output: attended, attentionWeights: allWeights }
  }

  forward(x: number[][], mask?: number[][]): number[][] {
    const seqLen = x.length
    const q = matMul(x, this.wQ)
    const k = matMul(x, this.wK)
    const v = matMul(x, this.wV)
    const { output: attended } = this.scaledDotProductAttention(q, k, v, mask)
    const output = matMul(attended, this.wO)

    if (this.dropoutRate > 0) {
      const drop = dropMask(seqLen, this.dModel, this.dropoutRate)
      return scaleMatrix(output, 1).map((row, i) => row.map((val, j) => val * drop[i]![j]!))
    }
    return output
  }

  computeEntropy(attentionWeights: number[][][]): number[] {
    const seqLen = attentionWeights[0]!.length
    const numHeads = attentionWeights.length
    const entropies: number[] = new Array(seqLen).fill(0)
    for (let h = 0; h < numHeads; h++) {
      const headWeights = attentionWeights[h]!
      for (let i = 0; i < seqLen; i++) {
        let hVal = 0; const row = headWeights[i]!
        for (let j = 0; j < row.length; j++) { const p = row[j]!; if (p > 0) hVal -= p * Math.log(p + 1e-12) }
        entropies[i] += hVal
      }
    }
    for (let i = 0; i < seqLen; i++) entropies[i] /= numHeads
    return entropies
  }
}

export class TransformerLayer {
  readonly dModel: number
  readonly dFF: number
  readonly attn: MultiHeadAttention
  private w1: number[][]
  private w2: number[][]
  private dropoutRate: number

  constructor(dModel: number, numHeads: number, dFF?: number, dropoutRate: number = 0.1) {
    this.dModel = dModel
    this.dFF = dFF ?? dModel * 4
    this.dropoutRate = dropoutRate
    this.attn = new MultiHeadAttention(dModel, numHeads, dropoutRate)
    this.w1 = randomMatrix(dModel, this.dFF)
    this.w2 = randomMatrix(this.dFF, dModel)
  }

  private layerNorm(x: number[][], eps: number = 1e-6): number[][] {
    const seqLen = x.length
    const dim = x[0]!.length
    const result: number[][] = Array.from({ length: seqLen }, () => new Array(dim))
    for (let i = 0; i < seqLen; i++) {
      const row = x[i]!
      let sum = 0, sqSum = 0
      for (let j = 0; j < dim; j++) { sum += row[j]!; sqSum += row[j]! * row[j]! }
      const meanVal = sum / dim
      const variance = sqSum / dim - meanVal * meanVal
      const invStd = 1 / Math.sqrt(variance + eps)
      const outRow = result[i]!
      for (let j = 0; j < dim; j++) outRow[j] = (row[j]! - meanVal) * invStd
    }
    return result
  }

  private feedForward(x: number[][]): number[][] {
    const seqLen = x.length
    const dim = this.dModel
    const hidden = matMul(x, this.w1)
    for (let i = 0; i < seqLen; i++) { const row = hidden[i]!; for (let j = 0; j < this.dFF; j++) row[j] = gelu(row[j]!) }
    const out = matMul(hidden, this.w2)
    if (this.dropoutRate > 0) {
      const drop = dropMask(seqLen, dim, this.dropoutRate)
      for (let i = 0; i < seqLen; i++) { const rowO = out[i]!; const rowD = drop[i]!; for (let j = 0; j < dim; j++) rowO[j] *= rowD[j]! }
    }
    return out
  }

  forward(x: number[][], mask?: number[][]): number[][] {
    const normed = this.layerNorm(x)
    const attnOut = this.attn.forward(normed, mask)
    const residual1 = addMatrices(x, attnOut)
    const normed2 = this.layerNorm(residual1)
    const ffnOut = this.feedForward(normed2)
    return addMatrices(residual1, ffnOut)
  }
}

export class MetacognitiveTransformer {
  readonly config: CalibratorConfig
  private sinPos: SinusoidalPE
  private layers: TransformerLayer[]
  private semanticProj: number[][]
  private attnProj: number[][]
  private likelProj: number[][]
  private fusionProj: number[][]
  private confidenceHead: number[][]
  private difficultyHead: number[][]

  constructor(baseHiddenSize: number, config?: Partial<CalibratorConfig>) {
    this.config = { ...DEFAULT_CALIBRATOR_CONFIG, ...config }
    const { hiddenDim, numLayers, numHeads, dropoutRate } = this.config
    this.sinPos = new SinusoidalPE(hiddenDim)
    this.layers = Array.from({ length: numLayers }, () => new TransformerLayer(hiddenDim, numHeads, hiddenDim * 4, dropoutRate))
    this.semanticProj = randomMatrix(baseHiddenSize, hiddenDim)
    this.attnProj = randomMatrix(1, hiddenDim)
    this.likelProj = randomMatrix(1, hiddenDim)
    this.fusionProj = randomMatrix(hiddenDim, hiddenDim)
    this.confidenceHead = randomMatrix(hiddenDim, 1)
    this.difficultyHead = randomMatrix(hiddenDim, 1)
  }

  private reshapeFeatures(features: StreamFeatures): { semantic: number[][]; attention: number[][]; likelihood: number[][] } {
    const seqLen = features.hiddenStates.length
    const semantic = features.hiddenStates
    const attnRow = this.attnProj[0]!
    const attention: number[][] = Array.from({ length: seqLen }, (_, i) => scaleVector(attnRow, features.attentionEntropy[i]!))
    const likelRow = this.likelProj[0]!
    const likelihood: number[][] = Array.from({ length: seqLen }, (_, i) => scaleVector(likelRow, features.tokenLogLikelihoods[i]!))
    return { semantic, attention, likelihood }
  }

  private fuseStreams(features: StreamFeatures): number[][] {
    const { semantic, attention, likelihood } = this.reshapeFeatures(features)
    const seqLen = semantic.length
    const hiddenDim = this.config.hiddenDim
    const ws = this.config.streamWeights
    const semProj = matMul(semantic, this.semanticProj)
    const fused: number[][] = Array.from({ length: seqLen }, () => new Array(hiddenDim))
    for (let i = 0; i < seqLen; i++) {
      const rowS = semProj[i]!; const rowA = attention[i]!; const rowL = likelihood[i]!; const rowF = fused[i]!
      for (let j = 0; j < hiddenDim; j++) rowF[j] = ws.semantic * rowS[j]! + ws.attention * rowA[j]! + ws.likelihood * rowL[j]!
    }
    return matMul(fused, this.fusionProj)
  }

  private temperatureScale(logits: number[], temp: number): number[] {
    if (temp === 1) return logits
    return logits.map((l) => l / temp)
  }

  forward(features: StreamFeatures): { confidence: number[]; difficulty: number[]; fusedFeatures: number[][] } {
    const seqLen = features.hiddenStates.length
    const fusedFeatures = this.fuseStreams(features)
    const pe = this.sinPos.encode(seqLen)
    const withPos = addMatrices(fusedFeatures, pe)
    let hidden = withPos
    for (const layer of this.layers) hidden = layer.forward(hidden)
    const confLogits = matMul(hidden, this.confidenceHead)
    const diffLogits = matMul(hidden, this.difficultyHead)
    const confidence = confLogits.map((row) => sigmoid(row[0]!))
    const difficulty = diffLogits.map((row) => sigmoid(row[0]!))
    return { confidence, difficulty, fusedFeatures }
  }
}

// Re-exported default config for convenience
import { DEFAULT_CALIBRATOR_CONFIG } from "./types"
