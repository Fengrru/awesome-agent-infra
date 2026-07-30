# @fengru/engine-db

Pluggable SQLite engine with 13 tables for agent state persistence.

## Install

```bash
npm install @fengru/engine-db
```

## Quick Start

```typescript
import { EngineDatabase } from "@fengru/engine-db"

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

## License

MIT