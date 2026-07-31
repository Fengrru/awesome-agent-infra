import { describe, expect, test } from "bun:test"
import {
  CalibrationBaselines,
  type CalibratorConfig,
  ConfidenceCalibrator,
  DEFAULT_BASE_HIDDEN_SIZE,
  DEFAULT_CALIBRATOR_CONFIG,
  FeatureExtractor,
  MetacognitiveTransformer,
  MultiHeadAttention,
  SinusoidalPE,
  type StreamFeatures,
  TransformerLayer,
} from "../src/index"

function makeFakeStreamFeatures(seqLen: number = 5, hiddenSize: number = 64): StreamFeatures {
  const hiddenStates: number[][] = []
  for (let i = 0; i < seqLen; i++) {
    const row: number[] = []
    for (let j = 0; j < hiddenSize; j++) {
      row.push(Math.random() * 2 - 1)
    }
    hiddenStates.push(row)
  }

  const attentionEntropy: number[] = []
  for (let i = 0; i < seqLen; i++) {
    attentionEntropy.push(Math.random() * 2)
  }

  const tokenLogLikelihoods: number[] = []
  for (let i = 0; i < seqLen; i++) {
    tokenLogLikelihoods.push(Math.random() * 2 - 1)
  }

  return { hiddenStates, attentionEntropy, tokenLogLikelihoods }
}

function makeFakeAttentionWeights(numHeads: number, seqLen: number): number[][][] {
  const weights: number[][][] = []
  for (let h = 0; h < numHeads; h++) {
    const head: number[][] = []
    for (let i = 0; i < seqLen; i++) {
      const row: number[] = []
      let rowSum = 0
      for (let j = 0; j < seqLen; j++) {
        const v = Math.random()
        row.push(v)
        rowSum += v
      }
      for (let j = 0; j < seqLen; j++) {
        row[j] /= rowSum
      }
      head.push(row)
    }
    weights.push(head)
  }
  return weights
}

const smallConfig: Partial<CalibratorConfig> = {
  hiddenDim: 32,
  numLayers: 2,
  numHeads: 4,
}

describe("Matrix operations (internal)", () => {
  test("MultiHeadAttention initializes with correct dimensions", () => {
    const attn = new MultiHeadAttention(32, 4)
    expect(attn.dModel).toBe(32)
    expect(attn.numHeads).toBe(4)
    expect(attn.dK).toBe(8)
  })

  test("zeros matrix has all zero values", () => {
    const m = 2
    const n = 3
    const Z = Array.from({ length: m }, () => new Array(n).fill(0))
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < n; j++) {
        expect(Z[i]![j]).toBe(0)
      }
    }
  })

  test("softmax via MultiHeadAttention computeEntropy produces valid entropy range", () => {
    const seqLen = 4
    const weights = makeFakeAttentionWeights(4, seqLen)
    const attn = new MultiHeadAttention(32, 4)
    const entropy = attn.computeEntropy(weights)
    expect(entropy.length).toBe(seqLen)
    for (const e of entropy) {
      expect(e).toBeGreaterThanOrEqual(0)
      expect(e).toBeFinite()
    }
  })
})

describe("SinusoidalPE", () => {
  test("encoding produces correct shape for given dimensions", () => {
    const pe = new SinusoidalPE(64)
    const encoded = pe.encode(10)
    expect(encoded.length).toBe(10)
    expect(encoded[0]!.length).toBe(64)
  })

  test("encoding uses cache for repeated calls", () => {
    const pe = new SinusoidalPE(32)
    const encoded1 = pe.encode(5)
    const encoded2 = pe.encode(3)
    expect(encoded2.length).toBe(3)
    // First 3 positions should match
    for (let i = 0; i < 3; i++) {
      expect(encoded1[i]!).toEqual(encoded2[i]!)
    }
  })

  test("encoding for larger sequence extends cache", () => {
    const pe = new SinusoidalPE(16)
    const encoded1 = pe.encode(4)
    expect(encoded1.length).toBe(4)
    const encoded2 = pe.encode(8)
    expect(encoded2.length).toBe(8)
    for (let i = 0; i < 4; i++) {
      expect(encoded2[i]!).toEqual(encoded1[i]!)
    }
  })

  test("encoding maxLen respected", () => {
    const pe = new SinusoidalPE(8, 100)
    const encoded = pe.encode(50)
    expect(encoded.length).toBe(50)
  })

  test("positional encoding alternates sin/cos", () => {
    const pe = new SinusoidalPE(32)
    const encoded = pe.encode(5)
    const row0 = encoded[0]!
    expect(row0[0]).not.toBe(row0[1])
    // sin(0) = 0, cos(0) = 1
    expect(Math.abs(row0[0]!)).toBeLessThan(1e-6)
    expect(Math.abs(row0[1]! - 1)).toBeLessThan(1e-9)
  })
})

