# Choosing Packages

A few packages overlap in functionality (a product of early exploration). This page is the authoritative selection guide so you don't install the wrong one.

## Memory: pick one of three

| Package | Positioning | When to choose it |
|---------|-------------|-------------------|
| `@fengrru/agent-memory` | 4-tier memory + Ebbinghaus forgetting curve | **Default choice.** Conversation memory, working memory, short/long-term tiers |
| `@fengrru/memory-engine-v2` | 5-tier memory + sleep consolidation + attention retrieval | Research-oriented scenarios needing sleep consolidation and attention-based retrieval |
| `@fengrru/agent-checkpoint` | 3-level checkpoints (L1/L2/L3) | Cross-session state persistence and crash recovery |

> **Rule of thumb**: `agent-memory` is the production default; `memory-engine-v2` is experimental; `checkpoint` is orthogonal to both (it handles persistence, not memory models).

## Validation: valid8 first, then confidence-gate

- **`@fengrru/valid8`**: 4-layer output validation (syntax/semantic/runtime/security) — checks "is the output legal"
- **`@fengrru/confidence-gate`**: confidence calibration, ECE/Brier evaluation, dynamic thresholds — decides "is the output trustworthy"

The two are orthogonal. Use `valid8` first to block illegal output, then `confidence-gate` to decide whether low-confidence output passes.

## Code graphs: codegraph is the only entry point

- **`@fengrru/codegraph`**: code graph + impact analysis + call-site tracking
- `@fengrru/agentic-search`: intent-driven cross-file search orchestration (can consume codegraph internally)

Use `codegraph` when you need to "understand the codebase"; use `agentic-search` when you need to "search the codebase".

## State orchestration: taskdag vs state-machine vs dynamic-workflow

| Package | Model | Scenario |
|---------|-------|----------|
| `@fengrru/taskdag` | DAG execution engine + incremental replanning | Task-graph dependency orchestration (default) |
| `@fengrru/state-machine` | 15-state FSM | Session-level state transition control |
| `@fengrru/dynamic-workflow` | VM-sandboxed workflows | Executing untrusted dynamic workflow definitions |

## Evolution: skillforge and dreamdistill

- `@fengrru/skillforge`: the "write" side — skill creation and management
- `@fengrru/skill-curator`: the "curate" side — automatic skill library curation
- `@fengrru/dreamdistill`: the self-improvement loop — 7-day dreaming + 30-day distillation

## Retrieval: embedding vs agentic-search

- `@fengrru/embedding`: TF-IDF vector index + hybrid retrieval (low-level capability)
- `@fengrru/agentic-search`: intent-recognition-driven search orchestration (high-level application)

Try `embedding` first; reach for `agentic-search` when you need multi-source search orchestration.
