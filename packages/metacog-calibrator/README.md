# @fengru/metacog-calibrator

Zero-dependency metacognitive confidence calibrator for AI agents. Fuses 3 information streams (semantic features, attention entropy, and token likelihoods) through a lightweight transformer to produce calibrated confidence scores and difficulty estimates.

## Features

- **3-Stream Feature Fusion**: Semantic hidden states + attention entropy + token log-likelihoods
- **Transformer-Based Architecture**: 2-layer Pre-LN transformer with multi-head attention
- **Dual-Head Output**: Confidence and difficulty prediction per token
- **ECE & Brier Score**: Expected Calibration Error and Brier score computation
- **Temperature Scaling**: Post-hoc calibration with optimal temperature search
- **Zero Dependencies**: All matrix operations implemented from scratch
- **Training Simulation**: Simulated training loop with multi-task loss

## Install

```bash
npm install @fengru/metacog-calibrator
```

## Usage

```typescript
import {
  ConfidenceCalibrator,
  FeatureExtractor,
  CalibrationBaselines,
  DEFAULT_BASE_HIDDEN_SIZE,
} from "@fengru/metacog-calibrator"

// Create calibrator (base model hidden size, optional config)
const calibrator = new ConfidenceCalibrator(DEFAULT_BASE_HIDDEN_SIZE)

// Extract 3-stream features from raw model outputs
const extractor = new FeatureExtractor()
const features = extractor.extract(hiddenStates, attentionWeights, logProbs)

// Calibrate confidence
const result = calibrator.calibrate(features)
console.log(`Confidence: ${result.confidence.toFixed(3)}`)
console.log(`Difficulty: ${result.difficulty.toFixed(3)}`)
console.log(`ECE: ${result.ece.toFixed(4)}`)
console.log(`Brier: ${result.brierScore.toFixed(4)}`)
```

### Training

```typescript
const calibrator = new ConfidenceCalibrator(4096, {
  hiddenDim: 256,
  numLayers: 2,
  numHeads: 4,
})

const history = calibrator.train(
  batches,
  20,     // epochs
  0.001,  // learning rate
  (epoch, loss) => console.log(`Epoch ${epoch}: loss=${loss.toFixed(4)}`)
)

console.log(`Final loss: ${history.finalLoss.toFixed(4)}`)
```

### Baselines

```typescript
const baselines = CalibrationBaselines.allBaselines(features, "response text")
for (const b of baselines) {
  console.log(`${b.name}: conf=${b.confidence.toFixed(3)} ece=${b.ece.toFixed(4)}`)
}
```

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `hiddenDim` | 512 | Projection dimension |
| `numLayers` | 2 | Transformer layers |
| `numHeads` | 8 | Attention heads |
| `dropoutRate` | 0.1 | Dropout rate |
| `streamWeights` | `{ semantic: 0.4, attention: 0.3, likelihood: 0.3 }` | Stream fusion weights |
| `temperature` | 1.0 | Temperature scaling factor |
| `numBins` | 10 | ECE calibration bins |
| `minSamplesPerBin` | 5 | Min samples per bin |

## License

MIT
