# @fengru/replay

Session event replay engine for AI agent sessions.

## Install

```bash
npm install @fengru/replay
```

## Quick Start

```typescript
import { SessionReplayer, type ReplayEvent } from "@fengru/replay"

const replayer = new SessionReplayer()

replayer.loadEvents([
  { eventId: "1", type: "plan", timestamp: 1000, payload: {} },
  { eventId: "2", type: "execute", timestamp: 2000, payload: {}, destructive: true },
])

// Dry-run: compute state trajectory only
const dryResult = await replayer.replay("dry-run")

// Read-only: state + non-destructive events
const readResult = await replayer.replay("read-only", async (event) => {
  console.log("executing", event.eventId)
})

// Full: execute all events
const fullResult = await replayer.replay("full", async (event) => {
  console.log("executing all", event.eventId)
  return { ok: true }
})
```

## Replay Modes

| Mode | State Transitions | Non-destructive | Destructive |
|------|-------------------|-----------------|-------------|
| dry-run | Yes | Skipped | Skipped |
| read-only | Yes | Executed | Skipped |
| full | Yes | Executed | Executed |

## Features

- **Three replay modes**: dry-run, read-only, full
- **State trajectory tracking**: captures every state transition during replay
- **Differences detection**: records mismatches between expected and actual results
- **Optional dependencies**: integrates with `@fengru/state-machine` and `@fengru/taskdag` when available

## License

MIT
