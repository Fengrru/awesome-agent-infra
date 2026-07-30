# @fengru/reasoning-search

MCTS tree search reasoning engine for AI agents.

## Install

```bash
npm install @fengru/reasoning-search
```

## Quick Start

```typescript
import { ReasoningSearch } from "@fengru/reasoning-search"

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

## License

MIT