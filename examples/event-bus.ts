/**
 * event-bus — priority event bus with typed events.
 *
 * Run: bun run event-bus.ts
 */
import { EventPriority, EventType, createSimpleEventBus } from "../packages/event-bus/src/index.ts"

const bus = createSimpleEventBus()

bus.subscribe(EventType.TOOL_RESULT, (event) => {
  console.log(`subscriber A: tool ${event.data.toolName} -> ${event.data.status}`)
})
bus.subscribe(EventType.TOOL_RESULT, (event) => {
  console.log(`subscriber B: received ${event.type} at priority ${event.priority}`)
})

const event = {
  type: EventType.TOOL_RESULT,
  source: "examples",
  session_id: "session-1",
  data: { toolName: "read_file", status: "ok" },
  priority: EventPriority.NORMAL,
  timestamp: Date.now(),
  require_persistence: false,
}
await bus.publish(event)

// await a specific event with a timeout
const wait = bus.waitForEvent(EventType.PLANNING_FAILED, 2000)
setTimeout(() => {
  void bus.publish({
    type: EventType.PLANNING_FAILED,
    source: "examples",
    session_id: "session-1",
    data: { reason: "goal ambiguity" },
    priority: EventPriority.HIGH,
    timestamp: Date.now(),
    require_persistence: true,
  })
}, 50)
const failed = await wait
console.log(`waited for planning failure: ${failed ? String(failed.data.reason) : "timeout"}`)
