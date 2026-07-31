# @fengru/agent-checkpoint

[![npm version](https://img.shields.io/npm/v/@fengru/agent-checkpoint)](https://www.npmjs.com/package/@fengru/agent-checkpoint) [![npm downloads](https://img.shields.io/npm/dm/@fengru/agent-checkpoint)](https://www.npmjs.com/package/@fengru/agent-checkpoint) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)

> ⚠️ **Experimental** — API may break in minor versions. See [STABILITY.md](../../STABILITY.md).

3-level checkpoint system (L1/L2/L3) for agent state persistence.

## Install

```bash
npm install @fengru/agent-checkpoint
```

## Quick Start

```typescript
import { CheckpointManager } from "@fengru/agent-checkpoint"

const manager = new CheckpointManager({ outputDir: "./checkpoints" })

// Create checkpoint
const checkpoint = manager.create({
  stateMachine: { state: "EXECUTING", ... },
  dag: currentDAG,
  context: currentContext,
  memory: memoryPointers,
})

// Resume from checkpoint
const state = manager.resume(checkpoint.id)
```

## Checkpoint Levels

| Level | Contents | Frequency |
|-------|----------|-----------|
| L1 | State machine + DAG progress | Every step |
| L2 | L1 + context summary + full DAG | Key milestones |
| L3 | L1 + L2 + all state | Cross-session |

## Features

- **LRU cache**: fast access to recent checkpoints
- **Workspace hash**: detects file changes
- **Git HEAD hash**: code version consistency
- **Chain fallback**: L1 → L2 → L3 resume


## Documentation

- [API Reference](https://fengrru.github.io/awesome-agent-infra/api/) — TypeDoc-generated API docs
- [Source Code](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/agent-checkpoint)
- [Examples](https://github.com/Fengrru/awesome-agent-infra/tree/main/examples)
## License

MIT