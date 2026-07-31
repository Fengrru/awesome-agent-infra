/**
 * tracing — OpenTelemetry-style tracing with no-op fallback.
 *
 * Run: bun run tracing.ts
 */
import { getTracer, withSpan } from "../packages/tracing/src/index.ts"

const tracer = getTracer("example-app", "1.0.0")

const root = tracer.startSpan("agent.run")
root.setAttribute("session_id", "session-1")
root.addEvent("started", { goal: "fix tests" })

const plan = tracer.startSpan("agent.plan")
plan.addEvent("dag_generated")
plan.end()

// convenience wrapper: creates span, runs fn, records exceptions, ends span
const result = await withSpan("agent.edit", async () => {
  return "patched config.ts"
})
console.log("withSpan result:", result)

root.recordException(new Error("verification failed"))
root.end()
console.log("tracing example done (no-op backend logs nothing by default)")
