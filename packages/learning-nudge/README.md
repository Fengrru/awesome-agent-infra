# @fengrru/learning-nudge

[![npm version](https://img.shields.io/npm/v/@fengrru/learning-nudge)](https://www.npmjs.com/package/@fengrru/learning-nudge) [![npm downloads](https://img.shields.io/npm/dm/@fengrru/learning-nudge)](https://www.npmjs.com/package/@fengrru/learning-nudge) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)

> **Experimental** — API may break in minor versions. See [STABILITY.md](../../STABILITY.md).

Self-reflection trigger for continuous learning in AI agents.

## Install

```bash
npm install @fengrru/learning-nudge
```

## Quick Start

```typescript
import { LearningNudge } from "@fengrru/learning-nudge"

const nudge = new LearningNudge({
  minToolCalls: 10,
  patternThreshold: 3,
})

// Evaluate if nudge is needed
const evaluation = nudge.evaluate(toolCallHistory)
if (evaluation.shouldNudge) {
  const result = await nudge.executeNudge(context)
  // result.insights — high-confidence learnings
  // result.suggestedSkills — patterns to formalize
}
```

## Trigger Types

| Type | Trigger | Priority |
|------|---------|----------|
| periodic | Every N tool calls | 4 |
| session_end | Session complete | 5 |
| pattern_detection | Same success ≥3 times | 6 |
| user_declaration | "Remember this" | highest |

## Features

- **Pattern detection**: identifies repeated successful capabilities
- **Automatic skill creation**: suggests formalizing patterns
- **Memory persistence**: high-confidence insights saved
- **Non-blocking**: works in background


## Documentation

- [API Reference](https://fengrru.github.io/awesome-agent-infra/api/) — TypeDoc-generated API docs
- [Source Code](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/learning-nudge)
- [Examples](https://github.com/Fengrru/awesome-agent-infra/tree/main/examples)
## License

MIT