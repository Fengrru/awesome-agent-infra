# Agent Kit Examples

One runnable example per core package. All examples import package source directly (zero dependencies, no build step) and demonstrate real API usage.

## Running

```bash
bun install
bun run fuzzy-patch      # fuzzy patching
bun run event-bus        # event bus
bun run state-machine    # state machine
bun run agent-memory     # memory system
bun run confidence-gate  # confidence gating
bun run codegraph        # code graph
bun run txn-fs           # transactional file system
bun run valid8           # output validation
bun run worker           # worker pool
bun run tracing          # distributed tracing
bun run taskdag          # DAG task orchestration
bun run guardrail        # safety gate
```

## Example overview

| Example | What it demonstrates |
|---------|----------------------|
| [fuzzy-patch.ts](./fuzzy-patch.ts) | 8-strategy fuzzy match & replace, handling missing/extra whitespace |
| [event-bus.ts](./event-bus.ts) | Priority pub/sub, event waiting |
| [state-machine.ts](./state-machine.ts) | 15-state transitions, enter/exit hooks, guards |
| [agent-memory.ts](./agent-memory.ts) | Memory writes, composite retrieval scoring, context assembly |
| [confidence-gate.ts](./confidence-gate.ts) | Calibration sample fitting, ECE evaluation, confidence gating |
| [codegraph.ts](./codegraph.ts) | Code graph building, symbol lookup, impact analysis |
| [txn-fs.ts](./txn-fs.ts) | Transaction begin/edit/commit/rollback, conflict handling |
| [valid8.ts](./valid8.ts) | Syntax + security two-layer validation, confidence scoring |
| [worker.ts](./worker.ts) | Capability registration, parallel task execution, metrics |
| [tracing.ts](./tracing.ts) | Nested spans, attribute/event/exception recording |
| [taskdag.ts](./taskdag.ts) | DAG validation, ready-node scheduling, failure propagation |
| [guardrail.ts](./guardrail.ts) | Entropy risk metric evaluation, control action decisions |