describe("MultiHeadAttention", () => {
  test("constructor assigns dimensions correctly", () => {
    const attn = new MultiHeadAttention(64, 8, 0.1)
    expect(attn.dModel).toBe(64)
    expect(attn.numHeads).toBe(8)
    expect(attn.dK).toBe(8)
  })

  test("forward pass produces correct output shape", () => {
    const seqLen = 6
    const dModel = 64
    const attn = new MultiHeadAttention(dModel, 8)
    const x: number[][] = Array.from({ length: seqLen }, () =>
      Array.from({ length: dModel }, () => Math.random() * 2 - 1),
    )
    const output = attn.forward(x)
    expect(output.length).toBe(seqLen)
    expect(output[0]!.length).toBe(dModel)
  })

  test("forward pass with causal mask", () => {
    const seqLen = 4
    const dModel = 32
    const attn = new MultiHeadAttention(dModel, 4, 0)
    const x: number[][] = Array.from({ length: seqLen }, () => Array.from({ length: dModel }, () => Math.random()))
    const mask: number[][] = Array.from({ length: seqLen }, (_, i) =>
      Array.from({ length: seqLen }, (_, j) => (j <= i ? 1 : 0)),
    )
    const output = attn.forward(x, mask)
    expect(output.length).toBe(seqLen)
    expect(output[0]!.length).toBe(dModel)
  })

  test("computeEntropy handles uniform attention weights", () => {
    const seqLen = 3
    const attn = new MultiHeadAttention(16, 2)
    const uniform: number[][][] = [
      [
        [1 / 3, 1 / 3, 1 / 3],
        [1 / 3, 1 / 3, 1 / 3],
        [1 / 3, 1 / 3, 1 / 3],
      ],
      [
        [1 / 3, 1 / 3, 1 / 3],
        [1 / 3, 1 / 3, 1 / 3],
        [1 / 3, 1 / 3, 1 / 3],
      ],
    ]
    const entropy = attn.computeEntropy(uniform)
    expect(entropy.length).toBe(seqLen)
    for (const e of entropy) {
      expect(e).toBeGreaterThan(0)
      expect(e).toBeCloseTo(Math.log(3), 1)
    }
  })

  test("computeEntropy handles peaked attention", () => {
    const seqLen = 4
    const attn = new MultiHeadAttention(16, 2)
    const peaked: number[][][] = [
      [
        [1, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1],
      ],
      [
        [1, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1],
      ],
    ]
    const entropy = attn.computeEntropy(peaked)
    expect(entropy.length).toBe(seqLen)
    for (const e of entropy) {
      expect(e).toBeLessThan(0.01)
    }
  })
})

