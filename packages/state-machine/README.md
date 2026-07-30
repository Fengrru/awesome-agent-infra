# @fengru/state-machine

15-state typed FSM for agent sessions.

## Install

```bash
npm install @fengru/state-machine
```

## Quick Start

```typescript
import { AgentStateMachine } from "@fengru/state-machine"

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

## License

MIT