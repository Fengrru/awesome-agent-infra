# Packages

42 packages grouped by capability. Stability tiers: Stable / Evolving / Experimental / Internal.

## Core Engines

| Package | Description | Stability |
|---------|-------------|-----------|
| [fuzzy-patch](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/fuzzy-patch) | 8-strategy fuzzy file patching | Stable |
| [valid8](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/valid8) | 4-layer output validation (syntax/semantic/runtime/security) | Stable |
| [engine-db](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/engine-db) | Pluggable SQLite engine, 13 tables | Stable |
| [txn-fs](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/txn-fs) | Transactional file system + three-way merge | Stable |
| [taskdag](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/taskdag) | DAG execution engine + incremental replanning | Evolving |
| [state-machine](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/state-machine) | 15-state typed FSM | Stable |
| [event-bus](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/event-bus) | Priority event bus + batched persistence | Stable |
| [worker](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/worker) | Stateless worker pool + concurrency control | Stable |

## Memory & Knowledge

| Package | Description | Stability |
|---------|-------------|-----------|
| [agent-memory](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/agent-memory) | 4-tier memory + Ebbinghaus forgetting curve | Evolving |
| [memory-engine-v2](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/memory-engine-v2) | 5-tier memory + sleep consolidation + attention retrieval | Evolving |
| [project-memory](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/project-memory) | MEMORY.md-based project knowledge | Evolving |
| [agent-checkpoint](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/agent-checkpoint) | 3-level checkpoints (L1/L2/L3) | Experimental |
| [checkpoint-writer](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/checkpoint-writer) | LLM-driven 11-field state extraction | Experimental |
| [notes-manager](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/notes-manager) | Session notes (notes.md) | Evolving |
| [embedding](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/embedding) | TF-IDF vector index + 3-signal hybrid retrieval | Stable |
| [engine-db](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/engine-db) | Session event storage (relational tables + checkpoints + branching) | Stable |

## Safety & Repair

| Package | Description | Stability |
|---------|-------------|-----------|
| [guardrail](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/guardrail) | Runtime safety gate + risk tiering | Experimental |
| [healix](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/healix) | Self-healing error classifier (Hamming matching) | Evolving |
| [goal-verifier](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/goal-verifier) | Independent goal-completion verification | Evolving |
| [confidence-gate](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/confidence-gate) | LLM output confidence calibration | Experimental |
| [hallucination-detector](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/hallucination-detector) | Spectral-clustering hallucination detection + self-consistency | Experimental |
| [code-sandbox](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/code-sandbox) | Secure code execution sandbox + VerifierPool | Evolving |

## Search & Code Intelligence

| Package | Description | Stability |
|---------|-------------|-----------|
| [codegraph](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/codegraph) | In-memory code graph + PageRank centrality | Evolving |
| [agentic-search](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/agentic-search) | 4-layer intent-driven search orchestration | Evolving |
| [reasoning-search](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/reasoning-search) | MCTS tree-search reasoning engine | Evolving |

## Workflow & Execution

| Package | Description | Stability |
|---------|-------------|-----------|
| [dynamic-workflow](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/dynamic-workflow) | VM-sandboxed workflow engine | Experimental |
| [llm-dag-generator](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/llm-dag-generator) | LLM-driven task DAG generation | Experimental |
| [lifecycle-manager](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/lifecycle-manager) | Declarative module lifecycle management | Evolving |
| [cycle-controller](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/cycle-controller) | Context-window cycle management | Experimental |

## Self-Evolution

| Package | Description | Stability |
|---------|-------------|-----------|
| [dreamdistill](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/dreamdistill) | 7-day dreaming + 30-day distillation self-improvement loop | Experimental |
| [learning-nudge](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/learning-nudge) | Continuous-learning introspection triggers | Experimental |
| [max-mode-sampler](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/max-mode-sampler) | Best-of-N parallel plan sampling | Experimental |
| [skillforge](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/skillforge) | Agent-writable skill creation and management | Experimental |
| [skill-curator](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/skill-curator) | Automatic skill library curation | Experimental |
| [agent-metacog](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/agent-metacog) | Metacognitive monitoring + knowledge-boundary detection | Experimental |
| [process-reward](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/process-reward) | Process reward model (MC rollout + training) | Experimental |

## Reasoning & Calibration

| Package | Description | Stability |
|---------|-------------|-----------|
| [pomdp-planner](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/pomdp-planner) | POMDP planner (particle filter + QMDP) | Experimental |
| [reasoning-search](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/reasoning-search) | MCTS reasoning engine | Evolving |

## Infrastructure

| Package | Description | Stability |
|---------|-------------|-----------|
| [tracing](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/tracing) | OpenTelemetry abstraction (no-op fallback) | Stable |
| [replay](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/replay) | Session event replay (dry-run/read-only/full) | Evolving |
| [branch](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/branch) | Session forking and branch management | Evolving |
| [archiver](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/archiver) | Event archiving (hot/cold tiering + gzip) | Stable |

## Internal

| Package | Description | Stability |
|---------|-------------|-----------|
| [internal-tfidf](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/internal-tfidf) | Shared TF-IDF utilities (private) | Internal |

> See the [API Reference](/api/) for full API documentation, and [Choosing Packages](./guide/choosing-packages) for a selection guide.
