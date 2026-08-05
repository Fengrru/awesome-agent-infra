# @fengrru/taskdag

[![npm version](https://img.shields.io/npm/v/@fengrru/taskdag)](https://www.npmjs.com/package/@fengrru/taskdag) [![npm downloads](https://img.shields.io/npm/dm/@fengrru/taskdag)](https://www.npmjs.com/package/@fengrru/taskdag) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)

DAG execution engine with incremental replanning for AI agent task orchestration.

## Install

```bash
npm install @fengrru/taskdag
```

## Quick Start

```typescript
import { createDAG, validateDAG, getReadyNodes, markNodeFailed, replaceSubtree } from "@fengrru/taskdag"

const dag = createDAG({
  nodes: [
    { id: "a", name: "Step A", status: "pending", dependencies: [] },
    { id: "b", name: "Step B", status: "pending", dependencies: ["a"] },
  ],
  edges: [{ from: "a", to: "b" }],
  goal: "Build feature",
  replan_count: 0,
})

// Validate
const validation = validateDAG(dag)
console.log(valid.valid) // boolean

// Get ready nodes
const ready = getReadyNodes(dag) // ["a"]

// Handle failure
const repaired = markNodeFailed(dag, "a", "error message")
const newDag = replaceSubtree(repaired, "a", replacementNodes, replacementEdges)
```

## Features

- **Cycle detection**: validates DAG structure
- **Topological execution**: ready nodes detection
- **Incremental replanning**: replace failed subtrees
- **Cost estimation**: sum tokens and duration
- **Immutable operations**: original DAG unchanged


## Documentation

- [API Reference](https://fengrru.github.io/awesome-agent-infra/api/) — TypeDoc-generated API docs
- [Source Code](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/taskdag)
- [Examples](https://github.com/Fengrru/awesome-agent-infra/tree/main/examples)
## License

MIT