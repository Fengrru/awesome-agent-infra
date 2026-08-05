# @fengrru/process-reward

[![npm version](https://img.shields.io/npm/v/@fengrru/process-reward)](https://www.npmjs.com/package/@fengrru/process-reward) [![npm downloads](https://img.shields.io/npm/dm/@fengrru/process-reward)](https://www.npmjs.com/package/@fengrru/process-reward) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)

> **Experimental** — API may break in minor versions. See [STABILITY.md](../../STABILITY.md).

Process Reward Model with MC rollout labeling for AI agent reasoning.

## Install

```bash
npm install @fengrru/process-reward
```

## Quick Start

```typescript
import { ProcessRewardModel } from "@fengrru/process-reward"

const prm = new ProcessRewardModel()

// Score a reasoning step
const score = prm.scoreStep({
  type: "math",
  content: "x = 5 + 3",
  previousSteps: ["Given: x + 2 = 10"],
})

console.log(score.score) // 0-1
console.log(score.details) // scoring breakdown

// Batch scoring
const scores = prm.batchScoreSteps(steps)

// Monte Carlo labeling
const labels = prm.labelSteps(steps, { outcome: "correct" })
```

## Scoring Domains

| Domain | Heuristics |
|--------|------------|
| math | Equation validity, divide-by-zero, coherence |
| code | Function definition, syntax errors |
| logic | Premise introduction, conclusion markers |

## Features

- **MC rollout**: confidence from multiple simulations
- **Weak supervision**: heuristic labels when no MC
- **Cross-step coherence**: boosts consistent reasoning
- **Custom scorers**: register domain-specific evaluators


## Documentation

- [API Reference](https://fengrru.github.io/awesome-agent-infra/api/) — TypeDoc-generated API docs
- [Source Code](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/process-reward)
- [Examples](https://github.com/Fengrru/awesome-agent-infra/tree/main/examples)
## License

MIT