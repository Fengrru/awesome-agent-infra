# @fengrru/codegraph

[![npm version](https://img.shields.io/npm/v/@fengrru/codegraph)](https://www.npmjs.com/package/@fengrru/codegraph) [![npm downloads](https://img.shields.io/npm/dm/@fengrru/codegraph)](https://www.npmjs.com/package/@fengrru/codegraph) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)

In-memory heterogeneous code graph with PageRank centrality ranking. Build a knowledge graph from your codebase and search it with multi-signal fusion.

## Install

```bash
bun add @fengrru/codegraph
# Optional: bun add web-tree-sitter (for AST parsing)
```

## Quick Start

```typescript
import { CodeGraph, CodeGraphSearcher, CodeGraphRanker, createCodeGraphBuilder } from "@fengrru/codegraph"

// Option A: Builder pattern (recommended)
const graph = await createCodeGraphBuilder({ rootDir: "./src", maxFiles: 500 }).build()

// Option B: Direct construction
const graph2 = new CodeGraph()
await graph2.build("./src")

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

- [API Reference](https://fengrru.github.io/awesome-agent-infra/api/) â€?TypeDoc-generated API docs
- [Source Code](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/codegraph)
- [Examples](https://github.com/Fengrru/awesome-agent-infra/tree/main/examples)

## License

MIT