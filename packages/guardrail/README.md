# @fengru/guardrail

[![npm version](https://img.shields.io/npm/v/@fengru/guardrail)](https://www.npmjs.com/package/@fengru/guardrail) [![npm downloads](https://img.shields.io/npm/dm/@fengru/guardrail)](https://www.npmjs.com/package/@fengru/guardrail) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)

> ⚠️ **Experimental** — API may break in minor versions. See [STABILITY.md](../../STABILITY.md).

Runtime safety guard with risk classification for AI agent operations.

## Install

```bash
npm install @fengru/guardrail
```

## Quick Start

```typescript
import { GuardRail, EntropyController } from "@fengru/guardrail"

const guard = new GuardRail()

// Check risk before execution
const risk = guard.classifyRisk({
  type: "file_write",
  path: "src/index.ts",
})

if (risk.level > 1) {
  await guard.requestConfirmation(risk)
}

// Monitor entropy
const entropy = new EntropyController({ tokenBudget: 1000000 })
const action = entropy.evaluate(metrics)
```

## Risk Levels

| Level | Description | Example |
|-------|-------------|---------|
| 0 | Read-only | Read file |
| 1 | Local modification | Edit file |
| 2 | Global impact | Delete directory |
| 3 | Destructive | Drop database |

## Features

- **4-level risk classification**: 0-3 scale
- **Entropy monitoring**: token budget, failure rate
- **Action confirmation**: high-risk operations require approval
- **Research mode**: consecutive failures trigger pause


## Documentation

- [API Reference](https://fengrru.github.io/awesome-agent-infra/api/) — TypeDoc-generated API docs
- [Source Code](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/guardrail)
- [Examples](https://github.com/Fengrru/awesome-agent-infra/tree/main/examples)
## License

MIT