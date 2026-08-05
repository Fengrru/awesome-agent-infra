# @fengrru/notes-manager

[![npm version](https://img.shields.io/npm/v/@fengrru/notes-manager)](https://www.npmjs.com/package/@fengrru/notes-manager) [![npm downloads](https://img.shields.io/npm/dm/@fengrru/notes-manager)](https://www.npmjs.com/package/@fengrru/notes-manager) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)

Session scratchpad manager for AI agents. Stores notes as JSONL files with full Node.js `fs/promises` support and automatic in-memory fallback.

## Quick Start

```ts
import { NotesManager } from "@fengrru/notes-manager";

const notes = new NotesManager({ notesDir: "./agent-notes" });

// Append a discovery
await notes.append("session-1", "Found a broken link in config", "discovery");

// Append an error
await notes.append("session-1", "Failed to parse response JSON", "error");

// Read all entries
const all = await notes.readAll("session-1");

// Group by tag
const grouped = await notes.readByTag("session-1");
console.log(grouped.discovery); // [{ timestamp: ..., content: "Found...", tag: "discovery" }]

// Check if file exceeds size limit
if (await notes.shouldCompact("session-1")) {
  // compact logic here
}

// Clear session
await notes.clear("session-1");

// Delete session entirely
await notes.deleteSession("session-1");
```

## API

### `NotesConfig`

| Property      | Type     | Default  | Description               |
|--------------|----------|----------|---------------------------|
| `notesDir`   | `string` | required | Directory for note files  |
| `maxSizeChars` | `number` | `50000`  | Threshold for compaction  |

### `NoteEntry`

| Property    | Type                                                          | Description             |
|-------------|---------------------------------------------------------------|-------------------------|
| `timestamp` | `number`                                                      | Epoch milliseconds      |
| `content`   | `string`                                                      | Note body              |
| `tag`       | `"discovery" \| "error" \| "decision" \| "observation" \| "general"` | Category label |

### `NotesManager`

| Method                                    | Returns                        | Description                              |
|-------------------------------------------|--------------------------------|------------------------------------------|
| `append(sessionId, content, tag?)`        | `Promise<void>`                | Appends a JSONL entry                    |
| `readAll(sessionId)`                      | `Promise<NoteEntry[]>`         | Parses all entries for the session       |
| `readByTag(sessionId)`                    | `Promise<Record<NoteTag, NoteEntry[]>>` | Groups entries by tag            |
| `clear(sessionId)`                        | `Promise<void>`                | Truncates the session file               |
| `shouldCompact(sessionId)`                | `Promise<boolean>`             | Whether file exceeds `maxSizeChars`      |
| `deleteSession(sessionId)`                | `Promise<void>`                | Removes the session file completely      |

## Format

Notes are stored as [JSONL](https://jsonlines.org/) — one JSON object per line:

```jsonl
{"timestamp":1719000000000,"content":"Found a broken link","tag":"discovery"}
{"timestamp":1719000001000,"content":"Decided to use JSONL format","tag":"decision"}
```

## Fallback

When `node:fs/promises` is unavailable (browser, restricted runtimes), `NotesManager` automatically falls back to an in-memory store. All methods continue to work identically — data is simply not persisted to disk.


## Documentation

- [API Reference](https://fengrru.github.io/awesome-agent-infra/api/) — TypeDoc-generated API docs
- [Source Code](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/notes-manager)
- [Examples](https://github.com/Fengrru/awesome-agent-infra/tree/main/examples)
## License

MIT
