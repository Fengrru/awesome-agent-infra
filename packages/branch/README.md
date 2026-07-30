# @fengru/branch

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

## License

MIT
