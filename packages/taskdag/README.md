# @fengru/taskdag

DAG execution engine with incremental replanning for AI agent task orchestration.

## Install

```bash
npm install @fengru/taskdag
```

## Quick Start

```typescript
import { createDAG, validateDAG, getReadyNodes, markNodeFailed, replaceSubtree } from "@fengru/taskdag"

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

## License

MIT