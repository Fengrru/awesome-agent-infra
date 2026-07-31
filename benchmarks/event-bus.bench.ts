import { type BusEvent, EventPriority, EventType, createSimpleEventBus } from "../packages/event-bus/src/index.ts"
/**
 * event-bus — publish throughput with priority batching.
 *
 * NORMAL events are queued and flushed at BATCH_SIZE (500) or on a 50ms timer;
 * CRITICAL/HIGH events dispatch immediately.
 *
 * Run: bun bench event-bus.bench.ts
 */
import { bench, run } from "./bench-utils.ts"

const bus = createSimpleEventBus()
bus.subscribe(EventType.TOOL_RESULT, () => {})
bus.subscribe(EventType.ERROR_OCCURRED, () => {})

const normalEvent: BusEvent = {
  type: EventType.TOOL_RESULT,
  source: "bench",
  session_id: "bench-session",
  data: { tool: "read", status: "success", token_cost: 120, duration_ms: 42 },
  priority: EventPriority.NORMAL,
  timestamp: Date.now(),
  require_persistence: false,
}

const criticalEvent: BusEvent = {
  ...normalEvent,
  type: EventType.ERROR_OCCURRED,
  priority: EventPriority.CRITICAL,
}

bench("publish normal (queued, batched)", async () => {
  await bus.publish(normalEvent)
})

bench("publish critical (immediate dispatch)", async () => {
  await bus.publish(criticalEvent)
})

bench("publish + persistence batch (10 events)", async () => {
  const persisted = createSimpleEventBus()
  await persisted.publish({ ...normalEvent, require_persistence: true })
  await persisted.shutdown()
})

await run()
