# @fengrru/skill-curator

[![npm version](https://img.shields.io/npm/v/@fengrru/skill-curator)](https://www.npmjs.com/package/@fengrru/skill-curator) [![npm downloads](https://img.shields.io/npm/dm/@fengrru/skill-curator)](https://www.npmjs.com/package/@fengrru/skill-curator) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)

> **Experimental** — API may break in minor versions. See [STABILITY.md](../../STABILITY.md).

Automated skill library curation for AI agent skills.

## Install

```bash
npm install @fengrru/skill-curator
```

## Quick Start

```typescript
import { SkillCurator } from "@fengrru/skill-curator"

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


## Documentation

- [API Reference](https://fengrru.github.io/awesome-agent-infra/api/) — TypeDoc-generated API docs
- [Source Code](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/skill-curator)
- [Examples](https://github.com/Fengrru/awesome-agent-infra/tree/main/examples)

## License

MIT