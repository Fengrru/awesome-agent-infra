# @fengru/agent-metacog

Metacognitive monitoring with knowledge boundary detection for AI agents.

## Install

```bash
npm install @fengru/agent-metacog
```

## Quick Start

```typescript
import { AgentMetacog } from "@fengru/agent-metacog"

const metacog = new AgentMetacog()

// Record interactions
metacog.recordInteraction({
  domain: "typescript",
  success: true,
  timestamp: Date.now(),
})

// Check knowledge boundaries
const gaps = metacog.detectKnowledgeGaps()
// gaps: [{ domain: "rust", severity: 0.8, ... }]

// Detect forgetting
const alerts = metacog.detectForgetting()
// alerts: [{ domain: "python", lastAccess: ..., ... }]

// Self-reflection
const reflection = metacog.selfReflect()
```

## Features

- **Ebbinghaus retention**: forgetting curve modeling
- **Knowledge boundary**: separates known from unknown
- **Forgetting detection**: alerts for stale domains
- **Consolidation queue**: prioritized review tasks
- **Self-reflection**: generates meaningful insights

## License

MIT