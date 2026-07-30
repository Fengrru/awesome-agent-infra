# @fengru/max-mode-sampler

Best-of-N parallel plan sampling for AI agent reasoning.

## Install

```bash
npm install @fengru/max-mode-sampler
```

## Quick Start

```typescript
import { MaxModeSampler } from "@fengru/max-mode-sampler"

const sampler = new MaxModeSampler({
  candidateCount: 5,
  exploreTemperature: 1.0,
  judgeTemperature: 0.0,
})

const result = await sampler.sample({
  prompt: "Solve this problem",
  provider: llmProvider,
  scoreFn: (candidate) => scoreCandidate(candidate),
})

console.log(result.best) // highest scoring candidate
console.log(result.scores) // all candidate scores
```

## Scoring Dimensions

| Dimension | Weight |
|-----------|--------|
| Feasibility | 30% |
| Completeness | 25% |
| Efficiency | 25% |
| Safety | 15% |
| Clarity | 5% |

## Features

- **Explore-exploit separation**: generate at T=1.0, judge at T=0
- **Parallel generation**: Promise.allSettled for fault tolerance
- **Heuristic fallback**: when LLM fails

## License

MIT