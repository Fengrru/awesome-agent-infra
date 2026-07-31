# @fengru/lifecycle-manager

[![npm version](https://img.shields.io/npm/v/@fengru/lifecycle-manager)](https://www.npmjs.com/package/@fengru/lifecycle-manager) [![npm downloads](https://img.shields.io/npm/dm/@fengru/lifecycle-manager)](https://www.npmjs.com/package/@fengru/lifecycle-manager) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)

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


## Documentation

- [API Reference](https://fengrru.github.io/awesome-agent-infra/api/) — TypeDoc-generated API docs
- [Source Code](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/lifecycle-manager)
- [Examples](https://github.com/Fengrru/awesome-agent-infra/tree/main/examples)
## License

MIT