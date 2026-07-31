# @fengru/branch

[![npm version](https://img.shields.io/npm/v/@fengru/branch)](https://www.npmjs.com/package/@fengru/branch) [![npm downloads](https://img.shields.io/npm/dm/@fengru/branch)](https://www.npmjs.com/package/@fengru/branch) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)

Session forking and branching manager for AI agent sessions.

## Install

```bash
npm install @fengru/branch
```

## Quick Start

```typescript
import { BranchManager } from "@fengru/branch"

const manager = new BranchManager()

// Fork a new branch from the main session
const branch = await manager.fork("main-session")

// List active branches for a session
const active = manager.getActiveBranches("main-session")

// Merge a successful branch
manager.mergeBranch(branch.branchId)

// Abandon a dead-end branch
manager.abandonBranch("branch_xxx")
```

## Features

- **Fork**: create parallel exploration branches from any session
- **Merge**: merge successful branches back
- **Abandon**: clean up dead-end branches
- **Query**: list branches by session and status
- **UUID**: crypto.randomUUID() with fallback
- **Optional persistence**: inject BranchDatabase for event log and checkpoint copying


## Documentation

- [API Reference](https://fengrru.github.io/awesome-agent-infra/api/) — TypeDoc-generated API docs
- [Source Code](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/branch)
- [Examples](https://github.com/Fengrru/awesome-agent-infra/tree/main/examples)
## License

MIT
