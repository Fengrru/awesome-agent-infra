# @fengrru/agentic-search

[![npm version](https://img.shields.io/npm/v/@fengrru/agentic-search)](https://www.npmjs.com/package/@fengrru/agentic-search) [![npm downloads](https://img.shields.io/npm/dm/@fengrru/agentic-search)](https://www.npmjs.com/package/@fengrru/agentic-search) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)

4-layer intent-driven search orchestrator for AI agents.

## Install

```bash
npm install @fengrru/agentic-search
```

## Quick Start

```typescript
import { AgenticSearchOrchestrator } from "@fengrru/agentic-search"

const orchestrator = new AgenticSearchOrchestrator({
  codeGraph: codeGraphInstance,
  hybridSearch: hybridSearchInstance,
})

const result = await orchestrator.search("find all authentication functions")

console.log(result.intent) // "find_symbol"
console.log(result.results) // ranked results
console.log(result.confidence) // 0-1
```

## Intent Types

| Intent | Description |
|--------|-------------|
| find_symbol | Find function/class/variable |
| trace_call | Follow call chain |
| understand_module | Explain module purpose |
| dependency_graph | Show dependencies |
| explore_file | Browse file structure |
| find_usage | Find references |
| semantic_search | Meaning-based search |
| general_query | Fallback |

## 4-Layer Architecture

1. **Intent**: 8 regex patterns, zero LLM cost
2. **Strategy**: Intent → tool combination + topological sort
3. **Execution**: 3 search tools (code_symbol, code_graph, semantic)
4. **Fusion**: Token budget truncation + confidence scoring


## Documentation

- [API Reference](https://fengrru.github.io/awesome-agent-infra/api/) — TypeDoc-generated API docs
- [Source Code](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/agentic-search)
- [Examples](https://github.com/Fengrru/awesome-agent-infra/tree/main/examples)
## License

MIT