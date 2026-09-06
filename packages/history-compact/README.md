# @fengrru/history-compact

Zero-dependency deterministic history compaction for agent event logs.

When a reconstructed working history exceeds a character threshold, completed
earlier rounds are folded into compact events whose `covers` cite the folded
event ids. The summary is deterministic and model-free, making it a safe
default when a model-based summarizer is unavailable or fails.

Extracted from the [seed self-hosted-agent](../../demo/self-hosted-agent/README.md)
project.

## Why

Agents with long sessions accumulate event logs that quickly overflow context
budgets. Compaction must be:

- **Deterministic**: the same events always produce the same fold plan and
  summary, so tests and replay stay reproducible.
- **Content-addressed**: compact events carry `covers` (event ids) whose
  integrity can be verified by `@fengrru/evidence-log`.
- **Conservative**: only complete rounds fold, and the most recent round is
  always preserved.

## Usage

```ts
import { createPlanCompaction, summarizeRound } from "@fengrru/history-compact"
import type { Event } from "@fengrru/evidence-log"

const planCompaction = createPlanCompaction((events, opts) => {
  // Render events into whatever serialized transcript you budget for.
  return events.filter((e) => !opts.skipIds?.has(e.id))
})

const folds = planCompaction(events, 30_000, new Set())
for (const fold of folds) {
  log.append({
    type: "compact",
    id: generateId(),
    ts: Date.now(),
    sessionId: "s1",
    covers: fold.covers,
    summary: fold.summary,
  })
}
```

## API

- `summarizeRound(events)` â€?model-free summary of one completed turn.
- `createPlanCompaction(reconstructHistory)` â€?returns a planner.
- `DEFAULT_COMPACT_THRESHOLD` â€?default 30,000 characters.
- `PlannedCompact` â€?`{ covers, events, summary }`.

## License

MIT. Extracted from the MIT-licensed seed project.
