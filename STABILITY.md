# API Stability Levels

Packages are categorized by their API stability guarantees. Breaking changes follow strict semver rules within each tier.

---

## Stable (semver minor = non-breaking)

These packages have well-defined public APIs with backward-compatibility guarantees. Minor version bumps add features; patch bumps fix bugs. Breaking changes require a major version.

| Package | Since | Key API |
|---|---|---|
| `@fengrru/txn-fs` | v0.1.0 | `TransactionFS`, `merge3`, `TxContext` |
| `@fengrru/event-bus` | v0.1.0 | `createSimpleEventBus`, `EventBus`, `PersistedEventBus` |
| `@fengrru/state-machine` | v0.1.0 | `AgentStateMachine`, `states`, `transitions` |
| `@fengrru/engine-db` | v0.1.0 | `EngineDatabase`, `SQLiteEngineDatabase` |
| `@fengrru/embedding` | v0.1.0 | `EnhancedTFIDF`, `CodeEmbeddingIndex`, `HybridSearchEngine` |
| `@fengrru/fuzzy-patch` | v0.1.0 | `patch`, strategies (insert/replace/delete/format/rename/extract/move/reorder) |
| `@fengrru/valid8` | v0.1.0 | `ValidationNetwork`, `evaluate`, `walkAST` |
| `@fengrru/tracing` | v0.1.0 | `createTracer`, `withSpan`, `TraceProvider` |
| `@fengrru/archiver` | v0.1.0 | `EventArchiver`, `loadArchive`, `shouldArchive` |
| `@fengrru/worker` | v0.1.0 | `StatelessWorkerPool`, `TrueWorkerPool` |

## Evolving (semver minor = may add/rename)

APIs are stable in practice but internal details, constructor signatures, or optional parameters may change in minor versions. New major versions may introduce coordinated breaking changes across families.

| Package | Since | Notes |
|---|---|---|
| `@fengrru/agent-memory` | v0.1.0 | `MemorySystem` API stable; `UnifiedMemoryBridge` evolving |
| `@fengrru/memory-engine-v2` | v0.1.0 | Store layer interfaces evolving; query syntax may change |
| `@fengrru/memory-graph` | v0.1.0 | CoW versioning + BFS cascade stable; retrieval mode schema evolving |
| `@fengrru/codegraph` | v0.1.0 | In-memory graph API stable; serialization format may change |
| `@fengrru/code-sandbox` | v0.1.0 | `VerifierPool` API stable; sandbox isolation model under review |
| `@fengrru/taskdag` | v0.1.0 | DAG execution stable; plan serialization format evolving |
| `@fengrru/reasoning-search` | v0.1.0 | MCTS core algorithm stable; strategy interfaces may evolve |
| `@fengrru/goal-verifier` | v0.1.0 | Verification pipeline stable; success criteria schema evolving |
| `@fengrru/healix` | v0.1.0 | Error classification stable; repair strategy registry evolving |
| `@fengrru/replay` | v0.1.0 | Replay engine stable; event format compatibility evolving |
| `@fengrru/notes-manager` | v0.1.0 | Scratchpad API stable; markdown parsing evolving |
| `@fengrru/project-memory` | v0.1.0 | MEMORY.md format stable; extraction rules evolving |
| `@fengrru/branch` | v0.1.0 | Fork/merge API stable; conflict resolution strategies evolving |
| `@fengrru/lifecycle-manager` | v0.1.0 | Module hooks stable; phase definitions evolving |
| `@fengrru/agentic-search` | v0.1.0 | Search orchestrator API stable; intent classifier evolving |

## Experimental (semver minor = may break)

Actively developed packages. Breaking changes may appear in minor versions. Feedback on API design is welcome.

| Package | Since | Notes |
|---|---|---|
| `@fengrru/dreamdistill` | v0.1.0 | Self-evolution pipeline; reinforcement mechanisms under design |
| `@fengrru/process-reward` | v0.1.0 | PRM training and inference; scoring rubric format evolving |
| `@fengrru/agent-metacog` | v0.1.0 | Metacognitive monitoring + 3-stream calibration; knowledge boundary detection tuning |
| `@fengrru/hallucination-detector` | v0.1.0 | Spectral clustering detection; pre-clustering heuristics evolving |
| `@fengrru/confidence-gate` | v0.1.0 | ECE/Brier calibration; threshold selection APIs evolving |
| `@fengrru/pomdp-planner` | v0.1.0 | Particle filter + QMDP; belief state representation evolving |
| `@fengrru/guardrail` | v0.1.0 | Runtime safety gating; risk classification thresholds evolving |
| `@fengrru/max-mode-sampler` | v0.1.0 | Best-of-N sampling; plan diversity metrics evolving |
| `@fengrru/cycle-controller` | v0.1.0 | Context window management; cycle detection heuristics evolving |
| `@fengrru/agent-checkpoint` | v0.1.0 | L1/L2/L3 snapshot format; serialization evolving |
| `@fengrru/checkpoint-writer` | v0.1.0 | 11-field extraction schema; LLM prompt format evolving |
| `@fengrru/llm-dag-generator` | v0.1.0 | DAG generation prompt; plan structure evolving |
| `@fengrru/dynamic-workflow` | v0.1.0 | VM-sandboxed workflow; execution model under review |
| `@fengrru/skillforge` | v0.1.0 | Agent-writeable skills; schema format evolving |
| `@fengrru/skill-curator` | v0.1.0 | Automated curation; library indexing evolving |
| `@fengrru/learning-nudge` | v0.1.0 | Self-reflection triggers; nudge scheduling evolving |

## Internal (not for external use)

These packages are internal implementation details. They may change without notice.

| Package | Notes |
|---|---|
| `@fengrru/internal-tfidf` | Shared TF-IDF utilities; private workspace package |

---

## Versioning Policy

- **Stable**: Follows strict semver. `0.x` -> `1.0` signals no remaining known issues. Breaking changes ONLY in major versions.
- **Evolving**: Follows semver with relaxed minor semantics. APIs are generally stable but may change.
- **Experimental**: No guarantees. `0.x` versions may break at any time.

All packages follow [Changesets](https://github.com/changesets/changesets) for changelog generation and version management.
