# @fengru/goal-verifier

Independent goal completion verification for AI agents.

## Install

```bash
npm install @fengru/goal-verifier
```

## Quick Start

```typescript
import { GoalVerifier } from "@fengru/goal-verifier"

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

## License

MIT