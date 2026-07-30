# @fengru/lifecycle-manager

Declarative module lifecycle manager for AI agent systems.

## Install

```bash
npm install @fengru/lifecycle-manager
```

## Quick Start

```typescript
import { LifecycleManager } from "@fengru/lifecycle-manager"

const manager = new LifecycleManager()

// Register module
manager.register({
  id: "memory-module",
  priority: 10,
  onPhase: async (phase, context) => {
    if (phase === "init") await initMemory()
    if (phase === "shutdown") await closeMemory()
  },
})

// Hook state machine
manager.hookStateMachine(stateMachine)

// Trigger lifecycle
await manager.triggerStateEnter("READY", context)
await manager.triggerStateExit("EXECUTING", context)
await manager.triggerPhase("pre-execution", context)
```

## Features

- **Priority ordering**: lower number = earlier execution
- **Error isolation**: one module failure doesn't block others
- **State machine hooks**: automatic onEnter/onExit
- **Phase triggers**: custom lifecycle phases
- **Dependency injection**: context fields passed to modules

## License

MIT