# 快速开始

Agent Kit 是 42 个独立包的集合。**不需要安装整个框架**——按需安装单个包，每个包都是零依赖的。

## 安装

```bash
# 按需安装（示例：模糊补丁 + 代码图谱）
npm install @fengru/fuzzy-patch
npm install @fengru/codegraph
```

也可以使用 Bun 或 pnpm：

```bash
bun add @fengru/event-bus
```

## 第一个示例：智能体文件编辑

```ts
import { fuzzyFindAndReplace } from "@fengru/fuzzy-patch"

const source = readFileSync("config.ts", "utf8")
const result = fuzzyFindAndReplace(source, "port = 3000", "port = 8080")

if (result.success) {
  writeFileSync("config.ts", result.content)
}
```

## 常用组合

| 场景 | 推荐包 |
|------|--------|
| 记忆与状态 | `@fengru/agent-memory`、`@fengru/agent-checkpoint` |
| 文件操作安全 | `@fengru/txn-fs`、`@fengru/fuzzy-patch` |
| 输出校验 | `@fengru/valid8`、`@fengru/confidence-gate` |
| 代码理解 | `@fengru/codegraph`、`@fengru/agentic-search` |
| 任务编排 | `@fengru/taskdag`、`@fengru/state-machine` |
| 推理与规划 | `@fengru/reasoning-search`、`@fengru/pomdp-planner` |
| 安全护栏 | `@fengru/guardrail`、`@fengru/code-sandbox` |
| 自我进化 | `@fengru/skillforge`、`@fengru/dreamdistill` |

## 完整示例

仓库的 [`examples/`](https://github.com/Fengrru/awesome-agent-infra/tree/main/examples) 目录包含每个核心包的可运行示例：

```bash
git clone https://github.com/Fengrru/awesome-agent-infra.git
cd awesome-agent-infra/examples
bun install
bun run fuzzy-patch      # 运行模糊补丁示例
bun run agent-memory     # 运行记忆引擎示例
```

## 开发本仓库

```bash
bun install              # 安装全部工作区依赖
bun run typecheck        # 类型检查
bun run test             # 单元测试
bun run lint             # 严格 lint
```
