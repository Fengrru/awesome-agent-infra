/**
 * Metacog Calibrator — config types and defaults.
 * @module agent-metacog/calibrator-types
 */

export interface CalibratorConfig {
  hiddenDim: number
  numLayers: number
  numHeads: number
  dropoutRate: number
  streamWeights: { semantic: number; attention: number; likelihood: number }
  lossWeights: {
    semantic: number
    confidence: number
    difficulty: number
    calibration: number
    regularization: number
  }
  temperature: number
  numBins: number
  minSamplesPerBin: number
}

export interface StreamFeatures {
  hiddenStates: number[][]
  attentionEntropy: number[]
  tokenLogLikelihoods: number[]
}

export interface CalibrationResult {
  confidence: number
  difficulty: number
  rawConfidence: number
  ece: number
  brierScore: number
  tokenLevelConfidences: number[]
  binCounts: number[]
  binAccuracies: number[]
}

export interface TrainingHistory {
  epochs: number[]
  losses: number[]
  semanticLosses: number[]
  confidenceLosses: number[]
  calibrationErrors: number[]
  finalLoss: number
}

export interface BaselineResult {
  name: string
  method: string
  confidence: number
  ece: number
  brierScore: number
}

export const DEFAULT_CALIBRATOR_CONFIG: CalibratorConfig = {
  hiddenDim: 512,
  numLayers: 2,
  numHeads: 8,
  dropoutRate: 0.1,
  streamWeights: { semantic: 0.4, attention: 0.3, likelihood: 0.3 },
  lossWeights: {
    semantic: 0.1,
    confidence: 0.7,
    difficulty: 0.3,
    calibration: 0.2,
    regularization: 0.15,
  },
  temperature: 1.0,
  numBins: 10,
  minSamplesPerBin: 5,
}

export const DEFAULT_BASE_HIDDEN_SIZE = 4096
