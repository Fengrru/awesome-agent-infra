# @fengru/archiver

Event archiver with hot/cold tiering for AI agent sessions.

## Install

```bash
npm install @fengru/archiver
```

## Quick Start

```typescript
import { EventArchiver, type ArchiveDatabase } from "@fengru/archiver"

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

## License

MIT
