# @fengrru/goal-verifier

[![npm version](https://img.shields.io/npm/v/@fengrru/goal-verifier)](https://www.npmjs.com/package/@fengrru/goal-verifier) [![npm downloads](https://img.shields.io/npm/dm/@fengrru/goal-verifier)](https://www.npmjs.com/package/@fengrru/goal-verifier) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)

Independent goal completion verification for AI agents.

## Install

```bash
npm install @fengrru/goal-verifier
```

## Quick Start

```typescript
import { GoalVerifier } from "@fengrru/goal-verifier"

const verifier = new GoalVerifier({
  provider: llmProvider,
  maxRetries: 3,
})

const result = await verifier.verify({
  goal: "Implement user authentication",
  completedSteps: [...],
  output: generatedCode,
})

console.log(result.status) // "satisfied" | "gap_found" | "impossible"
console.log(result.gaps) // what's missing
```

## Verification States

| State | Description |
|-------|-------------|
| satisfied | Goal fully achieved |
| gap_found | Partial completion, missing items |
| impossible | Goal cannot be achieved |

## Features

- **Independent LLM call**: doesn't share main agent attention
- **Gap analysis**: identifies what's missing
- **Loop prevention**: maxRetries → force pass
- **Heuristic fallback**: DAG completion rate when LLM fails


## Documentation

- [API Reference](https://fengrru.github.io/awesome-agent-infra/api/) — TypeDoc-generated API docs
- [Source Code](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/goal-verifier)
- [Examples](https://github.com/Fengrru/awesome-agent-infra/tree/main/examples)

## License

MIT