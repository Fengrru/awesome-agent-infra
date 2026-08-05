# Quick Start

Agent Kit is a collection of 42 independent packages. **You don't install a whole framework** — install individual packages on demand; every one of them has zero runtime dependencies.

## Installation

```bash
# Install on demand (example: fuzzy patching + code graph)
npm install @fengrru/fuzzy-patch
npm install @fengrru/codegraph
```

Bun and pnpm work too:

```bash
bun add @fengrru/event-bus
```

## First example: agent file editing

```ts
import { readFileSync, writeFileSync } from "node:fs"
import { fuzzyFindAndReplace } from "@fengrru/fuzzy-patch"

const source = readFileSync("config.ts", "utf8")
const result = fuzzyFindAndReplace(source, "port = 3000", "port = 8080")

if (result.success) {
  writeFileSync("config.ts", result.content)
}
```

## Common combinations

| Scenario | Recommended packages |
|----------|----------------------|
| Memory & state | `@fengrru/agent-memory`, `@fengrru/agent-checkpoint` |
| Safe file operations | `@fengrru/txn-fs`, `@fengrru/fuzzy-patch` |
| Output validation | `@fengrru/valid8`, `@fengrru/confidence-gate` |
| Code understanding | `@fengrru/codegraph`, `@fengrru/agentic-search` |
| Task orchestration | `@fengrru/taskdag`, `@fengrru/state-machine` |
| Reasoning & planning | `@fengrru/reasoning-search`, `@fengrru/pomdp-planner` |
| Safety guardrails | `@fengrru/guardrail`, `@fengrru/code-sandbox` |
| Self-evolution | `@fengrru/skillforge`, `@fengrru/dreamdistill` |

## Full examples

The repository's [`examples/`](https://github.com/Fengrru/awesome-agent-infra/tree/main/examples) directory contains runnable examples for every core package:

```bash
git clone https://github.com/Fengrru/awesome-agent-infra.git
cd awesome-agent-infra/examples
bun install
bun run fuzzy-patch      # run the fuzzy-patch example
bun run agent-memory     # run the memory engine example
```

## Developing this repository

```bash
bun install              # install all workspace dependencies
bun run typecheck        # type checking
bun run test             # unit tests
bun run lint             # strict lint
```
