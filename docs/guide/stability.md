# Stability & Versioning

All packages follow [semver](https://semver.org/) and are released via Changesets. Packages are divided into 4 tiers by API stability commitment (see [STABILITY.md](https://github.com/Fengrru/awesome-agent-infra/blob/main/STABILITY.md) in the repository).

## Stability tiers

### Stable — breaking changes only in major versions

| Package | Key APIs |
|---------|----------|
| `@fengrru/txn-fs` | `TransactionFS`, `merge3`, `TxContext` |
| `@fengrru/event-bus` | `createSimpleEventBus`, `EventBus`, `PersistedEventBus` |
| `@fengrru/state-machine` | `AgentStateMachine`, `states`, `transitions` |
| `@fengrru/engine-db` | `EngineDatabase`, `SQLiteEngineDatabase` |
| `@fengrru/embedding` | `EnhancedTFIDF`, `CodeEmbeddingIndex`, `HybridSearchEngine` |
| `@fengrru/fuzzy-patch` | `patch`, 8 matching strategies |
| `@fengrru/valid8` | `ValidationNetwork`, `evaluate`, `walkAST` |
| `@fengrru/tracing` | `createTracer`, `withSpan`, `TraceProvider` |
| `@fengrru/archiver` | `EventArchiver`, `loadArchive`, `shouldArchive` |
| `@fengrru/worker` | `StatelessWorkerPool`, `TrueWorkerPool` |

### Evolving — minor versions may adjust

`agent-memory`, `memory-engine-v2`, `codegraph`, `code-sandbox`, `taskdag`, `reasoning-search`, `goal-verifier`, `healix`, `replay`, `notes-manager`, `project-memory`, `branch`, `lifecycle-manager`, `agentic-search`

These packages have stable APIs in practice, but internal details, constructor signatures, or optional parameters may change in minor versions.

### Experimental — minor versions may break

`dreamdistill`, `process-reward`, `agent-metacog`, `hallucination-detector`, `confidence-gate`, `pomdp-planner`, `guardrail`, `max-mode-sampler`, `cycle-controller`, `agent-checkpoint`, `checkpoint-writer`, `llm-dag-generator`, `dynamic-workflow`, `skillforge`, `skill-curator`, `learning-nudge`

Packages under active development. API feedback is welcome, but `0.x` versions may break at any time.

### Internal — do not use directly

`@fengrru/internal-tfidf`: a private workspace package, never published, consumed internally only.

## Versioning policy

| Tier | Semantics |
|------|-----------|
| Stable | Strict semver. `0.x → 1.0` signals no known outstanding issues. Breaking changes only in major versions |
| Evolving | Relaxed minor semantics under semver. APIs are largely stable but may change |
| Experimental | No guarantees. `0.x` may break at any time |

## Upgrade path

```bash
npm view @fengrru/event-bus versions   # list versions
npm install @fengrru/event-bus@latest  # upgrade
```

Every release automatically generates a CHANGELOG (via Changesets); breaking changes are explicitly marked `BREAKING CHANGE` in the changelog.
