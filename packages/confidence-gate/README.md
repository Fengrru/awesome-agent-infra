# @fengru/confidence-gate

[![npm version](https://img.shields.io/npm/v/@fengru/confidence-gate)](https://www.npmjs.com/package/@fengru/confidence-gate) [![npm downloads](https://img.shields.io/npm/dm/@fengru/confidence-gate)](https://www.npmjs.com/package/@fengru/confidence-gate) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)

> ⚠️ **Experimental** — API may break in minor versions. See [STABILITY.md](../../STABILITY.md).

LLM output confidence calibration with ECE scoring and temperature scaling.

## Install

```bash
npm install @fengru/confidence-gate
```

## Quick Start

```typescript
import { ConfidenceGate } from "@fengru/confidence-gate"

const gate = new ConfidenceGate()

// Fit calibration data
gate.fit([
  { confidence: 0.9, correct: true },
  { confidence: 0.7, correct: false },
  // ...
])

// Calibrate new prediction
const calibrated = gate.calibrate(0.85)
console.log(calibrated.confidence) // temperature-scaled value
console.log(calibrated.isOverconfident) // true if raw > calibrated
```

## Features

- **ECE scoring**: Expected Calibration Error
- **Brier score**: probabilistic accuracy
- **Temperature scaling**: T>1 softens, T<1 sharpens
- **Dynamic threshold**: find optimal decision boundary
- **Hallucination rate**: % high-confidence wrong answers


## Documentation

- [API Reference](https://fengrru.github.io/awesome-agent-infra/api/) — TypeDoc-generated API docs
- [Source Code](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/confidence-gate)
- [Examples](https://github.com/Fengrru/awesome-agent-infra/tree/main/examples)
## License

MIT