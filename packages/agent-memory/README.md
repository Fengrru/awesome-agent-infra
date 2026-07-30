# @fengru/agent-memory

4-tier memory system for AI agents with Ebbinghaus forgetting curve.

## Install

```bash
npm install @fengru/agent-memory
```

## Quick Start

```typescript
import { MemorySystem } from "@fengru/agent-memory"

const memory = new MemorySystem()

// Add memories
memory.addCoreRule({ rule_id: "r1", category: "style", content: "Use TypeScript", token_count: 4, importance: 1.0 })
memory.addWorkingMemory({ id: "w1", content: "Current task: fix bug", token_count: 5, priority: 1.0 })
memory.addLongTermMemory({ memory_id: "lt1", content: "User prefers dark mode", token_count: 6 })

// Retrieve
const context = memory.assembleContext("fix the login bug", { maxTokens: 1000 })
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

## License

MIT