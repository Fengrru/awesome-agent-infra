# @fengru/valid8

4-layer output validation for AI agents: syntax, semantic, runtime, security.

## Install

```bash
npm install @fengru/valid8
# Optional: npm install typescript (for AST-based syntax validation)
```

## Quick Start

```typescript
import { ValidationNetwork } from "@fengru/valid8"

const validator = new ValidationNetwork()

const result = await validator.validate({
  content: fileContent,
  filePath: "src/index.ts",
  riskLevel: 1,
})

console.log(result.passed) // boolean
console.log(result.confidence) // 0-1
console.log(result.layers) // [{ name: "syntax", passed: true, ... }]
```

## Validation Layers

| Layer | Risk Gate | Description |
|-------|-----------|-------------|
| Syntax | minRisk=0 | TypeScript AST + regex fallback |
| Semantic | minRisk=2 | LLM review or keyword fallback |
| Runtime | minRisk=0 | Compilation + test execution |
| Security | minRisk=1 | 40+ dangerous pattern detection |

## Features

- **Data-driven**: `VALIDATION_LAYERS` array, not hardcoded
- **Confidence scoring**: weighted average across layers
- **Retry logic**: configurable threshold and max retries
- **Permission rules**: bash blocked by default,可配置

## License

MIT