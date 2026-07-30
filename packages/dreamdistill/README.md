# @fengru/dreamdistill

7-day Dream + 30-day Distill self-improvement cycles for AI agents.

## Install

```bash
npm install @fengru/dreamdistill
```

## Quick Start

```typescript
import { DreamJob, DistillJob } from "@fengru/dreamdistill"

// Dream: consolidate memory every 7 days
const dream = new DreamJob({
  intervalMs: 7 * 24 * 60 * 60 * 1000,
  mergeSimilarityThreshold: 0.8,
})

await dream.run(memorySystem)

// Distill: crystallize patterns every 30 days
const distill = new DistillJob({
  intervalMs: 30 * 24 * 60 * 60 * 1000,
  minSessions: 5,
})

const artifacts = await distill.run(memorySystem, skillManager)
// artifacts: skills, commands, agents, SOPs
```

## Dream Cycle (7 days)

- Merge similar memories
- Remove invalid entries
- Compress redundant information
- Recalculate confidence scores

## Distill Cycle (30 days)

| Pattern | Artifact |
|---------|----------|
| ≥5 occurrences | command |
| ≥4 steps | agent |
| ≥5 steps + ≥7 uses | SOP |

## Features

- **Jaccard dedup**: merge similar memories
- **User creation protection**: preserve user-created entries
- **LLM or heuristic**: configurable pattern recognition
- **Auto-register**: new skills added to SkillManager

## License

MIT