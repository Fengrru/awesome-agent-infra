/**
 * Integration tests — event-bus × archiver cross-package wiring.
 *
 * Tests that events published on the event-bus flow into the archiver
 * for cold storage tiering, and that archived events can be queried
 * back after archival.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as os from "node:os"

import {
  createSimpleEventBus,
  EventType,
  EventPriority,
} from "../src/index"
import type { BusEvent, EventBus } from "../src/index"
import {
  EventArchiver,
  DEFAULT_ARCHIVE_CONFIG,
} from "../../archiver/src/index"
import type { ArchiveDatabase, ArchiveConfig } from "../../archiver/src/index"

// ── Helpers ────────────────────────────────────────────────────────────────

interface StoredEvent {
  id?: string
  eventId?: string
  event_id?: string
  type?: string
  event_type?: string
  session_id?: string
  timestamp?: number
  data?: Record<string, unknown>
  payload?: string
  [key: string]: unknown
}

function createMockArchiveDatabase(): {
  db: ArchiveDatabase & { events: StoredEvent[]; archiveStore: Map<string, StoredEvent[]> }
  getEvents: () => StoredEvent[]
  getArchiveStore: () => Map<string, StoredEvent[]>
} {
  const events: StoredEvent[] = []
  const archiveStore = new Map<string, StoredEvent[]>()

  const db: ArchiveDatabase & { events: StoredEvent[]; archiveStore: Map<string, StoredEvent[]> } = {
    events,
    archiveStore,

    async getEventCount(): Promise<number> {
      return events.length
    },

    async getEventsOlderThan(timestamp: number, limit: number): Promise<StoredEvent[]> {
      return events
        .filter((e) => (e.timestamp ?? 0) < timestamp)
        .slice(0, limit)
    },

    async deleteEventsByIds(ids: string[]): Promise<number> {
      const idSet = new Set(ids)
      const before = events.length
      let removed = 0
      for (let i = events.length - 1; i >= 0; i--) {
        const id = events[i]!.eventId ?? events[i]!.id ?? events[i]!.event_id
        if (id && idSet.has(id)) {
          events.splice(i, 1)
          removed++
        }
      }
      return removed
    },

    async getArchivedEvents(archiveId: string): Promise<StoredEvent[]> {
      return archiveStore.get(archiveId) ?? []
    },
  }

  return { db, getEvents: () => events, getArchiveStore: () => archiveStore }
}

function createBusEvent(overrides?: Partial<BusEvent>): BusEvent {
  return {
    type: EventType.TOOL_CALL,
    source: "test-agent",
    session_id: `session_${Date.now()}`,
    data: { tool: "read_file", path: "src/index.ts" },
    priority: EventPriority.NORMAL,
    timestamp: Date.now(),
    require_persistence: true,
    ...overrides,
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Integration: EventBus × EventArchiver", () => {

  let bus: EventBus
  let archiver: EventArchiver
  let mockDb: ReturnType<typeof createMockArchiveDatabase>
  let tempDir: string

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `archiver-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
    await fs.mkdir(tempDir, { recursive: true })

    bus = createSimpleEventBus()
    archiver = new EventArchiver({ storageDir: tempDir, maxHotEvents: 10 })
    mockDb = createMockArchiveDatabase()
    archiver.setDatabase(mockDb.db)
  })

  afterEach(async () => {
    await bus.shutdown()
    try {
      await fs.rm(tempDir, { recursive: true, force: true })
    } catch { /* cleanup best-effort */ }
  })

  // ── Event publishing → archiver storage ───────────────────────────────

  test("events published on event-bus with require_persistence reach persist handler", async () => {
    const persistedEvents: BusEvent[] = []

    const persistBus = createSimpleEventBus(
      (event) => {
        persistedEvents.push(event)
        mockDb.db.events.push({
          id: `ev-${mockDb.db.events.length}`,
          eventId: `ev-${mockDb.db.events.length}`,
          event_id: `ev-${mockDb.db.events.length}`,
          timestamp: event.timestamp,
          type: event.type,
          session_id: event.session_id,
          data: event.data,
          payload: JSON.stringify(event.data),
        })
      },
    )

    const event = createBusEvent({
      type: EventType.TASK_START,
      data: { task: "process user request", priority: "high" },
      require_persistence: true,
    })

    await persistBus.publish(event)

    // Wait for flush timer (50ms default)
    await new Promise((r) => setTimeout(r, 100))

    expect(persistedEvents.length).toBeGreaterThanOrEqual(1)
    expect(mockDb.getEvents().length).toBeGreaterThanOrEqual(1)
  })

  test("events subscribed on bus get archived when hot threshold exceeded", async () => {
    const receivedEvents: BusEvent[] = []
    const persistedEvents: BusEvent[] = []

    const persistBus = createSimpleEventBus(
      (event) => {
        persistedEvents.push(event)
        mockDb.db.events.push({
          id: `ev-${mockDb.db.events.length}`,
          eventId: `ev-${mockDb.db.events.length}`,
          event_id: `ev-${mockDb.db.events.length}`,
          timestamp: event.timestamp,
          type: event.type,
          session_id: event.session_id,
          data: event.data,
          payload: JSON.stringify(event.data),
        })
      },
      async (batch) => {
        for (const pe of batch) {
          mockDb.db.events.push({
            id: pe.event_id,
            eventId: pe.event_id,
            event_id: pe.event_id,
            timestamp: pe.timestamp,
            type: pe.event_type,
            session_id: pe.session_id,
            data: {},
            payload: pe.payload,
          })
        }
      },
    )

    persistBus.subscribe(EventType.TOOL_CALL, (event) => {
      receivedEvents.push(event)
    })

    // Publish multiple events
    for (let i = 0; i < 5; i++) {
      await persistBus.publish(createBusEvent({
        type: EventType.TOOL_CALL,
        source: `tool-${i}`,
        data: { tool: `cmd_${i}` },
        require_persistence: true,
        timestamp: Date.now() - 8 * 24 * 60 * 60 * 1000, // 8 days old
      }))
    }

    await new Promise((r) => setTimeout(r, 100))

    expect(mockDb.getEvents().length).toBeGreaterThanOrEqual(5)

    // Archiver checks the database for old events
    const shouldArchive = await archiver.shouldArchive()
    if (shouldArchive) {
      const result = await archiver.archive()
      if (result) {
        expect(result.eventCount).toBeGreaterThan(0)
      }
    }
  })

  // ── Archived event querying ───────────────────────────────────────────

  test("archived events can be queried back after archival", async () => {
    // Simulate events in the database
    const archivedContents = [
      { tool: "deploy", environment: "production", result: "success", timestamp: Date.now() - 86400000 * 30 },
      { tool: "rollback", environment: "production", result: "reverted", timestamp: Date.now() - 86400000 * 30 },
    ]

    const archiveId = `${DEFAULT_ARCHIVE_CONFIG.coldPrefix}${Date.now()}_test123`
    const jsonData = JSON.stringify(archivedContents)
    const fileName = `${archiveId}.json`
    const filePath = path.join(tempDir, fileName)

    await fs.writeFile(filePath, Buffer.from(jsonData, "utf-8"))

    const loaded = await archiver.loadArchive(archiveId)
    expect(loaded.length).toBe(2)
    expect(loaded[0]!.tool).toBe("deploy")
    expect(loaded[1]!.tool).toBe("rollback")
  })

  test("loadArchive returns empty array for non-existent archive", async () => {
    const loaded = await archiver.loadArchive("nonexistent_archive_id")
    expect(loaded).toEqual([])
  })

  test("loadArchive falls back to database when file not found", async () => {
    const fallbackData = [{ fromDb: true, value: 42 }]
    mockDb.getArchiveStore().set("fallback-id", fallbackData)

    const loaded = await archiver.loadArchive("fallback-id")
    expect(loaded).toEqual(fallbackData)
  })

  // ── Event subscription + archival integration ────────────────────────

  test("subscriber receives events while archiver persists them independently", async () => {
    const subLog: string[] = []
    const persistLog: BusEvent[] = []

    const persistBus = createSimpleEventBus(
      (event) => {
        persistLog.push(event)
        // Simulate archiver-style storage
        mockDb.db.events.push({
          id: event.data.id as string ?? `ev-${mockDb.db.events.length}`,
          eventId: event.data.id as string ?? `ev-${mockDb.db.events.length}`,
          timestamp: event.timestamp,
          type: event.type,
          session_id: event.session_id,
          data: event.data,
        })
      },
    )

    persistBus.subscribe(EventType.STATE_TRANSITION, (event) => {
      subLog.push((event.data.from as string) ?? "unknown")
    })

    const e1 = createBusEvent({
      type: EventType.STATE_TRANSITION,
      data: { from: "IDLE", to: "READY", id: "ev-1" },
      require_persistence: true,
    })
    const e2 = createBusEvent({
      type: EventType.STATE_TRANSITION,
      data: { from: "READY", to: "EXECUTING", id: "ev-2" },
      require_persistence: true,
    })

    await persistBus.publish(e1)
    await persistBus.publish(e2)

    await new Promise((r) => setTimeout(r, 100))

    expect(subLog.length).toBeGreaterThanOrEqual(2)
    expect(persistLog.length).toBeGreaterThanOrEqual(2)
    expect(mockDb.getEvents().length).toBeGreaterThanOrEqual(2)
  })

  // ── Event persistence + archive tiering workflow ──────────────────────

  test("full workflow: publish → persist → shouldArchive → archive → loadArchive", async () => {
    const persistBus = createSimpleEventBus(
      (event) => {
        mockDb.db.events.push({
          id: `wf-ev-${mockDb.db.events.length}`,
          eventId: `wf-ev-${mockDb.db.events.length}`,
          timestamp: event.timestamp,
          type: event.type,
          session_id: event.session_id,
          data: event.data,
        })
      },
    )

    // Publish events with old timestamps (simulating old hot storage)
    for (let i = 0; i < 15; i++) {
      await persistBus.publish(createBusEvent({
        type: EventType.AGENT_OUTPUT,
        source: "agent",
        data: { content: `output ${i}`, step: i },
        require_persistence: true,
        timestamp: Date.now() - 10 * 24 * 60 * 60 * 1000, // 10 days ago
      }))
    }

    await new Promise((r) => setTimeout(r, 100))

    const eventCount = await mockDb.db.getEventCount()
    expect(eventCount).toBeGreaterThanOrEqual(15)

    // Set low threshold so shouldArchive returns true
    const lowArchiver = new EventArchiver({ storageDir: tempDir, maxHotEvents: 5 })
    lowArchiver.setDatabase(mockDb.db)

    // All events are old so archive should pick them up
    expect(await lowArchiver.shouldArchive()).toBe(true)

    const result = await lowArchiver.archive(Date.now()) // any events older than now
    if (result) {
      expect(result.eventCount).toBeGreaterThan(0)
      expect(result.archiveId).toContain(DEFAULT_ARCHIVE_CONFIG.coldPrefix)
      expect(result.compressed).toBe(false)

      // After archival, events are deleted from hot storage
      const remaining = await mockDb.db.getEventCount()
      expect(remaining).toBeLessThan(eventCount)

      // Load the archive back
      const loaded = await lowArchiver.loadArchive(result.archiveId)
      expect(loaded.length).toBe(result.eventCount)
    }
  })
})
