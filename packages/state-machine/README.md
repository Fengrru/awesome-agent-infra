# @fengrru/state-machine

[![npm version](https://img.shields.io/npm/v/@fengrru/state-machine)](https://www.npmjs.com/package/@fengrru/state-machine) [![npm downloads](https://img.shields.io/npm/dm/@fengrru/state-machine)](https://www.npmjs.com/package/@fengrru/state-machine) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)

15-state typed FSM for agent sessions.

## Install

```bash
npm install @fengrru/state-machine
```

## Quick Start

```typescript
import { AgentStateMachine } from "@fengrru/state-machine"

const sm = new AgentStateMachine()

// Transition
sm.transition("INITIALIZING") // IDLE → INITIALIZING
sm.transition("READY")        // INITIALIZING → READY

// Callbacks
sm.onEnter("EXECUTING", () => console.log("Starting execution"))
sm.onExit("EXECUTING", () => console.log("Finished execution"))

// Guards
sm.addGuard("READY", "EXECUTING", () => hasCapabilities())

// Snapshot/restore
const snapshot = sm.getSnapshot()
sm.restore(snapshot)
```

## States

```
IDLE → INITIALIZING → READY → PLANNING → THINKING → EXECUTING → VERIFYING → COMPLETED
                                |                              |
                                v                              v
                              PAUSED                        COMPACTING
                                |
                                v
                               ERROR → RECOVERING → READY
```

## Features

- **40+ transitions**: comprehensive state coverage
- **onEnter/onExit**: lifecycle hooks
- **Guards**: conditional transitions
- **Metrics**: Prometheus export
- **History**: last 100 transitions
- **Timeout**: configurable transition timeout


## Documentation

- [API Reference](https://fengrru.github.io/awesome-agent-infra/api/) — TypeDoc-generated API docs
- [Source Code](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/state-machine)
- [Examples](https://github.com/Fengrru/awesome-agent-infra/tree/main/examples)

## License

MIT