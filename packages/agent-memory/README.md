# @fengrru/agent-memory

[![npm version](https://img.shields.io/npm/v/@fengrru/agent-memory)](https://www.npmjs.com/package/@fengrru/agent-memory) [![npm downloads](https://img.shields.io/npm/dm/@fengrru/agent-memory)](https://www.npmjs.com/package/@fengrru/agent-memory) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)

4-tier memory system for AI agents with Ebbinghaus forgetting curve.

## Install

```bash
npm install @fengrru/agent-memory
```

## Quick Start

```typescript
import { createMemorySystem } from "@fengrru/agent-memory"

const memory = createMemorySystem()

// Add memories
memory.addCoreRule({ rule_id: "r1", category: "style", content: "Use TypeScript", token_count: 4, importance: 1.0 })
memory.addWorkingMemory({ id: "w1", content: "Current task: fix bug", token_count: 5, priority: 1.0 })
memory.addLongTermMemory({
  memory_id: "lt1",
  content: "User prefers dark mode",
  token_count: 6,
  importance: 0.8,
  access_count: 2,
  created_at: Date.now() - 86_400_000,
  last_accessed: Date.now() - 3_600_000,
  retention_score: 0.7,
})

// Retrieve
const context = memory.assembleContext("fix the login bug")
```

## Memory Tiers

| Tier | Description | Max Items |
|------|-------------|-----------|
| L1 Transient | Current turn scratchpad | 10 |
| L2 Working | Current session workspace | 20 |
| L3 Long-term | Cross-session persistent | Unlimited |
| L4 Core Rules | Agent personality/constraints | Unlimited |

## Features

- **5-factor importance**: user_marked, error_related, goal_similarity, frequency, recency
- **Ebbinghaus decay**: retention_score decreases over time
- **Composite retrieval**: 0.4×vector + 0.3×importance + 0.3×retention
- **Token budget**: context assembly respects token limits
- **Serialization**: save/restore state


## Documentation

- [API Reference](https://fengrru.github.io/awesome-agent-infra/api/) — TypeDoc-generated API docs
- [Source Code](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/agent-memory)
- [Examples](https://github.com/Fengrru/awesome-agent-infra/tree/main/examples)

## License

MIT