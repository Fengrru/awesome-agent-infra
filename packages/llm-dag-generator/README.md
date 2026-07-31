# @fengru/llm-dag-generator

[![npm version](https://img.shields.io/npm/v/@fengru/llm-dag-generator)](https://www.npmjs.com/package/@fengru/llm-dag-generator) [![npm downloads](https://img.shields.io/npm/dm/@fengru/llm-dag-generator)](https://www.npmjs.com/package/@fengru/llm-dag-generator) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)

> ⚠️ **Experimental** — API may break in minor versions. See [STABILITY.md](../../STABILITY.md).

LLM-driven task DAG generation with K-parallel variants.

## Install

```bash
npm install @fengru/llm-dag-generator
```

## Quick Start

```typescript
import { LLMDAGGenerator } from "@fengru/llm-dag-generator"

const generator = new LLMDAGGenerator({
  provider: llmProvider,
  kVariants: 3,
})

const dag = await generator.generate({
  goal: "Implement user authentication",
  capabilities: ["file_read", "file_write", "bash"],
})

console.log(dag.nodes) // generated DAG nodes
console.log(dag.strategy) // "adaptive" | "staged" | "k_parallel"
```

## Features

- **Mustache templates**: structured prompt generation
- **K=3 variants**: parallel sampling with different strategies
- **Heuristic fallback**: when LLM fails (risk-based serial chain)
- **Validation**: ensures generated DAG is valid


## Documentation

- [API Reference](https://fengrru.github.io/awesome-agent-infra/api/) — TypeDoc-generated API docs
- [Source Code](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/llm-dag-generator)
- [Examples](https://github.com/Fengrru/awesome-agent-infra/tree/main/examples)
## License

MIT