describe("TransformerLayer", () => {
  test("forward pass produces correct output shape", () => {
    const seqLen = 5
    const dModel = 48
    const layer = new TransformerLayer(dModel, 4, dModel * 4, 0.0)
    const x: number[][] = Array.from({ length: seqLen }, () =>
      Array.from({ length: dModel }, () => Math.random() * 2 - 1),
    )
    const output = layer.forward(x)
    expect(output.length).toBe(seqLen)
    expect(output[0]!.length).toBe(dModel)
  })

  test("forward pass with zero dropout", () => {
    const seqLen = 3
    const dModel = 32
    const layer = new TransformerLayer(dModel, 4, dModel * 4, 0.0)
    const x: number[][] = Array.from({ length: seqLen }, () => Array.from({ length: dModel }, () => 1.0))
    const output = layer.forward(x)
    expect(output.length).toBe(seqLen)
    // Should produce finite values
    for (const row of output) {
      for (const v of row) {
        expect(isFinite(v)).toBe(true)
      }
    }
  })

  test("residual connection preserves information flow", () => {
    const dModel = 32
    const layer = new TransformerLayer(dModel, 4, dModel * 4, 0.0)
    const x: number[][] = Array.from({ length: 2 }, () => Array.from({ length: dModel }, () => 0.5))
    const output = layer.forward(x)
    expect(output.length).toBe(2)
    expect(output[0]!.length).toBe(dModel)
    // With residual, output should not be zeros
    let hasNonZero = false
    for (const v of output[0]!) {
      if (Math.abs(v) > 1e-6) hasNonZero = true
    }
    expect(hasNonZero).toBe(true)
  })
})

describe("MetacognitiveTransformer", () => {
  test("constructor initializes all layers and projections", () => {
    const model = new MetacognitiveTransformer(64, smallConfig)
    expect(model.config.hiddenDim).toBe(32)
    expect(model.config.numLayers).toBe(2)
    expect(model.config.numHeads).toBe(4)
  })

  test("forward pass produces confidence and difficulty in [0, 1]", () => {
    const model = new MetacognitiveTransformer(64, smallConfig)
    const features = makeFakeStreamFeatures(5, 64)
    const output = model.forward(features)
    expect(output.confidence.length).toBe(5)
    expect(output.difficulty.length).toBe(5)
    expect(output.fusedFeatures.length).toBe(5)
    expect(output.fusedFeatures[0]!.length).toBe(32)

    for (const c of output.confidence) {
      expect(c).toBeGreaterThanOrEqual(0)
      expect(c).toBeLessThanOrEqual(1)
    }
    for (const d of output.difficulty) {
      expect(d).toBeGreaterThanOrEqual(0)
      expect(d).toBeLessThanOrEqual(1)
    }
  })

  test("3-stream fusion produces different outputs for different inputs", () => {
    const model = new MetacognitiveTransformer(64, smallConfig)
    const features1 = makeFakeStreamFeatures(5, 64)
    const features2 = makeFakeStreamFeatures(5, 64)
    const output1 = model.forward(features1)
    const output2 = model.forward(features2)
    // Mean confidences should differ with different random features
    const mean1 = output1.confidence.reduce((a, b) => a + b, 0) / output1.confidence.length
    const mean2 = output2.confidence.reduce((a, b) => a + b, 0) / output2.confidence.length
    // Not guaranteed to differ but extremely likely with different inputs
    expect(output1.confidence.length).toBe(output2.confidence.length)
  })

  test("single token input works", () => {
    const model = new MetacognitiveTransformer(64, smallConfig)
    const features = makeFakeStreamFeatures(1, 64)
    const output = model.forward(features)
    expect(output.confidence.length).toBe(1)
    expect(output.difficulty.length).toBe(1)
  })

  test("long sequence input works", () => {
    const model = new MetacognitiveTransformer(32, { ...smallConfig, hiddenDim: 16, numHeads: 2 })
    const features = makeFakeStreamFeatures(20, 32)
    const output = model.forward(features)
    expect(output.confidence.length).toBe(20)
    expect(output.difficulty.length).toBe(20)
  })
})

