# @fengrru/engine-db

[![npm version](https://img.shields.io/npm/v/@fengrru/engine-db)](https://www.npmjs.com/package/@fengrru/engine-db) [![npm downloads](https://img.shields.io/npm/dm/@fengrru/engine-db)](https://www.npmjs.com/package/@fengrru/engine-db) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)

Pluggable SQLite engine with 13 tables for agent state persistence.

## Install

```bash
npm install @fengrru/engine-db
```

## Quick Start

```typescript
import { EngineDatabase } from "@fengrru/engine-db"

const db = new EngineDatabase(":memory:") // or "./agent.db"

// Insert events
db.insertEvents([{
  session_id: "s1",
  event_type: "state_transition",
  payload: { from: "IDLE", to: "READY" },
  timestamp: Date.now(),
}])

// Query checkpoints
const checkpoints = db.queryCheckpoints("s1")
```

## Database Tables

| Table | Purpose |
|-------|---------|
| event_log | Event sourcing |
| checkpoint | State snapshots |
| capability_graph | Agent capabilities |
| repair_memory | Self-healing rules |
| session_memory | Long-term memory |
| skill | Agent skills |
| engine_session | Session metadata |
| agent_self | L4 agent rules |
| user_profile | User preferences |

## Features

- **WAL mode**: concurrent reads
- **Foreign keys**: referential integrity
- **Auto-increment**: sequence_index per session
- **Session fork/branch**: experimental branching


## Documentation

- [API Reference](https://fengrru.github.io/awesome-agent-infra/api/) — TypeDoc-generated API docs
- [Source Code](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/engine-db)
- [Examples](https://github.com/Fengrru/awesome-agent-infra/tree/main/examples)

## License

MIT