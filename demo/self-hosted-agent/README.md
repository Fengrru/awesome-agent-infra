# Self-Hosted Agent (demo)

> **Reference demo** inside `awesome-agent-infra` — a self-hosting agent: a stable kernel loop
> over a writable, versioned, evidence-backed self. This is the former standalone
> [`seed`](https://github.com/Fengrru/seed) project, migrated into this monorepo as a demo
> workspace so its ideas live on as runnable, testable reference code alongside the packages
> they are being distilled into.

The agent runs a goal by repeatedly asking a model for the next step, executing it through a
uniform `Connection` interface, and persisting every event before it happens. What the agent
learns — memories, skills, self-reflections — is stored as versioned knowledge objects with
provenance and an evidence trail, and only verified skills are injected back into the context.
The evolution loop (learn → verify → consolidate → forget) runs by default, so the agent
genuinely gets better with use.

## Quick start

Requires [Bun](https://bun.sh) >= 1.3 and an OpenAI-compatible API (defaults to DeepSeek).

```bash
bun install
OPENAI_API_KEY=sk-... bun start
```

REPL commands: `/new` starts a fresh session, `/quit` exits. Pass a goal as an
argument to run a single task and exit instead of entering the REPL:

```bash
OPENAI_API_KEY=sk-... bun start "create a hello.py that prints hello"
```

## Environment variables

| Variable                   | Default                       | Meaning                                                        |
| -------------------------- | ----------------------------- | -------------------------------------------------------------- |
| `OPENAI_API_KEY`           | required                      | API key for the model                                          |
| `OPENAI_BASE_URL`          | `https://api.deepseek.com/v1` | OpenAI-compatible endpoint                                     |
| `AGENT_MODEL`              | `deepseek-chat`               | Model name                                                     |
| `AGENT_WORKSPACE`          | current directory             | Directory the fs/bash tools operate in                         |
| `AGENT_DB`                 | `./agent.db`                  | SQLite path (event log + knowledge store)                      |
| `AGENT_SESSION`            | `default`                     | Initial session id                                             |
| `AGENT_AUTO_HARVEST`       | `1`                           | Distill memories/skills after each successful run              |
| `AGENT_AUTO_VERIFY_SKILLS` | `0`                           | Run distilled skills' verification commands automatically      |
| `AGENT_AUTO_META`          | `1`                           | Write self-reflections when tools fail repeatedly              |
| `AGENT_CONFIRM`            | `0`                           | Ask for confirmation before reviewed tools (bash, search, MCP) |
| `AGENT_MCP`                | —                             | JSON array of MCP stdio servers                                |
| `AGENT_MCP_HTTP`           | —                             | JSON array of MCP HTTP servers                                 |
| `AGENT_EMBEDDING_MODEL`    | —                             | Enable embedding-based retrieval with this model               |
| `AGENT_COMPACT_THRESHOLD`  | `30000`                       | Fold completed earlier rounds into compact summaries           |
| `AGENT_LOG_RETENTION_DAYS` | `0` (off)                     | Archive event-log rows older than this many days               |

Legacy `SEED_*` variable names are still accepted as fallbacks for backward compatibility.

## Architecture

```
src/
  schema/     pure types (zod) for events, knowledge, connections
  store/      event log (content-hashed) + versioned knowledge store (SQLite)
  kernel/     the loop, context assembly, harvesting, verification, meta-cognition,
              cascade invalidation, consolidation
  connection/ tool adapters: builtin fs/bash, memory, skill, task, search, delegate, MCP
  model/      model adapters (OpenAI-compatible; fake for tests)
  session/    event log -> conversation transcript reconstruction (with task tree)
  eval/       learning benchmark (cold vs warm)
bench/        end-to-end systems benchmark
__tests__/    migrated seed test-suite (232 tests, no real network)
```

## Relationship to the packages

This demo is the reference consumer the monorepo builds towards: its distinctive primitives
(content-addressed event log, evidence-backed knowledge vault, usage-feedback retrieval,
deterministic history compaction) have been distilled into reusable `@fengrru/*` packages
under `packages/`. The demo now consumes those packages as workspace dependencies and only
retains local adapters for the OpenAI model, connection tools, and the kernel loop.

## Development

```bash
bun run typecheck   # tsc --noEmit
bun test            # migrated seed tests, no real network
bun run coverage    # test coverage report
bun run eval        # scenario benchmark (needs OPENAI_API_KEY)
bun run eval:evolution
bun run bench:smoke # local smoke benchmark (no network)
```
