# 贡献指南

欢迎贡献！完整规范见仓库 [CONTRIBUTING.md](https://github.com/Fengrru/awesome-agent-infra/blob/main/CONTRIBUTING.md)。以下是核心要点。

## 环境

- **Bun** 1.3+（唯一包管理器——禁止 npm/yarn）
- TypeScript 5.8+、Turborepo、Biome

```bash
bun install              # 安装依赖
bun run typecheck        # 类型检查（54 个任务）
bun run test             # 单元测试（83 个任务）
bun run lint             # 严格 lint（0 错误 0 警告）
```

## 代码规范（必须遵守）

| 规则 | 要求 |
|------|------|
| 零运行时依赖 | 只允许 `node:` 内置模块，禁止 npm 运行时依赖 |
| TypeScript | strict 模式，禁止 `any`，对象形状优先 `interface`，区分联合用 discriminated union |
| JSDoc | 每个公开导出必须有 `@module`/`@param`/`@returns` 标签 |
| 风格 | 无分号（Biome asNeeded）、双引号、ESM（`.js` 后缀相对导入） |
| 测试 | `__tests__/` 目录，`bun:test`，`import { describe, expect, test } from "bun:test"` |
| 工厂函数 | 公开构造器用 `createX()` 而非 `new X()` |
| 私有包 | `"private": true` 标记 |

## 提交前检查清单

```bash
bun run typecheck
bun run test
bun run lint        # biome check --error-on-warnings（必须 0 诊断）
bunx biome format --write .
```

## 新增包流程

1. 复制现有包结构
2. `package.json`：`@fengrru/<name>`、更新 description、补 `repository` + `publishConfig` 字段
3. `tsconfig.json` 继承 `../../tsconfig.base.json`
4. 加入 `typedoc.json` entryPoints
5. 根目录 `bun install`
6. 如果改动了公开 API，运行 `bun changeset` 添加 changeset

## PR 规范

- 每个 PR 一个逻辑变更
- 必须通过 typecheck + test + lint
- 公共 API 变更必须带 changeset
- 提交信息遵循 Conventional Commits（`feat:`、`fix:`、`refactor:`、`chore:`……）
