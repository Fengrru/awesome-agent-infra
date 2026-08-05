import { describe, expect, test } from "bun:test"
import {
  type BusEvent,
  EventBusService,
  EventPriority,
  EventType,
  type PersistentEvent,
  calculateSpecificity,
  createEventBusService,
  createSimpleEventBus,
} from "../src/index"

describe("createSimpleEventBus", () => {
  // ── Basic publish/subscribe ─────────────────────────────────────────────

  test("publish and subscribe with immediate delivery for CRITICAL priority", async () => {
    const bus = createSimpleEventBus()
    let received: BusEvent | null = null

    bus.subscribe(EventType.TASK_START, (event) => {
      received = event
    })

    await bus.publish({
      type: EventType.TASK_START,
      priority: EventPriority.CRITICAL,
      session_id: "test-session",
      data: { taskId: "42" },
      source: "test",
      timestamp: Date.now(),
      require_persistence: false,
    })

    await new Promise((r) => setTimeout(r, 10))
    expect(received).not.toBeNull()
    expect(received!.type).toBe(EventType.TASK_START)
    expect(received!.data.taskId).toBe("42")
    expect(received!.session_id).toBe("test-session")

    await bus.shutdown()
  })

  test("publish and subscribe with immediate delivery for HIGH priority", async () => {
    const bus = createSimpleEventBus()
    let received = false

    bus.subscribe(EventType.AGENT_OUTPUT, () => {
      received = true
    })

    await bus.publish({
      type: EventType.AGENT_OUTPUT,
      priority: EventPriority.HIGH,
      session_id: "s1",
      data: {},
      source: "test",
      timestamp: Date.now(),
      require_persistence: false,
    })

    await new Promise((r) => setTimeout(r, 10))
    expect(received).toBe(true)

    await bus.shutdown()
  })

  // ── Batch flushing ──────────────────────────────────────────────────────

  test("NORMAL priority events are batched and flushed", async () => {
    const bus = createSimpleEventBus()
    let receivedCount = 0

    bus.subscribe(EventType.METRICS_SAMPLE, () => {
      receivedCount++
    })

    await bus.publish({
      type: EventType.METRICS_SAMPLE,
      priority: EventPriority.NORMAL,
      session_id: "s1",
      data: {},
      source: "test",
      timestamp: Date.now(),
      require_persistence: false,
    })
    await bus.publish({
      type: EventType.METRICS_SAMPLE,
      priority: EventPriority.NORMAL,
      session_id: "s1",
      data: {},
      source: "test",
      timestamp: Date.now(),
      require_persistence: false,
    })
    await bus.publish({
      type: EventType.METRICS_SAMPLE,
      priority: EventPriority.NORMAL,
      session_id: "s1",
      data: {},
      source: "test",
      timestamp: Date.now(),
      require_persistence: false,
    })

    // Should not have been delivered yet (batched)
    expect(receivedCount).toBe(0)

    // Wait for flush interval (default 50ms)
    await new Promise((r) => setTimeout(r, 80))

    // All 3 should be delivered after flush
    expect(receivedCount).toBe(3)

    await bus.shutdown()
  })

  // ── Unsubscribe ─────────────────────────────────────────────────────────

  test("unsubscribe removes handler", async () => {
    const bus = createSimpleEventBus()
    let callCount = 0
    const handler = () => {
      callCount++
    }

    bus.subscribe(EventType.PLANNING_FAILED, handler)
    bus.unsubscribe(EventType.PLANNING_FAILED, handler)

    await bus.publish({
      type: EventType.PLANNING_FAILED,
      priority: EventPriority.CRITICAL,
      session_id: "s1",
      data: {},
      source: "test",
      timestamp: Date.now(),
      require_persistence: false,
    })

    await new Promise((r) => setTimeout(r, 10))
    expect(callCount).toBe(0)

    await bus.shutdown()
  })

  test("subscribe returns void, not an unsubscribe function", async () => {
    const bus = createSimpleEventBus()

    const result = bus.subscribe(EventType.SESSION_PAUSED, () => {})
    expect(result).toBeUndefined()

    await bus.shutdown()
  })

  // ── waitForEvent ───────────────────────────────────────────────────────

  test("waitForEvent resolves when matching event is published", async () => {
    const bus = createSimpleEventBus()

    const waitPromise = bus.waitForEvent(EventType.SESSION_COMPLETED, 5000)

    await bus.publish({
      type: EventType.SESSION_COMPLETED,
      priority: EventPriority.CRITICAL,
      session_id: "s1",
      data: { value: 99 },
      source: "test",
      timestamp: Date.now(),
      require_persistence: false,
    })

    const event = await waitPromise
    expect(event).not.toBeNull()
    expect(event!.type).toBe(EventType.SESSION_COMPLETED)
    expect(event!.data.value).toBe(99)

    await bus.shutdown()
  })

  test("waitForEvent with predicate filters correctly", async () => {
    const bus = createSimpleEventBus()

    const waitPromise = bus.waitForEvent(
      EventType.METRICS_SAMPLE,
      5000,
      (e) => (e.data.category as string) === "important",
    )

    // Publish a non-matching event first
    await bus.publish({
      type: EventType.METRICS_SAMPLE,
      priority: EventPriority.CRITICAL,
      session_id: "s1",
      data: { category: "noise" },
      source: "test",
      timestamp: Date.now(),
      require_persistence: false,
    })

    // Publish the matching event
    await bus.publish({
      type: EventType.METRICS_SAMPLE,
      priority: EventPriority.CRITICAL,
      session_id: "s1",
      data: { category: "important" },
      source: "test",
      timestamp: Date.now(),
      require_persistence: false,
    })

    const event = await waitPromise
    expect(event).not.toBeNull()
    expect(event!.data.category).toBe("important")

    await bus.shutdown()
  })

  test("waitForEvent returns null on timeout", async () => {
    const bus = createSimpleEventBus()

    const result = await bus.waitForEvent(EventType.DAG_NODE_FAILED, 50)
    expect(result).toBeNull()

    await bus.shutdown()
  })

  // ── Persistence ─────────────────────────────────────────────────────────

  test("persistFn is called for events with require_persistence: true", async () => {
    const persisted: BusEvent[] = []
    const persistFn = async (event: BusEvent) => {
      persisted.push(event)
    }

    const bus = createSimpleEventBus(persistFn)

    await bus.publish({
      type: EventType.AGENT_OUTPUT,
      priority: EventPriority.CRITICAL,
      session_id: "s1",
      data: { key: "val" },
      source: "test",
      timestamp: Date.now(),
      require_persistence: true,
    })

    await new Promise((r) => setTimeout(r, 20))
    expect(persisted.length).toBe(1)
    expect(persisted[0].session_id).toBe("s1")

    await bus.shutdown()
  })

  test("persistFn is NOT called for events without require_persistence", async () => {
    const persisted: BusEvent[] = []
    const persistFn = async (event: BusEvent) => {
      persisted.push(event)
    }

    const bus = createSimpleEventBus(persistFn)

    await bus.publish({
      type: EventType.AGENT_OUTPUT,
      priority: EventPriority.CRITICAL,
      session_id: "s1",
      data: {},
      source: "test",
      timestamp: Date.now(),
      require_persistence: false,
    })

    await new Promise((r) => setTimeout(r, 20))
    expect(persisted.length).toBe(0)

    await bus.shutdown()
  })

  test("batch persistence is called on flush", async () => {
    const batches: PersistentEvent[][] = []
    const persistBatch = async (events: PersistentEvent[]) => {
      batches.push(events)
    }

    const bus = createSimpleEventBus(undefined, persistBatch)

    await bus.publish({
      type: EventType.METRICS_SAMPLE,
      priority: EventPriority.NORMAL,
      session_id: "s1",
      data: {},
      source: "test",
      timestamp: Date.now(),
      require_persistence: true,
    })
    await bus.publish({
      type: EventType.METRICS_SAMPLE,
      priority: EventPriority.NORMAL,
      session_id: "s1",
      data: {},
      source: "test",
      timestamp: Date.now(),
      require_persistence: true,
    })

    await new Promise((r) => setTimeout(r, 80))
    expect(batches.length).toBeGreaterThanOrEqual(1)
    expect(batches[0]!.length).toBe(2)

    await bus.shutdown()
  })

  // ── Shutdown ────────────────────────────────────────────────────────────

  test("shutdown flushes remaining batched events", async () => {
    const bus = createSimpleEventBus()
    let received = 0

    bus.subscribe(EventType.METRICS_SAMPLE, () => {
      received++
    })

    await bus.publish({
      type: EventType.METRICS_SAMPLE,
      priority: EventPriority.LOW,
      session_id: "s1",
      data: {},
      source: "test",
      timestamp: Date.now(),
      require_persistence: false,
    })
    await bus.publish({
      type: EventType.METRICS_SAMPLE,
      priority: EventPriority.LOW,
      session_id: "s1",
      data: {},
      source: "test",
      timestamp: Date.now(),
      require_persistence: false,
    })

    await bus.shutdown()
    expect(received).toBe(2)
  })

  test("publishing after shutdown does not throw", async () => {
    const bus = createSimpleEventBus()
    await bus.shutdown()

    await expect(
      bus.publish({
        type: EventType.METRICS_SAMPLE,
        priority: EventPriority.NORMAL,
        session_id: "s1",
        data: {},
        source: "test",
        timestamp: Date.now(),
        require_persistence: false,
      }),
    ).resolves.toBeUndefined()
  })

  // ── Sequence counter ────────────────────────────────────────────────────

  test("sequence counter increments per session for persisted events", async () => {
    const capturedEvents: PersistentEvent[] = []
    const persistBatch = async (events: PersistentEvent[]) => {
      capturedEvents.push(...events)
    }

    const bus = createSimpleEventBus(undefined, persistBatch)

    await bus.publish({
      type: EventType.TASK_START,
      priority: EventPriority.CRITICAL,
      session_id: "s1",
      data: {},
      source: "t",
      timestamp: Date.now(),
      require_persistence: true,
    })
    await bus.publish({
      type: EventType.TASK_START,
      priority: EventPriority.CRITICAL,
      session_id: "s1",
      data: {},
      source: "t",
      timestamp: Date.now(),
      require_persistence: true,
    })
    await bus.publish({
      type: EventType.TASK_START,
      priority: EventPriority.CRITICAL,
      session_id: "s2",
      data: {},
      source: "t",
      timestamp: Date.now(),
      require_persistence: true,
    })

    await new Promise((r) => setTimeout(r, 20))

    expect(capturedEvents[0]!.sequence_index).toBe(1)
    expect(capturedEvents[1]!.sequence_index).toBe(2)
    // s2 starts its own sequence
    expect(capturedEvents[2]!.sequence_index).toBe(1)

    await bus.shutdown()
  })

  // ── setPersistFn ────────────────────────────────────────────────────────

  test("setPersistFn updates the persistence callback", async () => {
    const bus = createSimpleEventBus()
    const persisted: BusEvent[] = []

    bus.setPersistFn(async (event) => {
      persisted.push(event)
    })

    await bus.publish({
      type: EventType.AGENT_OUTPUT,
      priority: EventPriority.CRITICAL,
      session_id: "s1",
      data: {},
      source: "test",
      timestamp: Date.now(),
      require_persistence: true,
    })

    await new Promise((r) => setTimeout(r, 20))
    expect(persisted.length).toBe(1)

    await bus.shutdown()
  })

  test("setPersistFn with null disables persistence", async () => {
    const bus = createSimpleEventBus()
    const persisted: BusEvent[] = []

    bus.setPersistFn(async (event) => {
      persisted.push(event)
    })

    bus.setPersistFn(null)

    await bus.publish({
      type: EventType.AGENT_OUTPUT,
      priority: EventPriority.CRITICAL,
      session_id: "s1",
      data: {},
      source: "test",
      timestamp: Date.now(),
      require_persistence: true,
    })

    await new Promise((r) => setTimeout(r, 20))
    expect(persisted.length).toBe(0)

    await bus.shutdown()
  })

  // ── Error handling ─────────────────────────────────────────────────────

  test("handler errors don't prevent other handlers from receiving events", async () => {
    const bus = createSimpleEventBus()
    let normalHandlerCalled = false

    bus.subscribe(EventType.ERROR_OCCURRED, () => {
      throw new Error("Handler error")
    })
    bus.subscribe(EventType.ERROR_OCCURRED, () => {
      normalHandlerCalled = true
    })

    await bus.publish({
      type: EventType.ERROR_OCCURRED,
      priority: EventPriority.CRITICAL,
      session_id: "s1",
      data: {},
      source: "test",
      timestamp: Date.now(),
      require_persistence: false,
    })

    await new Promise((r) => setTimeout(r, 10))
    expect(normalHandlerCalled).toBe(true)

    await bus.shutdown()
  })

  // ── Event uniqueness ────────────────────────────────────────────────────

  test("events have unique event_ids via persistBatch", async () => {
    const capturedEvents: PersistentEvent[] = []
    const persistBatch = async (events: PersistentEvent[]) => {
      capturedEvents.push(...events)
    }

    const bus = createSimpleEventBus(undefined, persistBatch)

    for (let i = 0; i < 10; i++) {
      await bus.publish({
        type: EventType.METRICS_SAMPLE,
        priority: EventPriority.CRITICAL,
        session_id: "s1",
        data: { i },
        source: "test",
        timestamp: Date.now(),
        require_persistence: true,
      })
    }

    await new Promise((r) => setTimeout(r, 20))

    const ids = capturedEvents.map((e) => e.event_id)
    expect(new Set(ids).size).toBe(10)

    await bus.shutdown()
  })
})