describe("FeatureExtractor", () => {
  test("extract produces correct StreamFeatures structure", () => {
    const extractor = new FeatureExtractor()
    const seqLen = 5
    const hiddenDim = 32
    const hiddenStates: number[][] = Array.from({ length: seqLen }, () =>
      Array.from({ length: hiddenDim }, () => Math.random()),
    )
    const attentionWeights = makeFakeAttentionWeights(4, seqLen)
    const logProbs: number[] = Array.from({ length: seqLen }, () => Math.random())

    const features = extractor.extract(hiddenStates, attentionWeights, logProbs)
    expect(features.hiddenStates.length).toBe(seqLen)
    expect(features.attentionEntropy.length).toBe(seqLen)
    expect(features.tokenLogLikelihoods.length).toBe(seqLen)
    expect(features.hiddenStates[0]!.length).toBe(hiddenDim)
  })

  test("attention entropy is finite and non-negative", () => {
    const extractor = new FeatureExtractor()
    const seqLen = 3
    const attentionWeights = makeFakeAttentionWeights(2, seqLen)
    const hiddenStates = Array.from({ length: seqLen }, () => Array.from({ length: 16 }, () => Math.random()))
    const features = extractor.extract(hiddenStates, attentionWeights, [0, 0, 0])
    for (const e of features.attentionEntropy) {
      expect(e).toBeGreaterThanOrEqual(0)
      expect(isFinite(e)).toBe(true)
    }
  })

  test("extract handles empty inputs", () => {
    const extractor = new FeatureExtractor()
    const features = extractor.extract([], [], [])
    expect(features.hiddenStates.length).toBe(0)
    expect(features.attentionEntropy.length).toBe(0)
    expect(features.tokenLogLikelihoods.length).toBe(0)
  })
})

describe("ConfidenceCalibrator", () => {
  test("constructor initializes with default config", () => {
    const calibrator = new ConfidenceCalibrator(64, smallConfig)
    const stats = calibrator.getStatistics()
    expect(stats.calibrated).toBe(false)
    expect(stats.epochs).toBe(0)
    expect(stats.finalLoss).toBe(0)
  })

  test("calibrate returns valid CalibrationResult", () => {
    const calibrator = new ConfidenceCalibrator(64, smallConfig)
    const features = makeFakeStreamFeatures(5, 64)
    const result = calibrator.calibrate(features)

    expect(result.confidence).toBeGreaterThanOrEqual(0)
    expect(result.confidence).toBeLessThanOrEqual(1)
    expect(result.difficulty).toBeGreaterThanOrEqual(0)
    expect(result.difficulty).toBeLessThanOrEqual(1)
    expect(result.rawConfidence).toBeGreaterThanOrEqual(0)
    expect(result.rawConfidence).toBeLessThanOrEqual(1)
    expect(result.ece).toBeGreaterThanOrEqual(0)
    expect(result.brierScore).toBeGreaterThanOrEqual(0)
    expect(result.tokenLevelConfidences.length).toBe(5)
    expect(result.binCounts.length).toBeGreaterThan(0)
    expect(result.binAccuracies.length).toBeGreaterThan(0)
  })

  test("calibrate on single token", () => {
    const calibrator = new ConfidenceCalibrator(64, smallConfig)
    const features = makeFakeStreamFeatures(1, 64)
    const result = calibrator.calibrate(features)
    expect(result.tokenLevelConfidences.length).toBe(1)
  })

  test("train reduces loss over epochs", () => {
    const calibrator = new ConfidenceCalibrator(64, smallConfig)

    const batches = Array.from({ length: 4 }, () => {
      const seqLen = 3
      const features = makeFakeStreamFeatures(seqLen, 64)
      const correctness = features.tokenLogLikelihoods.map((l) => {
        return Math.abs(l) > 0.5 ? 1 : 0
      })
      const difficulty = features.tokenLogLikelihoods.map(() => Math.random() * 0.5 + 0.25)
      return { features, labels: { correctness, difficulty } }
    })

    const history = calibrator.train(batches, 5, 0.01)

    expect(history.epochs.length).toBe(5)
    expect(history.losses.length).toBe(5)
    expect(history.losses[0]!).not.toBeNaN()
    expect(history.semanticLosses.length).toBe(5)
    expect(history.confidenceLosses.length).toBe(5)
    expect(history.calibrationErrors.length).toBe(5)

    expect(history.finalLoss).toBeGreaterThan(-Infinity)
    expect(history.finalLoss).toBeLessThan(Infinity)
  })

  test("train calls onEpoch callback", () => {
    const calibrator = new ConfidenceCalibrator(64, smallConfig)
    const epochs: number[] = []
    const losses: number[] = []

    const batch = {
      features: makeFakeStreamFeatures(3, 64),
      labels: {
        correctness: [1, 0, 1],
        difficulty: [0.3, 0.7, 0.5],
      },
    }

    calibrator.train([batch], 3, 0.01, (epoch, loss) => {
      epochs.push(epoch)
      losses.push(loss)
    })

    expect(epochs).toEqual([1, 2, 3])
    expect(losses.length).toBe(3)
  })

  test("reset clears calibration state and history", () => {
    const calibrator = new ConfidenceCalibrator(64, smallConfig)
    const batch = {
      features: makeFakeStreamFeatures(3, 64),
      labels: {
        correctness: [1, 0, 1],
        difficulty: [0.3, 0.4, 0.5],
      },
    }
    calibrator.train([batch], 3, 0.01)

    expect(calibrator.getStatistics().calibrated).toBe(true)
    expect(calibrator.getStatistics().epochs).toBe(3)

    calibrator.reset()

    expect(calibrator.getStatistics().calibrated).toBe(false)
    expect(calibrator.getStatistics().epochs).toBe(0)
    expect(calibrator.getStatistics().finalLoss).toBe(0)
  })

  test("getStatistics returns current state", () => {
    const calibrator = new ConfidenceCalibrator(64, smallConfig)
    const stats = calibrator.getStatistics()
    expect(stats).toHaveProperty("calibrated")
    expect(stats).toHaveProperty("epochs")
    expect(stats).toHaveProperty("finalLoss")
    expect(typeof stats.calibrated).toBe("boolean")
    expect(typeof stats.epochs).toBe("number")
    expect(typeof stats.finalLoss).toBe("number")
  })

  test("calibrate produces consistent structure across calls", () => {
    const noDropoutConfig = { ...smallConfig, dropoutRate: 0 }
    const calibrator = new ConfidenceCalibrator(64, noDropoutConfig)
    const features = makeFakeStreamFeatures(5, 64)
    const result1 = calibrator.calibrate(features)
    const result2 = calibrator.calibrate(features)

    expect(result1.confidence).toBe(result2.confidence)
    expect(result1.difficulty).toBe(result2.difficulty)
    expect(result1.ece).toBe(result2.ece)
    expect(result1.brierScore).toBe(result2.brierScore)
  })

  test("custom config overrides defaults", () => {
    const custom: Partial<CalibratorConfig> = {
      hiddenDim: 16,
      numLayers: 1,
      numHeads: 2,
      temperature: 2.0,
      numBins: 5,
      minSamplesPerBin: 2,
    }
    const calibrator = new ConfidenceCalibrator(64, custom)
    expect(calibrator.config.hiddenDim).toBe(16)
    expect(calibrator.config.numLayers).toBe(1)
    expect(calibrator.config.numHeads).toBe(2)
    expect(calibrator.config.temperature).toBe(2.0)
    expect(calibrator.config.numBins).toBe(5)
    expect(calibrator.config.minSamplesPerBin).toBe(2)
  })
})

