# 包目录

42 个包按能力分组。稳定性标记：Stable / Evolving / Experimental / Internal。

## Core Engines

| 包 | 描述 | 稳定性 |
|----|------|--------|
| [fuzzy-patch](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/fuzzy-patch) | 8 策略模糊文件补丁 | Stable |
| [valid8](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/valid8) | 4 层输出校验（语法/语义/运行时/安全） | Stable |
| [engine-db](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/engine-db) | 可插拔 SQLite 引擎，13 张表 | Stable |
| [txn-fs](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/txn-fs) | 事务性文件系统 + 三方合并 | Stable |
| [taskdag](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/taskdag) | DAG 执行引擎 + 增量重规划 | Evolving |
| [state-machine](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/state-machine) | 15 状态类型化 FSM | Stable |
| [event-bus](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/event-bus) | 优先级事件总线 + 批量持久化 | Stable |
| [worker](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/worker) | 无状态工作池 + 并发控制 | Stable |

## Memory & Knowledge

| 包 | 描述 | 稳定性 |
|----|------|--------|
| [agent-memory](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/agent-memory) | 4 层记忆 + Ebbinghaus 遗忘曲线 | Evolving |
| [memory-engine-v2](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/memory-engine-v2) | 5 层记忆 + 睡眠整合 + 注意力检索 | Evolving |
| [project-memory](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/project-memory) | 基于 MEMORY.md 的项目知识 | Evolving |
| [agent-checkpoint](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/agent-checkpoint) | 3 级检查点（L1/L2/L3） | Experimental |
| [checkpoint-writer](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/checkpoint-writer) | LLM 驱动 11 字段状态提取 | Experimental |
| [notes-manager](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/notes-manager) | 会话速记（notes.md） | Evolving |
| [embedding](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/embedding) | TF-IDF 向量索引 + 3 信号混合检索 | Stable |
| [engine-db](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/engine-db) | 会话事件存储（关系表 + 检查点 + 分支） | Stable |

## Safety & Repair

| 包 | 描述 | 稳定性 |
|----|------|--------|
| [guardrail](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/guardrail) | 运行时安全闸门 + 风险分级 | Experimental |
| [healix](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/healix) | 自愈错误分类器（Hamming 匹配） | Evolving |
| [goal-verifier](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/goal-verifier) | 独立目标完成度验证 | Evolving |
| [confidence-gate](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/confidence-gate) | LLM 输出置信度校准 | Experimental |
| [hallucination-detector](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/hallucination-detector) | 谱聚类幻觉检测 + 自一致性 | Experimental |
| [code-sandbox](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/code-sandbox) | 安全代码执行沙箱 + VerifierPool | Evolving |

## Search & Code Intelligence

| 包 | 描述 | 稳定性 |
|----|------|--------|
| [codegraph](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/codegraph) | 内存代码图 + PageRank 中心性 | Evolving |
| [agentic-search](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/agentic-search) | 4 层意图驱动搜索编排 | Evolving |
| [reasoning-search](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/reasoning-search) | MCTS 树搜索推理引擎 | Evolving |

## Workflow & Execution

| 包 | 描述 | 稳定性 |
|----|------|--------|
| [dynamic-workflow](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/dynamic-workflow) | VM 沙箱工作流引擎 | Experimental |
| [llm-dag-generator](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/llm-dag-generator) | LLM 驱动任务 DAG 生成 | Experimental |
| [lifecycle-manager](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/lifecycle-manager) | 声明式模块生命周期管理 | Evolving |
| [cycle-controller](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/cycle-controller) | 上下文窗口循环管理 | Experimental |

## Self-Evolution

| 包 | 描述 | 稳定性 |
|----|------|--------|
| [dreamdistill](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/dreamdistill) | 7 天梦境 + 30 天蒸馏自改进循环 | Experimental |
| [learning-nudge](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/learning-nudge) | 持续学习自省触发器 | Experimental |
| [max-mode-sampler](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/max-mode-sampler) | Best-of-N 并行计划采样 | Experimental |
| [skillforge](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/skillforge) | 智能体可写技能创建与管理 | Experimental |
| [skill-curator](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/skill-curator) | 技能库自动筛选 | Experimental |
| [agent-metacog](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/agent-metacog) | 元认知监控 + 知识边界检测 | Experimental |
| [process-reward](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/process-reward) | 过程奖励模型（MC rollout + 训练） | Experimental |

## Reasoning & Calibration

| 包 | 描述 | 稳定性 |
|----|------|--------|
| [pomdp-planner](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/pomdp-planner) | POMDP 规划器（粒子滤波 + QMDP） | Experimental |
| [reasoning-search](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/reasoning-search) | MCTS 推理引擎 | Evolving |

## Infrastructure

| 包 | 描述 | 稳定性 |
|----|------|--------|
| [tracing](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/tracing) | OpenTelemetry 抽象（no-op 回退） | Stable |
| [replay](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/replay) | 会话事件重放（dry-run/read-only/full） | Evolving |
| [branch](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/branch) | 会话分叉与分支管理 | Evolving |
| [archiver](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/archiver) | 事件归档（热/冷分层 + gzip） | Stable |

## Internal

| 包 | 描述 | 稳定性 |
|----|------|--------|
| [internal-tfidf](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/internal-tfidf) | 共享 TF-IDF 工具（私有） | Internal |

> 完整 API 文档见 [API 参考](/api/)。选择指南见[如何选择包](./guide/choosing-packages)。
