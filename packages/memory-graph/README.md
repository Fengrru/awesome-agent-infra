# @fengru/memory-graph

[![npm version](https://img.shields.io/npm/v/@fengru/memory-graph)](https://www.npmjs.com/package/@fengru/memory-graph) [![npm downloads](https://img.shields.io/npm/dm/@fengru/memory-graph)](https://www.npmjs.com/package/@fengru/memory-graph) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)

Zero-dependency causal dependency graph for AI agent memory revision with CoW versioning, BFS cascade invalidation, and consistency-aware retrieval.

## Quick Start

```ts
import { createMemoryGraph, RelationType, RetrievalMode, createConsistencyRetriever } from "@fengru/memory-graph"

const graph = createMemoryGraph()

// Build a causal dependency chain
graph.addNode("person", { name: "Zhang San", status: "honest" })
graph.addNode("contract", { id: "C", status: "safe" })
graph.addNode("report", { conclusion: "Contract C is safe" })

graph.addEdge("person", "contract", RelationType.DEPENDS_ON, 1.0)
graph.addEdge("contract", "report", RelationType.DEPENDS_ON, 1.0)

// Revise a root fact — cascade automatically invalidates dependents
graph.updateNode("person", { status: "fraudster" }, "fraud detected")

console.log(graph.getNode("contract")!.consistencyStatus) // "STALE"
console.log(graph.getNode("report")!.consistencyStatus)   // "STALE"

// Correct the parent — revalidate reverses the cascade
graph.revalidate("person", "fraud allegation cleared")
console.log(graph.getNode("contract")!.consistencyStatus) // "VALID"

// Consistency-aware retrieval
const retriever = createConsistencyRetriever()
const results = retriever.retrieve(graph, "contract", RetrievalMode.LATEST_VALID)
for (const r of results) {
  console.log(`[${r.node.consistencyStatus}] ${JSON.stringify(r.node.content)} (relevance: ${r.relevance.toFixed(2)})`)
}
```

## Three Design Principles

| Principle | Mechanism | Guarantee |
|-----------|-----------|-----------|
| P1: Immutable Semantic Versioning | Copy-on-Write | Updates create new versions; history never mutated |
| P2: Dependency-Preserving Revision | BFS cascade invalidation | Revising a fact invalidates all transitive dependents |
| P3: Consistency-Aware Retrieval | 5 retrieval modes | Distinguish "latest data" from "latest valid data" |

## Causal Dependency Graph

Nodes store key-value content with immutable versions. Typed edges encode how facts depend on each other:

| Edge Type | Semantics |
|-----------|-----------|
| `DEPENDS_ON` | source was derived/computed from target |
| `CAUSES` | target event causes source event |
| `INFLUENCES` | target weakly affects source |
| `CONTRADICTS` | source contradicts target |
| `SUPPORTS` | source provides evidence for target |

## Cascade Invalidation (BFS)

When a root node is revised, the system performs bounded BFS along outgoing causal edges,
automatically marking all transitive dependents as STALE. Configurable:

- **Depth limit** (d_max = 5): bounds propagation to O(d*k) where k = avg fan-out
- **Strength threshold** (theta_min = 0.1): weak edges below threshold are skipped
- **Edge type filtering** (T_active): only active relation types are traversed
- **Adaptive depth boost**: high-priority nodes (matching keywords like "fraud") get +2 extra depth
- **Strength decay**: edge weight decays per hop (gamma = 0.95)

## Five Retrieval Modes

| Mode | Behavior | Use Case |
|------|----------|----------|
| `LATEST_VALID` | Exclude OBSOLETE + STALE | Default safe retrieval |
| `CONSISTENT_ONLY` | Only sigma = VALID | High-integrity queries |
| `INCLUDE_STALE` | Include STALE with warning | Risk assessment |
| `ALL_VERSIONS` | Return latest regardless | Debugging |
| `AT_TIME` | Historical snapshot | Forensic analysis |

## Conflict Detection

When two independent sources claim contradictory values for the same entity,
the node is marked as CONFLICT and automatic propagation is paused pending resolution.

## Live Vector Index Validation

Entries whose node version has advanced since indexing are automatically skipped.
Stale entries are excluded without requiring explicit index rebuilds.

## Documentation

- [API Reference](https://fengrru.github.io/awesome-agent-infra/api/) — TypeDoc-generated API docs
- [Source Code](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/memory-graph)
- [Examples](https://github.com/Fengrru/awesome-agent-infra/tree/main/examples)

## License

MIT
