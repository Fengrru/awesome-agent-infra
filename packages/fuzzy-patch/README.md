# @fengrru/fuzzy-patch

[![npm version](https://img.shields.io/npm/v/@fengrru/fuzzy-patch)](https://www.npmjs.com/package/@fengrru/fuzzy-patch) [![npm downloads](https://img.shields.io/npm/dm/@fengrru/fuzzy-patch)](https://www.npmjs.com/package/@fengrru/fuzzy-patch) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)

8-strategy fuzzy file patching for AI agents. When exact string matching fails, this module provides progressively-degraded strategies to find and replace content reliably.

## Install

```bash
npm install @fengrru/fuzzy-patch
```

## Quick Start

```typescript
import { fuzzyFindAndReplace, canPatch, availableStrategies } from "@fengrru/fuzzy-patch"

const result = fuzzyFindAndReplace(fileContent, oldText, newText)
console.log(result.strategy) // "exact" | "whitespace_normalized" | ...
console.log(result.matchCount) // number of replacements
```

## Strategies (in order)

1. **exact** — direct string match
2. **whitespace_normalized** — collapse whitespace
3. **indentation_normalized** — strip leading whitespace
4. **line_ending_normalized** — normalize \r\n → \n
5. **token_match** — tokenize and match subsequence
6. **head_tail_anchor** — match first/last N chars
7. **context_anchor** — match first/last lines
8. **levenshtein_fuzzy** — sliding window Levenshtein (30% threshold)

## API

### `fuzzyFindAndReplace(content, oldText, newText, options?)`

Returns `PatchResult` with `newContent`, `matchCount`, `strategy`, and optional `error`.

### `canPatch(content, oldText)`

Returns `true` if any strategy can find a match.

### `availableStrategies(content, oldText)`

Returns list of strategies that would match.


## Documentation

- [API Reference](https://fengrru.github.io/awesome-agent-infra/api/) — TypeDoc-generated API docs
- [Source Code](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/fuzzy-patch)
- [Examples](https://github.com/Fengrru/awesome-agent-infra/tree/main/examples)

## License

MIT