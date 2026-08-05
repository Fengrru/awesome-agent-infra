# @fengrru/reasoning-search

[![npm version](https://img.shields.io/npm/v/@fengrru/reasoning-search)](https://www.npmjs.com/package/@fengrru/reasoning-search) [![npm downloads](https://img.shields.io/npm/dm/@fengrru/reasoning-search)](https://www.npmjs.com/package/@fengrru/reasoning-search) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)

MCTS tree search reasoning engine for AI agents.

## Install

```bash
npm install @fengrru/reasoning-search
```

## Quick Start

```typescript
import { ReasoningSearch } from "@fengrru/reasoning-search"

const search = new ReasoningSearch({
  provider: llmProvider,
  strategy: "mcts",
})

const result = await search.search({
  prompt: "Solve this math problem",
  maxIterations: 100,
})

console.log(result.bestPath) // reasoning chain
console.log(result.score) // confidence score
```

## Strategies

| Strategy | Description |
|----------|-------------|
| mcts | Monte Carlo Tree Search |
| standard_sampling | Single generation |
| guided_beam_search | Beam search with heuristic |
| importance_sampling | Weighted random sampling |

## Features

- **UCT value**: exploration vs exploitation
- **Softmax rewards**: temperature-based sampling
- **Adaptive floor**: decreases with depth
- **Completion detection**: math/code/logic patterns


## Documentation

- [API Reference](https://fengrru.github.io/awesome-agent-infra/api/) — TypeDoc-generated API docs
- [Source Code](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/reasoning-search)
- [Examples](https://github.com/Fengrru/awesome-agent-infra/tree/main/examples)
## License

MIT