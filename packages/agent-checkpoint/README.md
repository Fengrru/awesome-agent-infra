# @fengru/agent-checkpoint

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

## License

MIT