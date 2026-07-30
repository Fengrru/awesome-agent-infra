# @fengru/dynamic-workflow

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

## License

MIT