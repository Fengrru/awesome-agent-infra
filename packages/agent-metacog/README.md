# @fengrru/agent-metacog

[![npm version](https://img.shields.io/npm/v/@fengrru/agent-metacog)](https://www.npmjs.com/package/@fengrru/agent-metacog) [![npm downloads](https://img.shields.io/npm/dm/@fengrru/agent-metacog)](https://www.npmjs.com/package/@fengrru/agent-metacog) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)

> **Experimental** — API may break in minor versions. See [STABILITY.md](../../STABILITY.md).

Metacognitive monitoring and confidence calibration for AI agents. Tracks knowledge boundaries and forgetting, and fuses 3 information streams (semantic features, attention entropy, and token likelihoods) through a lightweight transformer to produce calibrated confidence scores.

> Scope note: this package covers metacognitive *training-time* monitoring and calibration.
> For runtime output gating (accept/reject decisions on live LLM outputs), use
> [`@fengrru/confidence-gate`](../confidence-gate).

## Install

```bash
npm install @fengrru/agent-metacog
```

## Quick Start

```typescript
import { AgentMetacog } from "@fengrru/agent-metacog"

const metacog = new AgentMetacog()

// Record interactions
metacog.recordInteraction({
  domain: "typescript",
  success: true,
  timestamp: Date.now(),
})

// Check knowledge boundaries
const gaps = metacog.detectKnowledgeGaps()
// gaps: [{ domain: "rust", severity: 0.8, ... }]

// Detect forgetting
const alerts = metacog.detectForgetting()
// alerts: [{ domain: "python", lastAccess: ..., ... }]

// Self-reflection
const reflection = metacog.selfReflect()
```

### Confidence calibration

```typescript
import {
  ConfidenceCalibrator,
  FeatureExtractor,
  CalibrationBaselines,
  DEFAULT_BASE_HIDDEN_SIZE,
} from "@fengrru/agent-metacog"

// Create calibrator (base model hidden size, optional config)
const calibrator = new ConfidenceCalibrator(DEFAULT_BASE_HIDDEN_SIZE)

// Extract 3-stream features from raw model outputs
const extractor = new FeatureExtractor()
const features = extractor.extract(hiddenStates, attentionWeights, logProbs)

// Calibrate confidence
const result = calibrator.calibrate(features)
console.log(`Confidence: ${result.confidence.toFixed(3)}`)
console.log(`ECE: ${result.ece.toFixed(4)}`)

// Train and compare against baselines
const history = calibrator.train(batches, 20, 0.001)
const baselines = CalibrationBaselines.allBaselines(features, "response text")
```

## Features

- **Ebbinghaus retention**: forgetting curve modeling
- **Knowledge boundary**: separates known from unknown
- **Forgetting detection**: alerts for stale domains
- **Consolidation queue**: prioritized review tasks
- **Self-reflection**: generates meaningful insights
- **3-stream calibration**: semantic + attention entropy + token likelihood fusion
- **Transformer-based**: 2-layer Pre-LN transformer with multi-head attention
- **ECE & Brier score**: calibration quality metrics with temperature-scaling baselines


## Documentation

- [API Reference](https://fengrru.github.io/awesome-agent-infra/api/) — TypeDoc-generated API docs
- [Source Code](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/agent-metacog)
- [Examples](https://github.com/Fengrru/awesome-agent-infra/tree/main/examples)
## License

MIT