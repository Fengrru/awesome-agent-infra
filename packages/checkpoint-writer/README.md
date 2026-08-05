# @fengrru/checkpoint-writer

[![npm version](https://img.shields.io/npm/v/@fengrru/checkpoint-writer)](https://www.npmjs.com/package/@fengrru/checkpoint-writer) [![npm downloads](https://img.shields.io/npm/dm/@fengrru/checkpoint-writer)](https://www.npmjs.com/package/@fengrru/checkpoint-writer) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)

> **Experimental** — API may break in minor versions. See [STABILITY.md](../../STABILITY.md).

LLM-driven 11-field structured state extraction for agent checkpoints.

## Install

```bash
npm install @fengrru/checkpoint-writer
```

## Quick Start

```typescript
import { CheckpointWriter } from "@fengrru/checkpoint-writer"

const writer = new CheckpointWriter({
  provider: llmProvider,
  outputDir: "./checkpoints",
})

const checkpoint = await writer.write({
  history: conversationHistory,
  goal: currentGoal,
})

// checkpoint contains 11 fields:
// current_intent, next_action, working_constraints, task_tree,
// current_work, involved_files, cross_task_discoveries,
// errors_and_fixes, runtime_state, design_decisions, miscellaneous_notes
```

## 11 Fields

| Field | Description |
|-------|-------------|
| current_intent | What the agent is trying to do |
| next_action | Immediate next step |
| working_constraints | Limitations and requirements |
| task_tree | Hierarchical task breakdown |
| current_work | Active work items |
| involved_files | Files being modified |
| cross_task_discoveries | Findings across tasks |
| errors_and_fixes | Error history and solutions |
| runtime_state | System state |
| design_decisions | Architecture choices |
| miscellaneous_notes | Other important notes |

## Features

- **Independent LLM subagent**: doesn't share main agent attention
- **Incremental updates**: only changed fields
- **Discovery promotion**: ≥3 appearances → project memory
- **Dual format**: JSON + Markdown output


## Documentation

- [API Reference](https://fengrru.github.io/awesome-agent-infra/api/) — TypeDoc-generated API docs
- [Source Code](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/checkpoint-writer)
- [Examples](https://github.com/Fengrru/awesome-agent-infra/tree/main/examples)

## License

MIT