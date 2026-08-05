# @fengrru/archiver

[![npm version](https://img.shields.io/npm/v/@fengrru/archiver)](https://www.npmjs.com/package/@fengrru/archiver) [![npm downloads](https://img.shields.io/npm/dm/@fengrru/archiver)](https://www.npmjs.com/package/@fengrru/archiver) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)

Event archiver with hot/cold tiering for AI agent sessions.

## Install

```bash
npm install @fengrru/archiver
```

## Quick Start

```typescript
import { EventArchiver, type ArchiveDatabase } from "@fengrru/archiver"

const archiver = new EventArchiver({
  maxHotEvents: 10000,
  storageDir: "./session-archives",
  compress: true,
})

archiver.setDatabase(myArchiveDatabase)

// Check if archiving is needed
if (await archiver.shouldArchive()) {
  const result = await archiver.archive()
  console.log(`Archived ${result.eventCount} events to ${result.filePath}`)
}

// Load an archive
const events = await archiver.loadArchive("cold_12345")
```

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| maxHotEvents | 10000 | Threshold to trigger archiving |
| storageDir | `./archives` | Directory for cold storage |
| compress | false | Enable gzip compression |
| coldPrefix | `cold_` | Prefix for archive filenames |

## Features

- **Hot/cold tiering**: automatically archive events when hot threshold is exceeded
- **Optional gzip compression**: smaller archives when Bun is available
- **Graceful fallback**: uncompressed JSON when gzip is unavailable
- **Archive listing**: list all cold archives in storage directory
- **Injectable database**: plug in any event storage backend


## Documentation

- [API Reference](https://fengrru.github.io/awesome-agent-infra/api/) — TypeDoc-generated API docs
- [Source Code](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/archiver)
- [Examples](https://github.com/Fengrru/awesome-agent-infra/tree/main/examples)
## License

MIT
