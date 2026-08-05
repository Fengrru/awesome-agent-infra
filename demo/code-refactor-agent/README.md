# Code Refactor Agent Demo

End-to-end demo that showcases 11 key awesome-agent-infra packages working together in a realistic AI agent refactoring scenario.

## Packages Demonstrated

| Step | Package | Role |
|------|---------|------|
| 1 | `@fengrru/project-memory` | Load and persist project context (MEMORY.md) |
| 2a | `@fengrru/codegraph` | Build heterogeneous code graph, search symbols |
| 2b | `@fengrru/embedding` | Index code items with TF-IDF, semantic search |
| 3a | `@fengrru/llm-dag-generator` | Generate refactoring execution plan DAG |
| 3b | `@fengrru/taskdag` | Validate DAG structure, execute & track nodes |
| 4 | `@fengrru/valid8` | 4-layer validation (syntax, semantic, runtime, security) |
| 5 | `@fengrru/fuzzy-patch` | Fuzzy match & apply code patches (8 strategies) |
| 6a | `@fengrru/event-bus` | Publish/subscribe events throughout the workflow |
| 6b | `@fengrru/archiver` | Hot/cold tiering for event persistence |
| 7 | `@fengrru/state-machine` | Lifecycle state tracking (IDLE → ... → COMPLETED) |
| 8 | `@fengrru/confidence-gate` | Calibrate confidence, detect overconfidence |

## Quick Start

```bash
# From the repo root:
bun run demo/code-refactor-agent/src/index.ts

# Run tests:
cd demo/code-refactor-agent && bun test
```

## Workflow

The demo simulates an AI agent tasked with refactoring a synthetic "Mini-CRM" project:

1. **State start** — Agent enters the INITIALIZING state
2. **Memory load** — Project memory loaded from MEMORY.md with architecture decisions
3. **Code understanding** — CodeGraph builds a symbol graph; embedding indexes items for semantic search
4. **Plan generation** — LLM DAG generator creates an execution plan; TaskDAG validates and executes it
5. **Validation** — Valid8 runs syntax, semantic, runtime, and security checks on the patched code
6. **Patch application** — FuzzyPatch handles whitespace/indentation differences when applying patches
7. **Event recording** — EventBus publishes events; Archiver checks hot/cold tiering thresholds
8. **Confidence check** — ConfidenceGate calibrates on historical samples and evaluates the refactoring decision

## Output

The demo emits self-documenting console output at each step, including:
- State machine transitions with reasons
- Code graph node/edge counts
- DAG execution order
- Validation scores per layer
- Patch strategy used
- Calibration metrics (ECE, Brier score, temperature)