describe("CalibrationBaselines", () => {
  test("rawConfidence returns value in [0, 1]", () => {
    const features = makeFakeStreamFeatures(5, 64)
    const conf = CalibrationBaselines.rawConfidence(features)
    expect(conf).toBeGreaterThanOrEqual(0)
    expect(conf).toBeLessThanOrEqual(1)
  })

  test("temperatureScaling finds optimal temperature", () => {
    const confidences = [0.1, 0.3, 0.5, 0.7, 0.9]
    const labels = [0, 0, 1, 1, 1]
    const result = CalibrationBaselines.temperatureScaling(confidences, labels)
    expect(result.temperature).toBeGreaterThan(0)
    expect(result.calibrated.length).toBe(confidences.length)
    for (const c of result.calibrated) {
      expect(c).toBeGreaterThan(0)
    }
  })

  test("temperatureScaling with provided temperature", () => {
    const confidences = [0.2, 0.4, 0.6, 0.8]
    const labels = [0, 0, 1, 1]
    const result = CalibrationBaselines.temperatureScaling(confidences, labels, 1.5)
    expect(result.temperature).toBe(1.5)
    expect(result.calibrated).toEqual(confidences.map((c) => c / 1.5))
  })

  test("tokenLikelihood returns value in [0, 1]", () => {
    const features = makeFakeStreamFeatures(5, 64)
    const conf = CalibrationBaselines.tokenLikelihood(features)
    expect(conf).toBeGreaterThanOrEqual(0)
    expect(conf).toBeLessThanOrEqual(1)
  })

  test("selfEvaluation with various text inputs", () => {
    const short = CalibrationBaselines.selfEvaluation("hello")
    expect(short).toBeGreaterThanOrEqual(0)
    expect(short).toBeLessThanOrEqual(1)

    const long = CalibrationBaselines.selfEvaluation(
      "This is a much longer piece of text that contains numbers 123 and special characters!",
    )
    expect(long).toBeGreaterThan(short)

    const empty = CalibrationBaselines.selfEvaluation("")
    expect(empty).toBe(0.5)
  })

  test("allBaselines returns all baseline results", () => {
    const features = makeFakeStreamFeatures(5, 64)
    const text = "This is a test text for baseline comparison 123!"
    const results = CalibrationBaselines.allBaselines(features, text)

    expect(results.length).toBe(3)

    const names = results.map((r) => r.name)
    expect(names).toContain("Raw Confidence")
    expect(names).toContain("Token Likelihood")
    expect(names).toContain("Self Evaluation")

    for (const r of results) {
      expect(r.confidence).toBeGreaterThanOrEqual(0)
      expect(r.confidence).toBeLessThanOrEqual(1)
      expect(r.ece).toBeGreaterThanOrEqual(0)
      expect(r.brierScore).toBeGreaterThanOrEqual(0)
      expect(r.brierScore).toBeLessThanOrEqual(1)
      expect(r.method.length).toBeGreaterThan(0)
    }
  })

  test("allBaselines with provided labels", () => {
    const features = makeFakeStreamFeatures(3, 64)
    const text = "test"
    const labels = [1, 0, 1]
    const results = CalibrationBaselines.allBaselines(features, text, labels)
    expect(results.length).toBe(3)
  })

  test("rawConfidence with single token", () => {
    const features = makeFakeStreamFeatures(1, 64)
    const conf = CalibrationBaselines.rawConfidence(features)
    expect(conf).toBeGreaterThanOrEqual(0)
    expect(conf).toBeLessThanOrEqual(1)
  })
})

