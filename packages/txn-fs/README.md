# @fengru/txn-fs

Transactional filesystem with 3-way merge for AI agent file operations.

## Install

```bash
npm install @fengru/txn-fs
```

## Quick Start

```typescript
import { TransactionalFS } from "@fengru/txn-fs"

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

## License

MIT