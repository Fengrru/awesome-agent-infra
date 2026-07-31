# @fengru/skillforge

[![npm version](https://img.shields.io/npm/v/@fengru/skillforge)](https://www.npmjs.com/package/@fengru/skillforge) [![npm downloads](https://img.shields.io/npm/dm/@fengru/skillforge)](https://www.npmjs.com/package/@fengru/skillforge) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)

> **Experimental** — API may break in minor versions. See [STABILITY.md](../../STABILITY.md).

Agent-writeable skill creation and management system.

## Install

```bash
npm install @fengru/skillforge
```

## Quick Start

```typescript
import { SkillManager } from "@fengru/skillforge"

const manager = new SkillManager({ skillsDir: "./skills" })

// Create skill
await manager.createSkill({
  name: "error-handling",
  description: "Best practices for error handling",
  content: "Use try-catch blocks...",
  tags: ["patterns", "errors"],
})

// Load skill (progressive loading)
const skill = manager.loadSkill("error-handling")

// Search skills
const results = manager.searchSkills("error")

// Patch skill
await manager.patchSkill("error-handling", {
  oldText: "Use try-catch",
  newText: "Use try-catch with specific error types",
})
```

## Progressive Loading

| Level | Contents |
|-------|----------|
| L0 | Name index only |
| L1 | Full skill metadata |
| L2 | Body + attached files |

## Features

- **SKILL.md format**: frontmatter + body
- **Fuzzy patching**: 8-strategy matching
- **Auto-archive**: delete → .archive/
- **Pin/unpin**: prioritize important skills
- **Usage tracking**: record access patterns


## Documentation

- [API Reference](https://fengrru.github.io/awesome-agent-infra/api/) — TypeDoc-generated API docs
- [Source Code](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/skillforge)
- [Examples](https://github.com/Fengrru/awesome-agent-infra/tree/main/examples)
## License

MIT