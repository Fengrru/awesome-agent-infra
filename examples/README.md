# Agent Kit Examples

每个核心包一个可运行的示例。所有示例直接 import 包源码（零依赖，无需构建），展示真实 API 用法。

## 运行

```bash
bun install
bun run fuzzy-patch      # 模糊补丁
bun run event-bus        # 事件总线
bun run state-machine    # 状态机
bun run agent-memory     # 记忆系统
bun run confidence-gate  # 置信度门控
bun run codegraph        # 代码图谱
bun run txn-fs           # 事务性文件系统
bun run valid8           # 输出校验
bun run worker           # 工作池
bun run tracing          # 链路追踪
bun run taskdag          # DAG 任务编排
bun run guardrail        # 安全闸门
```

## 示例速览

| 示例 | 演示内容 |
|------|----------|
| [fuzzy-patch.ts](./fuzzy-patch.ts) | 8 策略模糊匹配替换，处理缺失/多余空白 |
| [event-bus.ts](./event-bus.ts) | 优先级发布订阅、事件等待 |
| [state-machine.ts](./state-machine.ts) | 15 状态流转、进入/退出钩子、守卫 |
| [agent-memory.ts](./agent-memory.ts) | 记忆写入、复合检索评分、上下文组装 |
| [confidence-gate.ts](./confidence-gate.ts) | 校准样本拟合、ECE 评估、置信门控 |
| [codegraph.ts](./codegraph.ts) | 代码图构建、符号检索、影响分析 |
| [txn-fs.ts](./txn-fs.ts) | 事务 begin/edit/commit/rollback、冲突处理 |
| [valid8.ts](./valid8.ts) | 语法 + 安全两层校验、置信度计算 |
| [worker.ts](./worker.ts) | 能力注册、并行任务执行、指标 |
| [tracing.ts](./tracing.ts) | 嵌套 span、属性/事件/异常记录 |
| [taskdag.ts](./taskdag.ts) | DAG 校验、就绪节点调度、失败传播 |
| [guardrail.ts](./guardrail.ts) | 熵风险指标评估、控制动作决策 |
