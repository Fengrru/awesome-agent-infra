import { randomUUID } from "node:crypto"

function generateUUID(): string {
  return randomUUID()
}

export enum EventPriority {
  CRITICAL = 0,
  HIGH = 1,
  NORMAL = 2,
  LOW = 3,
  BACKGROUND = 4,
}

export const EventType = {
  TASK_START: "task_start",
  TOOL_CALL: "tool_call",
  TOOL_RESULT: "tool_result",
  STATE_TRANSITION: "state_transition",
  CHECKPOINT_CREATE: "checkpoint_create",
  USER_INPUT: "user_input",
  AGENT_OUTPUT: "agent_output",
  ARCHIVE_SUMMARY: "archive_summary",
  FILESYSTEM_COMMITTED: "filesystem_committed",
  FILESYSTEM_CONFLICT: "filesystem_conflict",
  REPAIR_SUCCESS: "repair_success",
  PLANNING_FAILED: "planning_failed",
  DAG_GENERATED: "dag_generated",
  VALIDATION_PASSED: "validation_passed",
  VALIDATION_FAILED: "validation_failed",
  DAG_NODE_FAILED: "dag_node_failed",
  ERROR_OCCURRED: "error_occurred",
  SESSION_PAUSED: "session_paused",
  SESSION_COMPLETED: "session_completed",
  ENTROPY_ALERT: "entropy_alert",
  METRICS_SAMPLE: "metrics_sample",
  CHAT_THINKING_STARTED: "chat_thinking_started",
  CHAT_COMPLETED: "chat_completed",
  DREAM_COMPLETED: "dream_completed",
  DISTILL_COMPLETED: "distill_completed",
  SKILL_CURATION_COMPLETED: "skill_curation_completed",
} as const

export type EventType = (typeof EventType)[keyof typeof EventType]

export interface BusEvent {
  type: EventType
  source: string
  session_id: string
  data: Record<string, unknown>
  priority: EventPriority
  timestamp: number
  require_persistence: boolean
  parent_event_id?: string
}

export interface PersistentEvent {
  event_id: string
  session_id: string
  parent_event_id: string | null
  event_type: EventType
  payload: string
  status: string
  token_cost: number
  duration_ms: number
  sequence_index: number
  timestamp: number
}

export type EventHandler = (event: BusEvent) => void

export type EventBusPersistFn = (event: BusEvent) => void | Promise<void>

export type EventBusPersistBatchFn = (events: PersistentEvent[]) => void | Promise<void>

export interface EventBus {
  readonly publish: (event: BusEvent) => Promise<void>
  readonly enqueuePriority: (event: BusEvent) => Promise<void>
  readonly subscribe: (eventType: EventType, handler: EventHandler) => void
  readonly unsubscribe: (eventType: EventType, handler: EventHandler) => void
  readonly waitForEvent: (
    eventType: EventType,
    timeoutMs: number,
    predicate?: (event: BusEvent) => boolean,
  ) => Promise<BusEvent | null>
  readonly setPersistFn: (fn: EventBusPersistFn | null) => void
  readonly shutdown: () => Promise<void>
}

export class EventBusService {
  static readonly key = "@fengru/EventBus"
  private readonly bus: EventBus
  constructor(bus: EventBus) {
    this.bus = bus
  }
  get publish() {
    return this.bus.publish
  }
  get enqueuePriority() {
    return this.bus.enqueuePriority
  }
  get subscribe() {
    return this.bus.subscribe
  }
  get unsubscribe() {
    return this.bus.unsubscribe
  }
  get waitForEvent() {
    return this.bus.waitForEvent
  }
  get setPersistFn() {
    return this.bus.setPersistFn
  }
  get shutdown() {
    return this.bus.shutdown
  }
}

const BATCH_SIZE = 500
const FLUSH_INTERVAL_MS = 50

function toPersistentEvents(events: BusEvent[], sequenceCounters: Map<string, number>): PersistentEvent[] {
  return events.map((event) => {
    const seq = sequenceCounters.get(event.session_id) ?? 0
    return {
      event_id: generateUUID(),
      session_id: event.session_id,
      parent_event_id: event.parent_event_id ?? null,
      event_type: event.type,
      payload: JSON.stringify(event.data),
      status: ((event.data as Record<string, unknown>).status as string) ?? "success",
      token_cost: ((event.data as Record<string, unknown>).token_cost as number) ?? 0,
      duration_ms: ((event.data as Record<string, unknown>).duration_ms as number) ?? 0,
      sequence_index: seq,
      timestamp: event.timestamp,
    }
  })
}

function incrementSequenceCounters(events: BusEvent[], sequenceCounters: Map<string, number>): void {
  for (const event of events) {
    if (event.require_persistence) {
      const current = sequenceCounters.get(event.session_id) ?? 0
      sequenceCounters.set(event.session_id, current + 1)
    }
  }
}

