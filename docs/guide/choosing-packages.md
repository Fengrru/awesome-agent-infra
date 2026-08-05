# 如何选择包

42 个包之间存在少量功能重叠（项目早期探索的产物）。本页给出权威选择指南，避免装错包。

## 记忆类：三选一

| 包 | 定位 | 什么时候选它 |
|----|------|--------------|
| `@fengrru/agent-memory` | 4 层记忆 + Ebbinghaus 遗忘曲线 | **默认选择**。对话记忆、工作记忆、短期/长期记忆分层 |
| `@fengrru/memory-engine-v2` | 5 层记忆 + 睡眠整合 + 注意力检索 | 需要睡眠整合、注意力机制检索的科研型场景 |
| `@fengrru/agent-checkpoint` | 3 级检查点（L1/L2/L3） | 需要跨会话状态持久化、崩溃恢复 |

> **经验法则**：`agent-memory` 是生产首选；`memory-engine-v2` 是实验性质；`checkpoint` 与两者正交（管持久化，不管记忆模型）。

## 校验类：先 valid8 后 confidence-gate

- **`@fengrru/valid8`**：语法/语义/运行时/安全 4 层输出校验——校验"输出是否合法"
- **`@fengrru/confidence-gate`**：置信度校准、ECE/Brier 评估、动态阈值——判断"输出是否可信"

两者正交。先 `valid8` 拦截非法输出，再用 `confidence-gate` 决定低置信输出是否放行。

## 代码图类：codegraph 是唯一入口

- **`@fengrru/codegraph`**：代码图谱 + 影响分析 + 调用点追踪
- `@fengrru/agentic-search`：意图驱动的跨文件检索编排（内部可消费 codegraph）

需要"读懂代码库"时用 `codegraph`；需要"搜索代码库"时用 `agentic-search`。

## 状态编排：taskdag vs state-machine vs dynamic-workflow

| 包 | 模式 | 场景 |
|----|------|------|
| `@fengrru/taskdag` | DAG 执行引擎 + 增量重规划 | 任务图依赖编排（默认） |
| `@fengrru/state-machine` | 15 状态 FSM | 会话级状态流转控制 |
| `@fengrru/dynamic-workflow` | VM 沙箱工作流 | 需要执行不受信任的动态工作流定义 |

## 演化类：skillforge 与 dreamdistill

- `@fengrru/skillforge`：技能创建与管理的"写"侧
- `@fengrru/skill-curator`：技能库自动筛选与整理的"管"侧
- `@fengrru/dreamdistill`：7 天梦境 + 30 天蒸馏的自我改进循环

## 检索类：embedding vs agentic-search

- `@fengrru/embedding`：TF-IDF 向量索引 + 混合检索（底层能力）
- `@fengrru/agentic-search`：意图识别驱动的搜索编排（上层应用）

先看 `embedding` 能否满足；需要多源搜索编排时再上 `agentic-search`。
