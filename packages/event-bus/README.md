# @fengru/event-bus

Zero-dependency typed event bus for AI agents.

## Quick Start

```ts
import { createSimpleEventBus, EventPriority, EventType } from "@fengru/event-bus"

const bus = createSimpleEventBus()

// Subscribe to events
const unsub = bus.subscribe(EventType.TASK_COMPLETED, (event) => {
  console.log(`Task completed: ${event.payload.taskId}`)
})

// Publish with priority
bus.publish({
  type: EventType.TASK_COMPLETED,
  priority: EventPriority.HIGH,
  sessionId: "session-1",
  payload: { taskId: "task-42" },
  source: "worker",
})

// Wait for an event
const event = await bus.waitForEvent(EventType.TASK_COMPLETED, 5000)

// With predicate
const result = await bus.waitForEvent(
  EventType.TASK_COMPLETED,
  5000,
  (e) => e.payload.taskId === "task-42"
)

// Graceful shutdown
await bus.shutdown()
```

## Priority Levels

| Priority    | Value | Behavior             |
|-------------|-------|----------------------|
| CRITICAL    | 0     | Immediate delivery   |
| HIGH        | 1     | Immediate delivery   |
| NORMAL      | 2     | Batched (50ms)       |
| LOW         | 3     | Batched (50ms)       |
| BACKGROUND  | 4     | Batched (50ms)       |

## Persistence

```ts
const bus = createSimpleEventBus({
  async (event) => {
    await db.insert("events", event)
  },
  batch: async (events) => {
    await db.insertMany("events", events)
  },
})
```

## License

MIT
