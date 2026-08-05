# @fengrru/project-memory

[![npm version](https://img.shields.io/npm/v/@fengrru/project-memory)](https://www.npmjs.com/package/@fengrru/project-memory) [![npm downloads](https://img.shields.io/npm/dm/@fengrru/project-memory)](https://www.npmjs.com/package/@fengrru/project-memory) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)

File-based MEMORY.md project knowledge persistence.

## Install

```bash
npm install @fengrru/project-memory
```

## Quick Start

```typescript
import { ProjectMemoryManager } from "@fengrru/project-memory"

const manager = new ProjectMemoryManager({
  filePath: "./MEMORY.md",
})

// Add entry
await manager.upsert({
  id: "auth-pattern",
  section: "patterns",
  content: "Use JWT for authentication",
  confidence: 0.9,
})

// Search
const results = manager.search("authentication")

// Promote discovery
await manager.promoteDiscovery("User prefers dark mode")
```

## Sections

| Section | Description |
|---------|-------------|
| facts | Verified information |
| patterns | Recurring behaviors |
| rules | Constraints and guidelines |
| decisions | Architecture choices |
| observations | Runtime insights |

## Features

- **JSONL format**: line-based storage
- **Auto-dedup**: merge similar entries
- **Verification count**: increment on access
- **User lock**: protect user-created entries
- **Confidence markers**: visual indicator in markdown


## Documentation

- [API Reference](https://fengrru.github.io/awesome-agent-infra/api/) — TypeDoc-generated API docs
- [Source Code](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/project-memory)
- [Examples](https://github.com/Fengrru/awesome-agent-infra/tree/main/examples)
## License

MIT