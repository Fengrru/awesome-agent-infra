# @fengrru/evidence-log

Zero-dependency, content-addressed, append-only event log for agents.

Every appended event is stored together with the hash of its canonical JSON.
Anything that cites an event later (knowledge records, compaction covers, usage
feedback) can verify the citation is still present and untampered.

Extracted from the [seed self-hosted-agent](../../demo/self-hosted-agent/README.md)
project; see `docs/` there for the surrounding design.

## Why

Self-hosting agents need an audit trail that is more than a stringly-typed
history table:

- **Immutable by convention**: events are only appended; retention deletes whole
  rows, never rewrites them.
- **Content-addressed**: the log stores `contentHash(event)` beside each row.
  Evidence checks recompute the hash and compare, so a flipped byte or a
  rewritten row is detected on verification.
- **Survivable reads**: a corrupt row is skipped with a warning, never crashes
  history reconstruction.
- **Driver-agnostic**: the package never imports a SQLite driver. You hand it
  one that satisfies the tiny `SqliteDb` surface (`run`/`query`). `bun:sqlite`
  and `node:sqlite` both qualify out of the box.

## Install

```sh
bun add @fengrru/evidence-log   # workspace: `workspace:*` inside this repo
```

## Usage

```ts
import { Database } from "bun:sqlite" // or node:sqlite
import { SqliteLog, validEvidenceIds } from "@fengrru/evidence-log"

const log = new SqliteLog(new Database("agent.db"))

log.append({ type: "turn", id: "t1", ts: Date.now(), sessionId: "s1", goal: "ship it" })
log.append({
  type: "step",
  id: "st1",
  ts: Date.now(),
  sessionId: "s1",
  tool: "bash",
  args: ["ls"],
})

// Citations are filtered down to ones that verify, so a write never points
// at missing or altered history.
const evidence = validEvidenceIds(log, ["st1", "does-not-exist"]) // ["st1"]

const check = log.verifyEvidence(["st1"])
// check.ok === true, check.invalid === []
```

## Events

A discriminated union over ten kinds, discriminated on `type`:

| kind | purpose |
| --- | --- |
| `step` / `result` | tool invocation and its outcome |
| `verdict` | judge/usage verdict over a step or session |
| `harvest` | distilled knowledge from a session |
| `turn` | session goal start |
| `done` | session finished (`stopped`: `done`/`max_steps`/`error`) |
| `task` | task-tree node lifecycle (`status`: `open`/`done`/`failed`/`abandoned`) |
| `consolidate` | knowledge consolidation pass summary |
| `compact` | history fold (`covers` cites the folded event ids) |
| `prune` | retention deletion record |

Every event requires `id`, `ts`, `sessionId`, and a kind-specific payload.
`parseEvent()` is the runtime guard that validates rows read back from storage
(the hand-written replacement for the original zod schema â€?this package has no
`zod` dependency).

## Querying

- `replay()` / `replaySince(ts)` â€?full or incremental history.
- `replaySession(sessionId)` â€?one session, ascending.
- `replayRecent(maxEvents)` â€?bounded tail for cheap statistics (guidance,
  meta-cognition) no matter how large the log grows.
- `eventsBefore(ts)` / `pruneBefore(ts)` â€?retention: archive then delete.
  Pruning intentionally breaks evidence citations into the pruned range; their
  verification fails from then on.

## API

Public exports: `Event` (and each kind), `EventType`, `parseEvent`, `Log`,
`SqliteLog`, `EvidenceCheck`, `validEvidenceIds`, `SqliteDb`,
`SqliteStatement`, `contentHash`, `stableStringify`.

Documentation site: [https://fengrru.github.io/awesome-agent-infra/](https://fengrru.github.io/awesome-agent-infra/)

## License

MIT. Extracted from the MIT-licensed seed project.
