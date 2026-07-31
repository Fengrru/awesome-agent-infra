# @fengru/dynamic-workflow

[![npm version](https://img.shields.io/npm/v/@fengru/dynamic-workflow)](https://www.npmjs.com/package/@fengru/dynamic-workflow) [![npm downloads](https://img.shields.io/npm/dm/@fengru/dynamic-workflow)](https://www.npmjs.com/package/@fengru/dynamic-workflow) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)

> ⚠️ **Experimental** — API may break in minor versions. See [STABILITY.md](../../STABILITY.md).

VM-sandboxed workflow engine for AI agent execution.

## Install

```bash
npm install @fengru/dynamic-workflow
```

## Quick Start

```typescript
import { DynamicWorkflowEngine } from "@fengru/dynamic-workflow"

const engine = new DynamicWorkflowEngine({
  workflowDir: "./workflows",
  stateDir: "./state",
  executionTimeoutMs: 30000,
})

// Define workflow
engine.define("process-data", `
  const raw = await agent("fetch-data")
  const cleaned = await agent("clean-data", { input: raw })
  return await agent("analyze", { data: cleaned })
`)

// Execute
const result = await engine.execute("process-data", { input: "data.csv" })
```

## Primitives

| Primitive | Description |
|-----------|-------------|
| agent | Dispatch to LLM agent |
| parallel | Run tasks concurrently |
| pipeline | Chain stages sequentially |
| workflow | Compose sub-workflows |

## Features

- **VM sandbox**: Node.js vm.createContext
- **Auto checkpoint**: every 5 steps
- **Timeout protection**: configurable limits
- **Nesting depth**: max 5 levels
- **State persistence**: resume after failure


## Documentation

- [API Reference](https://fengrru.github.io/awesome-agent-infra/api/) — TypeDoc-generated API docs
- [Source Code](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/dynamic-workflow)
- [Examples](https://github.com/Fengrru/awesome-agent-infra/tree/main/examples)
## License

MIT