# @fengru/skill-curator

Automated skill library curation for AI agent skills.

## Install

```bash
npm install @fengru/skill-curator
```

## Quick Start

```typescript
import { SkillCurator } from "@fengru/skill-curator"

const curator = new SkillCurator({
  provider: llmProvider,
  skillsDir: "./skills",
})

// Auto-archive unused skills
await curator.autoArchive({ unusedDays: 30 })

// Auto-pin top skills
await curator.autoPin({ topPercent: 10 })

// Quality review
const review = await curator.reviewSkill("error-handling")
// review: { completeness: 0.9, clarity: 0.8, ... }
```

## Features

- **Auto-archive**: 30 days unused → .archive/
- **Auto-pin**: top 10% skills pinned
- **LLM review**: 5-dimension quality scoring
  - Completeness
  - Clarity
  - Correctness
  - Reusability
  - Maintainability

## License

MIT