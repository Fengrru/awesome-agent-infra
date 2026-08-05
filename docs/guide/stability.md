# 稳定性与版本

所有包遵循 [semver](https://semver.org/)，并通过 Changesets 管理发版。包按 API 稳定性承诺分为 4 级（详见仓库 [STABILITY.md](https://github.com/Fengrru/awesome-agent-infra/blob/main/STABILITY.md)）。

## 稳定性分级

### Stable — 破坏性变更仅限大版本

| 包 | 关键 API |
|----|----------|
| `@fengrru/txn-fs` | `TransactionFS`、`merge3`、`TxContext` |
| `@fengrru/event-bus` | `createSimpleEventBus`、`EventBus`、`PersistedEventBus` |
| `@fengrru/state-machine` | `AgentStateMachine`、`states`、`transitions` |
| `@fengrru/engine-db` | `EngineDatabase`、`SQLiteEngineDatabase` |
| `@fengrru/embedding` | `EnhancedTFIDF`、`CodeEmbeddingIndex`、`HybridSearchEngine` |
| `@fengrru/fuzzy-patch` | `patch`、8 种匹配策略 |
| `@fengrru/valid8` | `ValidationNetwork`、`evaluate`、`walkAST` |
| `@fengrru/tracing` | `createTracer`、`withSpan`、`TraceProvider` |
| `@fengrru/archiver` | `EventArchiver`、`loadArchive`、`shouldArchive` |
| `@fengrru/worker` | `StatelessWorkerPool`、`TrueWorkerPool` |

### Evolving — 小版本可能调整

`agent-memory`、`memory-engine-v2`、`codegraph`、`code-sandbox`、`taskdag`、`reasoning-search`、`goal-verifier`、`healix`、`replay`、`notes-manager`、`project-memory`、`branch`、`lifecycle-manager`、`agentic-search`

这些包 API 在实践中稳定，但内部细节、构造签名或可选参数可能在小版本中变化。

### Experimental — 小版本可能破坏

`dreamdistill`、`process-reward`、`agent-metacog`、`hallucination-detector`、`confidence-gate`、`pomdp-planner`、`guardrail`、`max-mode-sampler`、`cycle-controller`、`agent-checkpoint`、`checkpoint-writer`、`llm-dag-generator`、`dynamic-workflow`、`skillforge`、`skill-curator`、`learning-nudge`

活跃开发中的包。API 反馈欢迎，但 `0.x` 版本可能随时破坏。

### Internal — 勿直接使用

`@fengrru/internal-tfidf`：私有工作区包，不对外发布，仅被内部消费。

## 版本策略

| 级别 | 语义 |
|------|------|
| Stable | 严格 semver。`0.x → 1.0` 表示无已知遗留问题。破坏性变更仅出现在大版本 |
| Evolving | semver 放宽的 minor 语义。API 大体稳定但可能变化 |
| Experimental | 无保证。`0.x` 随时可能破坏 |

## 升级路径

```bash
npm view @fengrru/event-bus versions   # 查看版本
npm install @fengrru/event-bus@latest  # 升级
```

每次发布都会自动生成 CHANGELOG（Changesets），破坏性变更会在 changelog 中明确标注 `BREAKING CHANGE`。
