# @fengru/project-memory

File-based MEMORY.md project knowledge persistence.

## Install

```bash
npm install @fengru/project-memory
```

## Quick Start

```typescript
import { ProjectMemoryManager } from "@fengru/project-memory"

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

## License

MIT