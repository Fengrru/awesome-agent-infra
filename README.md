# awesome-agent-infra

> **Awesome Agent Infrastructure** — 42 battle-tested, zero-dependency TypeScript packages for building reliable AI agents.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Runtime-Bun-000000)](https://bun.sh)
[![CI](https://img.shields.io/badge/CI-GitHub_Actions-2088FF)](.github/workflows/ci.yml)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

Zero runtime dependencies. Plug into any framework.

## Packages

### 🔧 Core Engines

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

### 🧠 Memory & Knowledge

| Package | Description | npm |
|---------|-------------|-----|
| [agent-memory](./packages/agent-memory) | 4-tier memory with Ebbinghaus forgetting curve | `@fengru/agent-memory` |
| [project-memory](./packages/project-memory) | File-based MEMORY.md project knowledge | `@fengru/project-memory` |
| [agent-checkpoint](./packages/agent-checkpoint) | 3-level checkpoint system (L1/L2/L3) | `@fengru/agent-checkpoint` |
| [checkpoint-writer](./packages/checkpoint-writer) | LLM-driven 11-field state extraction | `@fengru/checkpoint-writer` |
| [notes-manager](./packages/notes-manager) | Session scratchpad (notes.md) for MiMo Code | `@fengru/notes-manager` |
| [embedding](./packages/embedding) | TF-IDF vector indexing + 3-signal hybrid search | `@fengru/embedding` |

### 🛡️ Safety & Repair

| Package | Description | npm |
|---------|-------------|-----|
| [guardrail](./packages/guardrail) | Runtime safety guard with risk classification | `@fengru/guardrail` |
| [healix](./packages/healix) | Self-healing error classifier with Hamming distance matching | `@fengru/healix` |
| [goal-verifier](./packages/goal-verifier) | Independent goal completion verification | `@fengru/goal-verifier` |
| [confidence-gate](./packages/confidence-gate) | LLM output confidence calibration | `@fengru/confidence-gate` |

### 🔍 Search & Code Intelligence

| Package | Description | npm |
|---------|-------------|-----|
| [codegraph](./packages/codegraph) | In-memory code graph with PageRank centrality | `@fengru/codegraph` |
| [agentic-search](./packages/agentic-search) | 4-layer intent-driven search orchestrator | `@fengru/agentic-search` |
| [reasoning-search](./packages/reasoning-search) | MCTS tree search reasoning engine | `@fengru/reasoning-search` |

### ⚡ Workflow & Execution

| Package | Description | npm |
|---------|-------------|-----|
| [dynamic-workflow](./packages/dynamic-workflow) | VM-sandboxed workflow engine | `@fengru/dynamic-workflow` |
| [llm-dag-generator](./packages/llm-dag-generator) | LLM-driven task DAG generation | `@fengru/llm-dag-generator` |
| [lifecycle-manager](./packages/lifecycle-manager) | Declarative module lifecycle manager | `@fengru/lifecycle-manager` |

### 🧬 Self-Evolution

| Package | Description | npm |
|---------|-------------|-----|
| [dreamdistill](./packages/dreamdistill) | 7-day Dream + 30-day Distill self-improvement cycles | `@fengru/dreamdistill` |
| [learning-nudge](./packages/learning-nudge) | Self-reflection trigger for continuous learning | `@fengru/learning-nudge` |
| [max-mode-sampler](./packages/max-mode-sampler) | Best-of-N parallel plan sampling | `@fengru/max-mode-sampler` |
| [skillforge](./packages/skillforge) | Agent-writeable skill creation and management | `@fengru/skillforge` |
| [skill-curator](./packages/skill-curator) | Automated skill library curation | `@fengru/skill-curator` |
| [agent-metacog](./packages/agent-metacog) | Metacognitive monitoring with knowledge boundary detection | `@fengru/agent-metacog` |
| [process-reward](./packages/process-reward) | Process Reward Model (PRM) — MC rollout, heuristic scoring, step labeling, training | `@fengru/process-reward` |

### 🔧 Infrastructure

| Package | Description | npm |
|---------|-------------|-----|
| [cycle-controller](./packages/cycle-controller) | Context window cycle manager (MiMo Code) | `@fengru/cycle-controller` |
| [tracing](./packages/tracing) | OpenTelemetry tracing abstraction (no-op fallback) | `@fengru/tracing` |
| [replay](./packages/replay) | Session event replay (dry-run/read-only/full) | `@fengru/replay` |
| [branch](./packages/branch) | Session forking and branching manager | `@fengru/branch` |
| [archiver](./packages/archiver) | Event archiver with hot/cold tiering + gzip | `@fengru/archiver` |

### 🧪 Reasoning & Calibration

| Package | Description | npm |
|---------|-------------|-----|
| [pomdp-planner](./packages/pomdp-planner) | POMDP LLM planner (particle filter + QMDP + iterative rollout) | `@fengru/pomdp-planner` |
| [hallucination-detector](./packages/hallucination-detector) | Spectral clustering hallucination detection + self-consistency | `@fengru/hallucination-detector` |
| [code-sandbox](./packages/code-sandbox) | Secure code execution sandbox with VerifierPool | `@fengru/code-sandbox` |
| [memory-engine-v2](./packages/memory-engine-v2) | 5-layer memory engine with sleep consolidation + attention retrieval | `@fengru/memory-engine-v2` |

## Quick Start

```bash
# Install individual packages
npm install @fengru/fuzzy-patch
npm install @fengru/codegraph
npm install @fengru/event-bus

# Use in your agent
import { fuzzyFindAndReplace } from "@fengru/fuzzy-patch"
const result = fuzzyFindAndReplace(fileContent, oldText, newText)
```

## Development

```bash
bun install          # Install all dependencies
bun run build        # Build all packages (42 packages)
bun run test         # Run all tests
```

## License

MIT