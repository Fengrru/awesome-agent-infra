<div align="center">

# awesome-agent-infra

> **Awesome Agent Infrastructure** — 43 battle-tested, zero-dependency TypeScript packages for building reliable AI agents.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Runtime-Bun-000000)](https://bun.sh)
[![CI](https://github.com/Fengrru/awesome-agent-infra/actions/workflows/ci.yml/badge.svg)](https://github.com/Fengrru/awesome-agent-infra/actions/workflows/ci.yml)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

Zero runtime dependencies. Plug into any framework.

</div>

## Why awesome-agent-infra?

- **Zero dependencies, zero conflicts.** Every one of the 43 packages ships with no runtime dependencies — drop them into any agent stack without version fights or bloat.
- **One package per concern.** Memory, patching, validation, search, workflows, self-evolution — each building block is isolated, typed, and testable on its own.
- **Production-grade by default.** Every package carries tests, a 95%+ coverage gate, micro-benchmarks, and an explicit stability tier (stable / evolving / experimental).
- **TypeScript-native.** Written in strict TypeScript 5.8 with ESM-only output, so your IDE and compiler see exactly what your agent runs.

## Quick Start

```bash
npm install @fengru/fuzzy-patch
npm install @fengru/valid8
npm install @fengru/event-bus
```

**Fix code with fuzzy patching** — 8 strategies that survive LLM whitespace drift:

```ts
import { fuzzyFindAndReplace, canPatch } from "@fengru/fuzzy-patch"

const source = `const config = {
  port:   3000,
  host:  "localhost",
}`

// survives spacing differences between "port:   3000" and "port: 3000"
if (canPatch(source, "port: 3000")) {
  const { newContent, strategy, matchCount } = fuzzyFindAndReplace(source, "port:   3000", "port:   8080")
  console.log(`patched via ${strategy} (${matchCount} matches):`, newContent)
}
```

**Validate LLM output** — 4-layer validation network (syntax / semantic / runtime / security):

```ts
import { createValidationNetwork } from "@fengru/valid8"

const network = createValidationNetwork()

const code = "export function add(a: number, b: number) {\n  return a + b\n}\n"
const syntax = await network.runSyntaxValidation(code, "add.ts")
const security = await network.runSecurityValidation(code)
console.log("confidence:", network.calculateConfidence([syntax, security]).score)
```

**Wire up agent events** — typed priority event bus with batch persistence:

```ts
import { createSimpleEventBus, EventPriority, EventType } from "@fengru/event-bus"

const bus = createSimpleEventBus()

bus.subscribe(EventType.TOOL_RESULT, (event) => {
  console.log(`tool ${event.data.toolName} -> ${event.data.status}`)
})

bus.publish({
  type: EventType.TOOL_RESULT,
  source: "agent",
  session_id: "session-1",
  data: { toolName: "read_file", status: "ok" },
  priority: EventPriority.NORMAL,
})
```

More runnable examples live in [examples/](./examples).

## How to choose a package

| I want to… | Start with |
|---|---|
| Apply reliable edits to files | `fuzzy-patch`, `txn-fs`, `codegraph` |
| Validate / verify agent output | `valid8`, `confidence-gate`, `goal-verifier` |
| Give my agent memory | `agent-memory`, `memory-graph`, `memory-engine-v2`, `embedding`, `project-memory` |
| Keep the agent safe | `guardrail`, `healix`, `hallucination-detector` |
| Orchestrate multi-step work | `taskdag`, `state-machine`, `dynamic-workflow` |
| Search and reason | `agentic-search`, `reasoning-search`, `code-sandbox` |
| Observe and replay sessions | `tracing`, `replay`, `archiver`, `event-bus` |
| Let the agent improve itself | `skillforge`, `skill-curator`, `dreamdistill`, `learning-nudge` |

See [choosing-packages guide](https://fengrru.github.io/awesome-agent-infra/guide/choosing-packages) for the full decision flow.

## Packages

### Core Engines

| Package | Description | npm |
|---------|-------------|-----|
| [fuzzy-patch](./packages/fuzzy-patch) | 8-strategy fuzzy file patching for AI agents | `@fengru/fuzzy-patch` |
| [valid8](./packages/valid8) | 4-layer output validation (syntax/semantic/runtime/security) | `@fengru/valid8` |
| [engine-db](./packages/engine-db) | Pluggable SQLite engine with 13 tables | `@fengru/engine-db` |
| [txn-fs](./packages/txn-fs) | Transactional filesystem with 3-way merge | `@fengru/txn-fs` |
| [taskdag](./packages/taskdag) | DAG execution engine with incremental replanning | `@fengru/taskdag` |
| [state-machine](./packages/state-machine) | 15-state typed FSM for agent sessions | `@fengru/state-machine` |
| [event-bus](./packages/event-bus) | Priority event bus with batch persistence | `@fengru/event-bus` |
| [worker](./packages/worker) | Stateless worker pool with concurrency control | `@fengru/worker` |

### Memory & Knowledge

| Package | Description | npm |
|---------|-------------|-----|
| [agent-memory](./packages/agent-memory) | 4-tier memory with Ebbinghaus forgetting curve | `@fengru/agent-memory` |
| [memory-graph](./packages/memory-graph) | Causal dependency graph with CoW versioning + BFS cascade invalidation | `@fengru/memory-graph` |
| [project-memory](./packages/project-memory) | File-based MEMORY.md project knowledge | `@fengru/project-memory` |
| [agent-checkpoint](./packages/agent-checkpoint) | 3-level checkpoint system (L1/L2/L3) | `@fengru/agent-checkpoint` |
| [checkpoint-writer](./packages/checkpoint-writer) | LLM-driven 11-field state extraction | `@fengru/checkpoint-writer` |
| [notes-manager](./packages/notes-manager) | Session scratchpad (notes.md) for MiMo Code | `@fengru/notes-manager` |
| [embedding](./packages/embedding) | TF-IDF vector indexing + 3-signal hybrid search | `@fengru/embedding` |

### Safety & Repair

| Package | Description | npm |
|---------|-------------|-----|
| [guardrail](./packages/guardrail) | Runtime safety guard with risk classification | `@fengru/guardrail` |
| [healix](./packages/healix) | Self-healing error classifier with Hamming distance matching | `@fengru/healix` |
| [goal-verifier](./packages/goal-verifier) | Independent goal completion verification | `@fengru/goal-verifier` |
| [confidence-gate](./packages/confidence-gate) | LLM output confidence calibration | `@fengru/confidence-gate` |

### Search & Code Intelligence

| Package | Description | npm |
|---------|-------------|-----|
| [codegraph](./packages/codegraph) | In-memory code graph with PageRank centrality | `@fengru/codegraph` |
| [agentic-search](./packages/agentic-search) | 4-layer intent-driven search orchestrator | `@fengru/agentic-search` |
| [reasoning-search](./packages/reasoning-search) | MCTS tree search reasoning engine | `@fengru/reasoning-search` |

### Workflow & Execution

| Package | Description | npm |
|---------|-------------|-----|
| [dynamic-workflow](./packages/dynamic-workflow) | VM-sandboxed workflow engine | `@fengru/dynamic-workflow` |
| [llm-dag-generator](./packages/llm-dag-generator) | LLM-driven task DAG generation | `@fengru/llm-dag-generator` |
| [lifecycle-manager](./packages/lifecycle-manager) | Declarative module lifecycle manager | `@fengru/lifecycle-manager` |

### Self-Evolution

| Package | Description | npm |
|---------|-------------|-----|
| [dreamdistill](./packages/dreamdistill) | 7-day Dream + 30-day Distill self-improvement cycles | `@fengru/dreamdistill` |
| [learning-nudge](./packages/learning-nudge) | Self-reflection trigger for continuous learning | `@fengru/learning-nudge` |
| [max-mode-sampler](./packages/max-mode-sampler) | Best-of-N parallel plan sampling | `@fengru/max-mode-sampler` |
| [skillforge](./packages/skillforge) | Agent-writeable skill creation and management | `@fengru/skillforge` |
| [skill-curator](./packages/skill-curator) | Automated skill library curation | `@fengru/skill-curator` |
| [agent-metacog](./packages/agent-metacog) | Metacognitive monitoring with knowledge boundary detection | `@fengru/agent-metacog` |
| [process-reward](./packages/process-reward) | Process Reward Model (PRM) — MC rollout, heuristic scoring, step labeling, training | `@fengru/process-reward` |

### Infrastructure

| Package | Description | npm |
|---------|-------------|-----|
| [cycle-controller](./packages/cycle-controller) | Context window cycle manager (MiMo Code) | `@fengru/cycle-controller` |
| [tracing](./packages/tracing) | OpenTelemetry tracing abstraction (no-op fallback) | `@fengru/tracing` |
| [replay](./packages/replay) | Session event replay (dry-run/read-only/full) | `@fengru/replay` |
| [branch](./packages/branch) | Session forking and branching manager | `@fengru/branch` |
| [archiver](./packages/archiver) | Event archiver with hot/cold tiering + gzip | `@fengru/archiver` |

### Reasoning & Calibration

| Package | Description | npm |
|---------|-------------|-----|
| [pomdp-planner](./packages/pomdp-planner) | POMDP LLM planner (particle filter + QMDP + iterative rollout) | `@fengru/pomdp-planner` |
| [hallucination-detector](./packages/hallucination-detector) | Spectral clustering hallucination detection + self-consistency | `@fengru/hallucination-detector` |
| [code-sandbox](./packages/code-sandbox) | Secure code execution sandbox with VerifierPool | `@fengru/code-sandbox` |
| [memory-engine-v2](./packages/memory-engine-v2) | 5-layer memory engine with sleep consolidation + attention retrieval | `@fengru/memory-engine-v2` |

## Documentation

- **Docs site** — [fengrru.github.io/awesome-agent-infra](https://fengrru.github.io/awesome-agent-infra/) — quickstart, architecture overview, package selection guide, stability policy
- **Examples** — [examples/](./examples) — runnable usage snippets for 12 core packages (`bun run examples/fuzzy-patch.ts`)
- **Benchmarks** — [benchmarks/](./benchmarks) — micro-benchmarks for hot paths (`bun run benchmarks/run-all.ts`)
- **Stability matrix** — [STABILITY.md](./STABILITY.md) — per-package tier and versioning policy

## Stability

Every package carries an explicit stability tier — see [STABILITY.md](STABILITY.md) for the full matrix and versioning policy.

| Tier | Guarantee | Packages |
|---|---|---|
| Stable | Strict semver; breaking changes only in majors | txn-fs, event-bus, state-machine, engine-db, embedding, fuzzy-patch, valid8, tracing, archiver, worker |
| Evolving | API stable in practice; minor versions may adjust details | agent-memory, memory-graph, memory-engine-v2, codegraph, code-sandbox, taskdag, reasoning-search, goal-verifier, healix, replay, notes-manager, project-memory, branch, lifecycle-manager, agentic-search |
| Experimental | No guarantees; minor versions may break | dreamdistill, process-reward, agent-metacog, hallucination-detector, confidence-gate, pomdp-planner, guardrail, max-mode-sampler, cycle-controller, agent-checkpoint, checkpoint-writer, llm-dag-generator, dynamic-workflow, skillforge, skill-curator, learning-nudge |

Experimental packages are marked with an **Experimental** notice in their README. All packages follow [Changesets](https://github.com/changesets/changesets) for versioning.

## Development

```bash
bun install                          # Install all dependencies
bun run build                        # Build all packages (43 packages)
bun run test                         # Run all tests
bun run lint                         # Biome strict lint
bun scripts/check-coverage.ts        # Coverage gate (95%+ per package)
bun run benchmarks/run-all.ts        # Micro-benchmarks
```

## Contributing

All contributions are welcome — code, tests, docs, and issue triage. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) and check the [issue templates](./.github/ISSUE_TEMPLATE/) before opening a PR.

## Security

Report security issues privately — see [SECURITY.md](./SECURITY.md) for the disclosure policy.

## License

MIT — see [LICENSE](./LICENSE).
