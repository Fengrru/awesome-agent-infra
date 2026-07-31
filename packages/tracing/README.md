# @fengru/tracing

[![npm version](https://img.shields.io/npm/v/@fengru/tracing)](https://www.npmjs.com/package/@fengru/tracing) [![npm downloads](https://img.shields.io/npm/dm/@fengru/tracing)](https://www.npmjs.com/package/@fengru/tracing) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)

Lightweight OpenTelemetry tracing abstraction with zero runtime dependencies.

## Install

```bash
npm install @fengru/tracing
```

## Quick Start

```typescript
import { getTracer, withSpan } from "@fengru/tracing"

const tracer = getTracer()

// Manual span management
const span = tracer.startSpan("my-operation")
span.setAttribute("key", "value")
span.addEvent("step-started", { step: 1 })
span.end()

// Convenience wrapper with automatic exception recording
await withSpan("fetch-data", async (span) => {
  span.setAttribute("url", "https://api.example.com")
  return await fetch("https://api.example.com")
})
```

## Features

- **Zero dependencies**: no static imports, no install-time bloat
- **Lazy OTel init**: dynamically loads `@opentelemetry/api` if available
- **No-op fallback**: silent discard when OTel is not installed
- **`withSpan` wrapper**: automatic span creation, exception recording, and cleanup
- **Singleton tracer**: `getTracer()` returns the same tracer instance


## Documentation

- [API Reference](https://fengrru.github.io/awesome-agent-infra/api/) — TypeDoc-generated API docs
- [Source Code](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/tracing)
- [Examples](https://github.com/Fengrru/awesome-agent-infra/tree/main/examples)
## License

MIT
