# @fengru/process-reward

Process Reward Model with MC rollout labeling for AI agent reasoning.

## Install

```bash
npm install @fengru/process-reward
```

## Quick Start

```typescript
import { ProcessRewardModel } from "@fengru/process-reward"

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

## License

MIT