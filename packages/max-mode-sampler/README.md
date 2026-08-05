# @fengrru/max-mode-sampler

[![npm version](https://img.shields.io/npm/v/@fengrru/max-mode-sampler)](https://www.npmjs.com/package/@fengrru/max-mode-sampler) [![npm downloads](https://img.shields.io/npm/dm/@fengrru/max-mode-sampler)](https://www.npmjs.com/package/@fengrru/max-mode-sampler) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)

> **Experimental** — API may break in minor versions. See [STABILITY.md](../../STABILITY.md).

Best-of-N parallel plan sampling for AI agent reasoning.

## Install

```bash
npm install @fengrru/max-mode-sampler
```

## Quick Start

```typescript
import { MaxModeSampler } from "@fengrru/max-mode-sampler"

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


## Documentation

- [API Reference](https://fengrru.github.io/awesome-agent-infra/api/) — TypeDoc-generated API docs
- [Source Code](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/max-mode-sampler)
- [Examples](https://github.com/Fengrru/awesome-agent-infra/tree/main/examples)

## License

MIT