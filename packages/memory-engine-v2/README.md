# @fengru/memory-engine-v2

[![npm version](https://img.shields.io/npm/v/@fengru/memory-engine-v2)](https://www.npmjs.com/package/@fengru/memory-engine-v2) [![npm downloads](https://img.shields.io/npm/dm/@fengru/memory-engine-v2)](https://www.npmjs.com/package/@fengru/memory-engine-v2) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)

Zero-dependency 5-layer memory engine with sleep consolidation, meta-memory, and attention retrieval for AI agents.

## Quick Start

```ts
import { MemoryEngine, MemoryType } from "@fengru/memory-engine-v2"

const engine = new MemoryEngine()

engine.addMemory("User's name is Alice", MemoryType.SEMANTIC, 0.9)
engine.addMemory("User asked about weather yesterday", MemoryType.EPISODIC, 0.6)
engine.addMemory("Current task: build a memory engine", MemoryType.WORKING, 0.8)

// Recall memories
const results = engine.recall("What is the user's name?")
for (const [item, score] of results) {
  console.log(`[${item.memoryType}] ${item.content} (score: ${score.toFixed(2)})`)
}

// Get formatted context for LLM
const context = engine.getContext("user name", 500)
console.log(context)

// Run sleep consolidation
const result = engine.autoConsolidate()
if (result) {
  console.log(`Consolidated ${result.memoriesConsolidated} memories`)
}

// Get statistics
console.log(engine.getStatistics())
```

## Memory Layers

| Layer       | Description                              | Capacity   |
|-------------|------------------------------------------|------------|
| WORKING     | Active task memory, FIFO eviction         | 7 items    |
| SHORT_TERM  | Time-decay storage with half-life         | 100 items  |
| LONG_TERM   | Unlimited vector storage with TF-IDF      | Unlimited  |
| EPISODIC    | Timeline-based event storage              | Unlimited  |
| SEMANTIC    | Knowledge graph with entity relationships | Unlimited  |

## Sleep Consolidation

Emulates human sleep cycles to consolidate memories:

- **N3 (Slow Wave)**: Transfer important memories to long-term storage
- **REM**: Replay and strengthen memories probabilistically
- **Consolidation**: Create associations between similar memories
- **N1**: Forget weak memories below threshold

## Meta-Memory

Metacognitive monitoring that estimates confidence and makes retrieval decisions:

- **HIGH confidence**: Direct recall
- **MEDIUM confidence**: Augmented retrieval
- **LOW confidence**: Use external tools
- **VERY LOW confidence**: Model collaboration

## Attention Retrieval

Multi-factor attention-based retrieval using:

- **Importance** (30%): Memory importance score
- **Recency** (20%): Exponential decay based on age
- **Relevance** (40%): TF-IDF cosine similarity
- **Emotion** (10%): Emotional salience


## Documentation

- [API Reference](https://fengrru.github.io/awesome-agent-infra/api/) — TypeDoc-generated API docs
- [Source Code](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/memory-engine-v2)
- [Examples](https://github.com/Fengrru/awesome-agent-infra/tree/main/examples)
## License

MIT