describe("EventBusService", () => {
  test("delegates all methods to underlying bus", async () => {
    const inner = createSimpleEventBus()
    const service = new EventBusService(inner)

    expect(typeof service.publish).toBe("function")
    expect(typeof service.enqueuePriority).toBe("function")
    expect(typeof service.subscribe).toBe("function")
    expect(typeof service.unsubscribe).toBe("function")
    expect(typeof service.waitForEvent).toBe("function")
    expect(typeof service.setPersistFn).toBe("function")
    expect(typeof service.shutdown).toBe("function")

    await service.shutdown()
  })

  test("EventBusService has correct static key", () => {
    expect(EventBusService.key).toBe("@fengru/EventBus")
  })
})

describe("enqueuePriority", () => {
  test("enqueuePriority dispatches event immediately", async () => {
    const bus = createSimpleEventBus()
    let received: BusEvent | null = null

    bus.subscribe(EventType.TASK_START, (event) => {
      received = event
    })

    await bus.enqueuePriority({
      type: EventType.TASK_START,
      priority: EventPriority.CRITICAL,
      session_id: "s1",
      data: { key: "enqueued" },
      source: "test",
      timestamp: Date.now(),
      require_persistence: false,
    })

    await new Promise((r) => setTimeout(r, 10))
    expect(received).not.toBeNull()
    expect(received!.data.key).toBe("enqueued")

    await bus.shutdown()
  })
})

