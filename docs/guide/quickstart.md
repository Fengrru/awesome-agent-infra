# 快速开始

Agent Kit 是 42 个独立包的集合。**不需要安装整个框架**——按需安装单个包，每个包都是零依赖的。

## 安装

```bash
# 按需安装（示例：模糊补丁 + 代码图谱）
npm install @fengrru/fuzzy-patch
npm install @fengrru/codegraph
```

也可以使用 Bun 或 pnpm：

```bash
bun add @fengrru/event-bus
```

## 第一个示例：智能体文件编辑

```ts
import { fuzzyFindAndReplace } from "@fengrru/fuzzy-patch"

const source = readFileSync("config.ts", "utf8")
const result = fuzzyFindAndReplace(source, "port = 3000", "port = 8080")

if (result.success) {
  writeFileSync("config.ts", result.content)
}
```

## 常用组合

| 场景 | 推荐包 |
|------|--------|
| 记忆与状态 | `@fengrru/agent-memory`、`@fengrru/agent-checkpoint` |
| 文件操作安全 | `@fengrru/txn-fs`、`@fengrru/fuzzy-patch` |
| 输出校验 | `@fengrru/valid8`、`@fengrru/confidence-gate` |
| 代码理解 | `@fengrru/codegraph`、`@fengrru/agentic-search` |
| 任务编排 | `@fengrru/taskdag`、`@fengrru/state-machine` |
| 推理与规划 | `@fengrru/reasoning-search`、`@fengrru/pomdp-planner` |
| 安全护栏 | `@fengrru/guardrail`、`@fengrru/code-sandbox` |
| 自我进化 | `@fengrru/skillforge`、`@fengrru/dreamdistill` |

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
