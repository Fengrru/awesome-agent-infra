# @fengrru/txn-fs

[![npm version](https://img.shields.io/npm/v/@fengrru/txn-fs)](https://www.npmjs.com/package/@fengrru/txn-fs) [![npm downloads](https://img.shields.io/npm/dm/@fengrru/txn-fs)](https://www.npmjs.com/package/@fengrru/txn-fs) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)

Transactional filesystem with 3-way merge for AI agent file operations.

## Install

```bash
npm install @fengrru/txn-fs
```

## Quick Start

```typescript
import { TransactionalFS } from "@fengrru/txn-fs"

const fs = new TransactionalFS()

// Start transaction
const tx = fs.beginTransaction()

// Stage changes
tx.writeFile("src/index.ts", newContent)
tx.deleteFile("src/old.ts")

// Commit with 3-way merge
const result = await tx.commit()
console.log(result.merged) // files successfully merged
console.log(result.conflicts) // files with conflicts
```

## Features

- **3-way merge**: based on diffArrays
- **Conflict markers**: <<<<<<< / ======= / >>>>>>> 
- **SHA256 baseline**: detects concurrent modifications
- **TOCTOU detection**: race condition prevention
- **Git integration**: real Git backend available


## Documentation

- [API Reference](https://fengrru.github.io/awesome-agent-infra/api/) — TypeDoc-generated API docs
- [Source Code](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/txn-fs)
- [Examples](https://github.com/Fengrru/awesome-agent-infra/tree/main/examples)

## License

MIT