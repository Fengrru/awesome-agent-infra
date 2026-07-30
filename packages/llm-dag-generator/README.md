# @fengru/llm-dag-generator

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

## License

MIT