function createHandlerRegistry() {
  const handlers = new Map<EventType, Set<EventHandler>>()
  return {
    subscribe(eventType: EventType, handler: EventHandler) {
      const subs = handlers.get(eventType) ?? new Set()
      subs.add(handler)
      handlers.set(eventType, subs)
    },
    unsubscribe(eventType: EventType, handler: EventHandler) {
      const subs = handlers.get(eventType)
      if (subs) {
        subs.delete(handler)
        if (subs.size === 0) handlers.delete(eventType)
      }
    },
    dispatch(event: BusEvent) {
      const subs = handlers.get(event.type)
      if (subs) {
        for (const handler of subs) {
          try {
            handler(event)
          } catch {
            /* swallow */
          }
        }
      }
    },
    clear() {
      handlers.clear()
    },
  }
}

function createWaitForEvent(reg: ReturnType<typeof createHandlerRegistry>) {
  return async (
    eventType: EventType,
    timeoutMs: number,
    predicate?: (event: BusEvent) => boolean,
  ): Promise<BusEvent | null> => {
    let timeoutId: ReturnType<typeof setTimeout>
    return new Promise<BusEvent | null>((resolve) => {
      const handler = (event: BusEvent) => {
        if (predicate && !predicate(event)) return
        clearTimeout(timeoutId)
        reg.unsubscribe(eventType, handler)
        resolve(event)
      }
      timeoutId = setTimeout(() => {
        reg.unsubscribe(eventType, handler)
        resolve(null)
      }, timeoutMs)
      reg.subscribe(eventType, handler)
    })
  }
}

export function createSimpleEventBus(persistFn?: EventBusPersistFn, persistBatch?: EventBusPersistBatchFn): EventBus {
  let _persistFn = persistFn
  const _persistBatch = persistBatch
  const reg = createHandlerRegistry()
  const sequenceCounters = new Map<string, number>()

  const batchQueue: BusEvent[] = []
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let running = true

  async function flushBatch(): Promise<void> {
    if (batchQueue.length === 0) return
    const toFlush = batchQueue.splice(0, batchQueue.length)
    for (const event of toFlush) {
      reg.dispatch(event)
    }
    const persistable = toFlush.filter((e) => e.require_persistence)
    if (persistable.length > 0 && _persistBatch) {
      const persistentEvents = toPersistentEvents(persistable, sequenceCounters)
      try {
        await _persistBatch(persistentEvents)
      } catch {
        /* swallow */
      }
    } else if (persistable.length > 0 && _persistFn) {
      for (const event of persistable) {
        try {
          await _persistFn(event)
        } catch {
          /* swallow */
        }
      }
    }
  }

  function startFlushTimer(): void {
    if (flushTimer !== null) return
    flushTimer = setTimeout(() => {
      flushTimer = null
      flushBatch().catch(() => {})
      if (running) startFlushTimer()
    }, FLUSH_INTERVAL_MS)
    if (flushTimer && typeof flushTimer === "object" && "unref" in flushTimer) {
      ;(flushTimer as unknown as { unref(): void }).unref()
    }
  }

  startFlushTimer()

  const eventBus: EventBus = {
    publish: async (event: BusEvent) => {
      if (!running) return
      if (event.priority <= EventPriority.HIGH) {
        incrementSequenceCounters([event], sequenceCounters)
        await flushQueueImmediate([event])
      } else {
        batchQueue.push(event)
        incrementSequenceCounters([event], sequenceCounters)
        if (batchQueue.length >= BATCH_SIZE) {
          await flushBatch()
        }
      }
    },

    enqueuePriority: async (event: BusEvent) => {
      if (!running) return
      incrementSequenceCounters([event], sequenceCounters)
      await flushQueueImmediate([event])
    },

    subscribe: reg.subscribe,
    unsubscribe: reg.unsubscribe,
    waitForEvent: createWaitForEvent(reg),

    setPersistFn: (fn: EventBusPersistFn | null) => {
      _persistFn = fn ?? undefined
    },

    shutdown: async () => {
      running = false
      if (flushTimer !== null) {
        clearTimeout(flushTimer)
        flushTimer = null
      }
      await flushBatch()
      reg.clear()
      batchQueue.length = 0
    },
  }

  async function flushQueueImmediate(events: BusEvent[]): Promise<void> {
    if (events.length === 0) return
    for (const event of events) {
      reg.dispatch(event)
    }
    const persistable = events.filter((e) => e.require_persistence)
    if (persistable.length > 0 && _persistBatch) {
      const persistentEvents = toPersistentEvents(persistable, sequenceCounters)
      try {
        await _persistBatch(persistentEvents)
      } catch {
        /* swallow */
      }
    } else if (persistable.length > 0 && _persistFn) {
      for (const event of persistable) {
        try {
          await _persistFn(event)
        } catch {
          /* swallow */
        }
      }
    }
  }

  return eventBus
}

export function calculateSpecificity(condition: string, tool: string): number {
  let score = 0
  if (condition.includes("AND")) score += 10
  if (condition.includes("context.contains")) score += 5
  if (condition.includes("tool=") && tool !== "any") score += 3
  if (condition !== "always") score += 1
  return score
}

/**
 * Create a {@link EventBusService} instance.
 *
 * @param args - Constructor arguments forwarded to {@link EventBusService}.
 * @returns A new {@link EventBusService}.
 */
export function createEventBusService(...args: ConstructorParameters<typeof EventBusService>): EventBusService {
  return new EventBusService(...args)
}
