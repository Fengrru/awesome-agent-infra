# @fengru/tracing

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

## License

MIT
