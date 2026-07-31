# @fengru/codegraph

[![npm version](https://img.shields.io/npm/v/@fengru/codegraph)](https://www.npmjs.com/package/@fengru/codegraph) [![npm downloads](https://img.shields.io/npm/dm/@fengru/codegraph)](https://www.npmjs.com/package/@fengru/codegraph) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)

In-memory heterogeneous code graph with PageRank centrality ranking. Build a knowledge graph from your codebase and search it with multi-signal fusion.

## Install

```bash
npm install @fengru/codegraph
# Optional: npm install web-tree-sitter (for AST parsing)
```

## Quick Start

```typescript
import { CodeGraph, CodeGraphSearcher, CodeGraphRanker } from "@fengru/codegraph"

// Build graph from codebase
const graph = new CodeGraph()
await graph.build("./src")

// Search
const searcher = new CodeGraphSearcher(graph)
const results = searcher.search("authenticateUser", { maxResults: 10 })

// Rank by PageRank
const ranker = new CodeGraphRanker(graph)
const ranked = ranker.rank()
```

## Features

- **3 node types**: file, symbol, module
- **9 edge types**: contains, imports, calls, extends, implements, etc.
- **PageRank centrality**: d=0.85, maxIter=100
- **k-hop ego graph**: BFS-based subgraph extraction
- **Token estimation**: for prompt injection
- **Incremental updates**: file watcher with hot reload

## Modules

| Module | Description |
|--------|-------------|
| `CodeGraph` | Core graph engine |
| `CodeGraphSearcher` | Multi-mode search with relevance scoring |
| `CodeGraphRanker` | PageRank + centrality ranking |
| `CodeGraphWatcher` | Incremental file change detection |


## Documentation

- [API Reference](https://fengrru.github.io/awesome-agent-infra/api/) — TypeDoc-generated API docs
- [Source Code](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/codegraph)
- [Examples](https://github.com/Fengrru/awesome-agent-infra/tree/main/examples)
## License

MIT