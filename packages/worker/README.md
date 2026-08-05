# @fengrru/worker

[![npm version](https://img.shields.io/npm/v/@fengrru/worker)](https://www.npmjs.com/package/@fengrru/worker) [![npm downloads](https://img.shields.io/npm/dm/@fengrru/worker)](https://www.npmjs.com/package/@fengrru/worker) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)

Zero-dependency stateless worker pool for parallel task execution.

## Quick Start

```ts
import { createWorkerPool } from "@fengrru/worker"

const pool = createWorkerPool({ defaultTimeoutMs: 10_000 })

// Register capability handlers
pool.register("stringUppercase", async (inputs) => {
  const text = inputs.text as string
  return { result: text.toUpperCase() }
})

pool.register("stringReverse", async (inputs) => {
  const text = inputs.text as string
  return { result: text.split("").reverse().join("") }
})

// Execute a single task
const result = await pool.executeTask({
  taskId: "task-1",
  nodeId: "node-1",
  capabilityId: "stringUppercase",
  inputs: { text: "hello" },
})

console.log(result.output) // { result: "HELLO" }

// Execute in parallel with concurrency control
const results = await pool.executeTasksInParallel(
  [
    { taskId: "t1", nodeId: "n1", capabilityId: "stringUppercase", inputs: { text: "hello" } },
    { taskId: "t2", nodeId: "n2", capabilityId: "stringReverse", inputs: { text: "world" } },
  ],
  { concurrency: 2, stopOnFailure: true, timeoutMs: 5000 }
)

// Execute sequentially (stops on first failure)
const seqResults = await pool.executeTasksSequential(tasks)

// Get metrics
const metrics = pool.getMetrics()
console.log(metrics)

// Graceful shutdown
await pool.shutdown(5000)
```


## Documentation

- [API Reference](https://fengrru.github.io/awesome-agent-infra/api/) — TypeDoc-generated API docs
- [Source Code](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/worker)
- [Examples](https://github.com/Fengrru/awesome-agent-infra/tree/main/examples)
## License

MIT
