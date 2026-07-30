# API Stability Levels

Packages are categorized by their API stability guarantees. Breaking changes follow strict semver rules within each tier.

---

## Stable (semver minor = non-breaking)

These packages have well-defined public APIs with backward-compatibility guarantees. Minor version bumps add features; patch bumps fix bugs. Breaking changes require a major version.

| Package | Since | Key API |
|---|---|---|
| `@fengru/txn-fs` | v0.1.0 | `TransactionFS`, `merge3`, `TxContext` |
| `@fengru/event-bus` | v0.1.0 | `createSimpleEventBus`, `EventBus`, `PersistedEventBus` |
| `@fengru/state-machine` | v0.1.0 | `AgentStateMachine`, `states`, `transitions` |
| `@fengru/engine-db` | v0.1.0 | `EngineDatabase`, `SQLiteEngineDatabase` |
| `@fengru/embedding` | v0.1.0 | `EnhancedTFIDF`, `CodeEmbeddingIndex`, `HybridSearchEngine` |
| `@fengru/fuzzy-patch` | v0.1.0 | `patch`, strategies (insert/replace/delete/format/rename/extract/move/reorder) |
| `@fengru/valid8` | v0.1.0 | `ValidationNetwork`, `evaluate`, `walkAST` |
| `@fengru/tracing` | v0.1.0 | `createTracer`, `withSpan`, `TraceProvider` |
| `@fengru/archiver` | v0.1.0 | `EventArchiver`, `loadArchive`, `shouldArchive` |
| `@fengru/worker` | v0.1.0 | `StatelessWorkerPool`, `TrueWorkerPool` |

## Evolving (semver minor = may add/rename)

APIs are stable in practice but internal details, constructor signatures, or optional parameters may change in minor versions. New major versions may introduce coordinated breaking changes across families.

| Package | Since | Notes |
|---|---|---|
| `@fengru/agent-memory` | v0.1.0 | `MemorySystem` API stable; `UnifiedMemoryBridge` evolving |
| `@fengru/memory-engine-v2` | v0.1.0 | Store layer interfaces evolving; query syntax may change |
| `@fengru/codegraph` | v0.1.0 | In-memory graph API stable; serialization format may change |
| `@fengru/code-sandbox` | v0.1.0 | `VerifierPool` API stable; sandbox isolation model under review |
| `@fengru/taskdag` | v0.1.0 | DAG execution stable; plan serialization format evolving |
| `@fengru/reasoning-search` | v0.1.0 | MCTS core algorithm stable; strategy interfaces may evolve |
| `@fengru/goal-verifier` | v0.1.0 | Verification pipeline stable; success criteria schema evolving |
| `@fengru/healix` | v0.1.0 | Error classification stable; repair strategy registry evolving |
| `@fengru/replay` | v0.1.0 | Replay engine stable; event format compatibility evolving |
| `@fengru/notes-manager` | v0.1.0 | Scratchpad API stable; markdown parsing evolving |
| `@fengru/project-memory` | v0.1.0 | MEMORY.md format stable; extraction rules evolving |
| `@fengru/branch` | v0.1.0 | Fork/merge API stable; conflict resolution strategies evolving |
| `@fengru/lifecycle-manager` | v0.1.0 | Module hooks stable; phase definitions evolving |
| `@fengru/agentic-search` | v0.1.0 | Search orchestrator API stable; intent classifier evolving |

## Experimental (semver minor = may break)

Actively developed packages. Breaking changes may appear in minor versions. Feedback on API design is welcome.

| Package | Since | Notes |
|---|---|---|
| `@fengru/dreamdistill` | v0.1.0 | Self-evolution pipeline; reinforcement mechanisms under design |
| `@fengru/process-reward` | v0.1.0 | PRM training and inference; scoring rubric format evolving |
| `@fengru/agent-metacog` | v0.1.0 | Metacognitive monitoring; knowledge boundary detection tuning |
| `@fengru/metacog-calibrator` | v0.1.0 | 3-stream Transformer calibration; model loading API unstable |
| `@fengru/hallucination-detector` | v0.1.0 | Spectral clustering detection; pre-clustering heuristics evolving |
| `@fengru/confidence-gate` | v0.1.0 | ECE/Brier calibration; threshold selection APIs evolving |
| `@fengru/pomdp-planner` | v0.1.0 | Particle filter + QMDP; belief state representation evolving |
| `@fengru/guardrail` | v0.1.0 | Runtime safety gating; risk classification thresholds evolving |
| `@fengru/max-mode-sampler` | v0.1.0 | Best-of-N sampling; plan diversity metrics evolving |
| `@fengru/cycle-controller` | v0.1.0 | Context window management; cycle detection heuristics evolving |
| `@fengru/agent-checkpoint` | v0.1.0 | L1/L2/L3 snapshot format; serialization evolving |
| `@fengru/checkpoint-writer` | v0.1.0 | 11-field extraction schema; LLM prompt format evolving |
| `@fengru/llm-dag-generator` | v0.1.0 | DAG generation prompt; plan structure evolving |
| `@fengru/dynamic-workflow` | v0.1.0 | VM-sandboxed workflow; execution model under review |
| `@fengru/skillforge` | v0.1.0 | Agent-writeable skills; schema format evolving |
| `@fengru/skill-curator` | v0.1.0 | Automated curation; library indexing evolving |
| `@fengru/learning-nudge` | v0.1.0 | Self-reflection triggers; nudge scheduling evolving |

## Internal (not for external use)

These packages are internal implementation details. They may change without notice.

| Package | Notes |
|---|---|
| `@fengru/internal-tfidf` | Shared TF-IDF utilities; private workspace package |

---

## Versioning Policy

- **Stable**: Follows strict semver. `0.x` -> `1.0` signals no remaining known issues. Breaking changes ONLY in major versions.
- **Evolving**: Follows semver with relaxed minor semantics. APIs are generally stable but may change.
- **Experimental**: No guarantees. `0.x` versions may break at any time.

All packages follow [Changesets](https://github.com/changesets/changesets) for changelog generation and version management.
