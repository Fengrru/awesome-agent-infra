# 架构总览

Agent Kit 不是单一框架，而是**按能力分层**的 42 个独立包。每个包可单独使用，也可自由组合成完整的智能体基础设施。

## 分层视图

```text
┌─────────────────────────────────────────────────────────┐
│                     Self-Evolution 层                    │
│  dreamdistill · skillforge · skill-curator · learning-  │
│  nudge · max-mode-sampler · agent-metacog · process-    │
│  reward                                                 │
├─────────────────────────────────────────────────────────┤
│                Reasoning & Planning 层                  │
│  reasoning-search · pomdp-planner · taskdag · llm-dag-  │
│  generator · dynamic-workflow · state-machine · worker  │
├─────────────────────────────────────────────────────────┤
│                Code Intelligence 层                     │
│  codegraph · agentic-search · fuzzy-patch · healix ·    │
│  project-memory · notes-manager                         │
├─────────────────────────────────────────────────────────┤
│                    Safety & QA 层                        │
│  guardrail · valid8 · confidence-gate · code-sandbox ·  │
│  hallucination-detector · goal-verifier                 │
├─────────────────────────────────────────────────────────┤
│                 Memory & Persistence 层                  │
│  agent-memory · memory-engine-v2 · embedding · agent-   │
│  checkpoint · checkpoint-writer · engine-db · txn-fs ·  │
│  archiver · replay · branch                             │
├─────────────────────────────────────────────────────────┤
│                      Core 层                             │
│  event-bus · tracing · cycle-controller · lifecycle-    │
│  manager · worker · max-mode-sampler                    │
└─────────────────────────────────────────────────────────┘
```

## 核心设计原则

### 1. 零运行时依赖

每个包的 `package.json` 都没有运行时依赖——只使用 Node.js 内置模块（`node:crypto`、`node:vm`、`node:fs` 等）。这意味着：

- 安装快、体积小
- 无供应链风险（npm 的依赖注入攻击面为零）
- 可与任何框架共存（LangChain、Mastra、自研框架……）

### 2. 工厂函数优先

公共构造器统一为 `createX()` 工厂函数，而非 `new X()`：

```ts
import { createEventBus } from "@fengru/event-bus"

const bus = createEventBus({ maxQueueSize: 1000 })
```

### 3. 依赖注入

需要外部资源（文件系统、LLM、解析器）的包通过接口注入，便于测试与替换：

```ts
import { createCodeGraphBuilder } from "@fengru/codegraph"

const builder = createCodeGraphBuilder({
  fs: myFileSystem, // 注入自定义实现
  config: { maxDepth: 3 },
})
```

### 4. 独立演进

42 个包各自独立发版（Changesets 驱动），互不阻塞。内部协作依赖使用 `workspace:*`，发布时自动替换为版本号。

## 数据流示例：一次完整的智能体循环

```text
状态机(cycle-controller) ──► 任务分解(taskdag)
      │                          │
      ▼                          ▼
记忆检索(agent-memory) ◄── 执行(worker + code-sandbox)
      │                          │
      ▼                          ▼
校验(valid8 + guardrail) ◄── 补丁(fuzzy-patch + txn-fs)
      │                          │
      ▼                          ▼
复盘(dreamdistill) ──────► 技能沉淀(skillforge)
```

## 相关文档

- [如何选择包](./choosing-packages) —— 处理功能重叠的选择指南
- [稳定性与版本](./stability) —— 包的稳定性分级
- [API 参考](/api/) —— TypeDoc 生成的完整 API 文档
