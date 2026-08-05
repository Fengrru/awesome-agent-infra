/**
 * @fengru/tracing — Lightweight OpenTelemetry Tracing Abstraction
 *
 * Provides a zero-dependency tracing facade. When OpenTelemetry is installed,
 * spans are bridged to real OTel spans. When OTel is absent, no-op spans
 * silently discard all operations.
 *
 * Design:
 *   - Span interface mirrors the subset of OTel Span we need
 *   - Tracer interface mirrors the subset of OTel Tracer we need
 *   - Lazy initialization via dynamic require (try/catch) — no static imports
 *   - getTracer() returns a singleton Tracer
 *   - withSpan() is a convenience wrapper that creates a span, runs a fn,
 *     records exceptions, and ends the span
 *
 * Zero runtime dependencies.
 *
 * @module tracing
 */

// ── Span Interface ──────────────────────────────────────────────────────────

export interface Span {
  setAttribute(key: string, value: string | number | boolean): Span
  addEvent(name: string, attributes?: Record<string, string | number | boolean>): Span
  recordException(exception: Error): Span
  end(): void
}

// ── Tracer Interface ────────────────────────────────────────────────────────

export interface SpanOptions {
  attributes?: Record<string, string | number | boolean>
  parent?: Span | unknown
}

export interface Tracer {
  startSpan(name: string, options?: SpanOptions): Span
}

// ── No-Op Implementations ───────────────────────────────────────────────────

class NoOpSpan implements Span {
  setAttribute(_key: string, _value: string | number | boolean): Span {
    return this
  }
  addEvent(_name: string, _attributes?: Record<string, string | number | boolean>): Span {
    return this
  }
  recordException(_exception: Error): Span {
    return this
  }
  end(): void {}
}

class NoOpTracer implements Tracer {
  startSpan(_name: string, _options?: SpanOptions): Span {
    return new NoOpSpan()
  }
}

// ── OTel Bridge (lazy, dynamic require) ─────────────────────────────────────

interface OTelApi {
  trace: {
    getTracer(name: string, version?: string): OTelTracer
  }
}

interface OTelTracer {
  startSpan(name: string, options?: Record<string, unknown>, context?: unknown): OTelSpan
}

interface OTelSpan {
  setAttribute(key: string, value: string | number | boolean): OTelSpan
  addEvent(name: string, attributes?: Record<string, string | number | boolean>): OTelSpan
  recordException(exception: Error): void
  end(): void
}

function loadOTel(): OTelApi | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("@opentelemetry/api") as OTelApi
  } catch {
    return null
  }
}

class OTelSpanWrapper implements Span {
  constructor(private readonly inner: OTelSpan) {}

  setAttribute(key: string, value: string | number | boolean): Span {
    this.inner.setAttribute(key, value)
    return this
  }

  addEvent(name: string, attributes?: Record<string, string | number | boolean>): Span {
    this.inner.addEvent(name, attributes)
    return this
  }

  recordException(exception: Error): Span {
    this.inner.recordException(exception)
    return this
  }

  end(): void {
    this.inner.end()
  }
}

class OTelTracerWrapper implements Tracer {
  constructor(
    private readonly inner: OTelTracer,
    private readonly otel: OTelApi,
  ) {}

  startSpan(name: string, options?: SpanOptions): Span {
    const otelOptions: Record<string, unknown> = {}
    if (options?.attributes) {
      otelOptions.attributes = options.attributes
    }
    const otelSpan = this.inner.startSpan(name, otelOptions)
    return new OTelSpanWrapper(otelSpan)
  }
}

// ── Singleton Tracer ────────────────────────────────────────────────────────

let _tracer: Tracer | null = null

export function getTracer(): Tracer {
  if (_tracer) return _tracer

  const otel = loadOTel()
  if (otel) {
    const otelTracer = otel.trace.getTracer("@fengru/tracing", "0.1.0")
    _tracer = new OTelTracerWrapper(otelTracer, otel)
  } else {
    _tracer = new NoOpTracer()
  }

  return _tracer
}

export function resetTracer(): void {
  _tracer = null
}

// ── withSpan Convenience Wrapper ────────────────────────────────────────────

export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Record<string, string | number | boolean>,
): Promise<T> {
  const tracer = getTracer()
  const span = tracer.startSpan(name, attributes ? { attributes } : undefined)

  try {
    const result = await fn(span)
    return result
  } catch (error) {
    if (error instanceof Error) {
      span.recordException(error)
    }
    throw error
  } finally {
    span.end()
  }
}
