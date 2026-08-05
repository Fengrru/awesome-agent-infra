# @fengrru/cycle-controller

[![npm version](https://img.shields.io/npm/v/@fengrru/cycle-controller)](https://www.npmjs.com/package/@fengrru/cycle-controller) [![npm downloads](https://img.shields.io/npm/dm/@fengrru/cycle-controller)](https://www.npmjs.com/package/@fengrru/cycle-controller) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)

> **Experimental** — API may break in minor versions. See [STABILITY.md](../../STABILITY.md).

Context window cycle manager for AI agents. Monitors token utilization and triggers checkpoints at thresholds (20%, 45%, 70%) and context rebuild at 90%.

## Quick Start

```ts
import { CycleController } from "@fengrru/cycle-controller"

const controller = new CycleController()

// Evaluate token usage every step
const action = controller.evaluate(80000, 128000, "session-1", history)

if (action.type === "CHECKPOINT") {
  await controller.executeCheckpoint("session-1", history, action)
} else if (action.type === "REBUILD") {
  await controller.executeRebuild("session-1", action)
}

controller.advanceStep()
```

## Configuration

```ts
const controller = new CycleController({
  config: {
    tokenBudget: 200_000,
    checkpointThresholds: [0.20, 0.45, 0.70],
    rebuildThreshold: 0.90,
    minStepsBetweenCheckpoints: 5,
    maxCycles: 20,
  },
  eventBus: myEventBus,         // optional @fengrru/event-bus instance
  stateMachine: myStateMachine, // optional @fengrru/state-machine instance
  checkpointWriter: myWriter,   // optional ICheckpointWriter
  callbacks: {
    onRebuild: async (id, index) => { /* ... */ },
    onCompactingStart: async (id, index) => { /* ... */ },
    onCompactingEnd: async (id, index) => { /* ... */ },
  },
})
```

## Snapshots

```ts
const snap = controller.getSnapshot()
controller.restoreFromSnapshot(snap)
```

## API

### `new CycleController(options?)`

- `config.tokenBudget` — max token budget (default: 128000)
- `config.checkpointThresholds` — thresholds as ratios (default: [0.20, 0.45, 0.70])
- `config.rebuildThreshold` — context rebuild ratio (default: 0.90)
- `config.minStepsBetweenCheckpoints` — min steps between checkpoints (default: 5)
- `config.maxCycles` — max rebuild cycles (default: 20)
- `eventBus` — optional EventBus for publishing events
- `stateMachine` — optional AgentStateMachine for state lifecycle
- `checkpointWriter` — optional ICheckpointWriter for persisting checkpoints
- `callbacks` — optional lifecycle callbacks

### Methods

- `evaluate(tokenUsage, tokenBudget, sessionId, history)` → `CycleAction`
- `executeCheckpoint(sessionId, history, action)` → `Promise<string | null>`
- `executeRebuild(sessionId, action)` → `Promise<void>`
- `advanceStep(count?)` — increment step counter
- `getSnapshot()` → `CycleSnapshot`
- `restoreFromSnapshot(snapshot)` — restore state from snapshot
- `reset()` — reset all state

All integrations (EventBus, StateMachine, ICheckpointWriter, callbacks) are optional.
