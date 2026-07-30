# @fengru/learning-nudge

Self-reflection trigger for continuous learning in AI agents.

## Install

```bash
npm install @fengru/learning-nudge
```

## Quick Start

```typescript
import { LearningNudge } from "@fengru/learning-nudge"

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

## License

MIT