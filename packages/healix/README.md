# @fengru/healix

Self-healing error classifier with dual hash matching and Hamming distance fuzzy matching.

## Install

```bash
npm install @fengru/healix
```

## Quick Start

```typescript
import { ErrorClassifier, RepairMemoryEngine } from "@fengru/healix"

// Classify errors
const classifier = new ErrorClassifier()
const category = classifier.classify("ENOENT: no such file or directory") // "not_found"

// Learn repair rules
const engine = new RepairMemoryEngine()
engine.addRule({
  id: "r1",
  category: "not_found",
  exact_hash: "...",
  fuzzy_hash: "...",
  conditions: [{ type: "file_pattern", value: "*.ts" }],
  action: { type: "create_file", params: {} },
  success_rate: 0.9,
  occurrence_count: 10,
})

// Match rules
const match = engine.matchRules(errorInfo)
```

## Error Categories

- `not_found` — file/directory not found
- `permission` — access denied
- `timeout` — operation timed out
- `syntax` — parse/compile errors
- `resource` — memory/disk limits
- `network` — connection failures
- `research_failed` — LLM/tool failures
- `unknown` — unrecognized errors

## Features

- **Dual hash matching**: exact + fuzzy (Hamming distance)
- **Specificity scoring**: AND conditions weighted higher
- **Self-learning**: success_rate tracks rule effectiveness
- **Time decay**: retention decays over time

## License

MIT