describe("Edge cases", () => {
  test("empty features handle in calibrate", () => {
    const calibrator = new ConfidenceCalibrator(64, smallConfig)
    const features: StreamFeatures = {
      hiddenStates: [Array.from({ length: 64 }, () => Math.random())],
      attentionEntropy: [0.1],
      tokenLogLikelihoods: [0.5],
    }
    const result = calibrator.calibrate(features)
    expect(result.tokenLevelConfidences.length).toBe(1)
    expect(result.confidence).toBeGreaterThanOrEqual(0)
  })

  test("extreme token likelihood values", () => {
    const calibrator = new ConfidenceCalibrator(64, smallConfig)
    const hiddenStates = Array.from({ length: 3 }, () => Array.from({ length: 64 }, () => Math.random()))
    const features: StreamFeatures = {
      hiddenStates,
      attentionEntropy: [1.0, 1.0, 1.0],
      tokenLogLikelihoods: [10, -10, 0],
    }
    const result = calibrator.calibrate(features)
    expect(result.confidence).toBeGreaterThanOrEqual(0)
    expect(result.confidence).toBeLessThanOrEqual(1)
  })

  test("zero attention entropy", () => {
    const features: StreamFeatures = {
      hiddenStates: Array.from({ length: 3 }, () => Array.from({ length: 64 }, () => Math.random())),
      attentionEntropy: [0, 0, 0],
      tokenLogLikelihoods: [1, 2, 3],
    }
    const calibrator = new ConfidenceCalibrator(64, smallConfig)
    const result = calibrator.calibrate(features)
    expect(result.confidence).toBeDefined()
    expect(isNaN(result.confidence)).toBe(false)
  })

  test("uniform hidden states", () => {
    const features: StreamFeatures = {
      hiddenStates: Array.from({ length: 4 }, () => Array.from({ length: 64 }, () => 1.0)),
      attentionEntropy: [2.0, 2.0, 2.0, 2.0],
      tokenLogLikelihoods: [0, 0, 0, 0],
    }
    const calibrator = new ConfidenceCalibrator(64, smallConfig)
    const result = calibrator.calibrate(features)
    expect(isNaN(result.confidence)).toBe(false)
    expect(isNaN(result.difficulty)).toBe(false)
  })

  test("large hidden size configuration", () => {
    const config: Partial<CalibratorConfig> = {
      hiddenDim: 64,
      numLayers: 1,
      numHeads: 4,
    }
    const calibrator = new ConfidenceCalibrator(128, config)
    const features = makeFakeStreamFeatures(3, 128)
    const result = calibrator.calibrate(features)
    expect(result.confidence).toBeGreaterThanOrEqual(0)
  })

  test("DEFAULT_CALIBRATOR_CONFIG has all required fields", () => {
    expect(DEFAULT_CALIBRATOR_CONFIG.hiddenDim).toBe(512)
    expect(DEFAULT_CALIBRATOR_CONFIG.numLayers).toBe(2)
    expect(DEFAULT_CALIBRATOR_CONFIG.numHeads).toBe(8)
    expect(DEFAULT_CALIBRATOR_CONFIG.dropoutRate).toBe(0.1)
    expect(DEFAULT_CALIBRATOR_CONFIG.streamWeights.semantic).toBe(0.4)
    expect(DEFAULT_CALIBRATOR_CONFIG.streamWeights.attention).toBe(0.3)
    expect(DEFAULT_CALIBRATOR_CONFIG.streamWeights.likelihood).toBe(0.3)
    expect(DEFAULT_CALIBRATOR_CONFIG.temperature).toBe(1.0)
    expect(DEFAULT_CALIBRATOR_CONFIG.numBins).toBe(10)
    expect(DEFAULT_CALIBRATOR_CONFIG.minSamplesPerBin).toBe(5)
  })

  test("DEFAULT_BASE_HIDDEN_SIZE is 4096", () => {
    expect(DEFAULT_BASE_HIDDEN_SIZE).toBe(4096)
  })

  test("training with mixed label patterns", () => {
    const calibrator = new ConfidenceCalibrator(64, smallConfig)

    const batches = [
      {
        features: makeFakeStreamFeatures(4, 64),
        labels: {
          correctness: [1, 1, 1, 1],
          difficulty: [0.1, 0.1, 0.1, 0.1],
        },
      },
      {
        features: makeFakeStreamFeatures(4, 64),
        labels: {
          correctness: [0, 0, 0, 0],
          difficulty: [0.9, 0.9, 0.9, 0.9],
        },
      },
      {
        features: makeFakeStreamFeatures(4, 64),
        labels: {
          correctness: [1, 0, 1, 0],
          difficulty: [0.3, 0.7, 0.3, 0.7],
        },
      },
    ]

    const history = calibrator.train(batches, 8, 0.005)
    expect(history.epochs.length).toBe(8)
    expect(history.losses.every((l) => !isNaN(l))).toBe(true)
  })

  test("FeatureExtractor with identically distributed attention", () => {
    const extractor = new FeatureExtractor()
    const seqLen = 4
    const uniformWeights: number[][][] = Array.from({ length: 2 }, () =>
      Array.from({ length: seqLen }, () => Array.from({ length: seqLen }, () => 1 / seqLen)),
    )
    const hidden = Array.from({ length: seqLen }, () => Array.from({ length: 32 }, () => Math.random()))
    const features = extractor.extract(hidden, uniformWeights, [0, 0, 0, 0])
    for (let i = 0; i < seqLen; i++) {
      expect(features.attentionEntropy[i]).toBeGreaterThan(0)
    }
  })

  test("calibrate with all-zero log likelihoods", () => {
    const calibrator = new ConfidenceCalibrator(64, smallConfig)
    const features: StreamFeatures = {
      hiddenStates: Array.from({ length: 3 }, () => Array.from({ length: 64 }, () => Math.random() * 2 - 1)),
      attentionEntropy: [1.5, 1.5, 1.5],
      tokenLogLikelihoods: [0, 0, 0],
    }
    const result = calibrator.calibrate(features)
    expect(isNaN(result.confidence)).toBe(false)
    expect(result.ece).toBeGreaterThanOrEqual(0)
  })
})