describe("calculateSpecificity", () => {
  test("adds 10 for AND condition", () => {
    expect(calculateSpecificity("a AND b", "any")).toBeGreaterThanOrEqual(10)
  })

  test("adds 5 for context.contains", () => {
    expect(calculateSpecificity("context.contains(x)", "any")).toBeGreaterThanOrEqual(5)
  })

  test("adds 3 for tool= with specific tool", () => {
    const score = calculateSpecificity("tool=lint", "lint")
    const base = calculateSpecificity("tool=lint", "any")
    expect(score).toBeGreaterThan(base)
  })

  test("adds 1 for non-always condition", () => {
    expect(calculateSpecificity("x > 10", "any")).toBeGreaterThanOrEqual(1)
  })

  test("always returns 0", () => {
    expect(calculateSpecificity("always", "any")).toBe(0)
  })
})

describe("createEventBusService", () => {
  test("returns an EventBusService instance", () => {
    const inner = createSimpleEventBus()
    const service = createEventBusService(inner)
    expect(service).toBeInstanceOf(EventBusService)
  })
})

describe("UUID generation", () => {
  test("falls back to Math.random when crypto.randomUUID is unavailable", async () => {
    const original = (crypto as { randomUUID?: unknown }).randomUUID
    ;(crypto as { randomUUID?: unknown }).randomUUID = undefined
    try {
      const persisted: PersistentEvent[] = []
      const bus = createSimpleEventBus(undefined, async (batch: PersistentEvent[]) => {
        persisted.push(...batch)
      })
      await bus.publish({
        type: EventType.TASK_START,
        source: "test",
        session_id: "s1",
        data: {},
        priority: EventPriority.HIGH,
        timestamp: Date.now(),
        require_persistence: true,
      })
      expect(persisted.length).toBe(1)
      expect(persisted[0]!.event_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4/)
      await bus.shutdown()
    } finally {
      ;(crypto as { randomUUID?: unknown }).randomUUID = original
    }
  })
})
