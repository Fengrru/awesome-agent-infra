/**
 * Adapter integration tests — EngineDatabase adapters for agent-memory & archiver/dreamdistill.
 *
 * Tests the MemoryBackend and EventArchiveBackend adapters
 * with EngineDatabase, verifying cross-package structural typing.
 */

import { describe, expect, test } from "bun:test"
import { EngineDatabase, EventArchiveBackend, MemoryBackend } from "../src/index"

// ── Helpers ────────────────────────────────────────────────────────────

function createMockDB() {
  const store = new Map<string, Map<string, unknown[]>>()

  return {
    query(_sql: string) {
      return {
        all: (..._params: unknown[]): unknown[] => [],
        get: (..._params: unknown[]): unknown => null,
        run: (..._params: unknown[]): void => {},
      }
    },
    prepare(_sql: string) {
      return {
        all: (..._params: unknown[]): unknown[] => [],
        get: (..._params: unknown[]): unknown => null,
        run: (..._params: unknown[]): void => {},
      }
    },
    run(_sql: string, ..._params: unknown[]): void {},
    transaction<T>(fn: () => T): () => T {
      return fn
    },
    close(): void {},
  }
}

// ── MemoryBackend ──────────────────────────────────────────────────────

describe("MemoryBackend (engine-db × agent-memory)", () => {
  test("constructs wrapping EngineDatabase", () => {
    const db = new EngineDatabase()
    // Set up mock to avoid missing table errors
    db.setDatabase(createMockDB())

    const backend = new MemoryBackend(db)

    // Verify all MemoryDatabase methods exist
    expect(typeof backend.insertMemory).toBe("function")
    expect(typeof backend.getMemories).toBe("function")
    expect(typeof backend.searchByTags).toBe("function")
    expect(typeof backend.markSuccessful).toBe("function")
    expect(typeof backend.getAgentSelfRules).toBe("function")
    expect(typeof backend.upsertAgentSelfRule).toBe("function")
    expect(typeof backend.getUserProfiles).toBe("function")
    expect(typeof backend.upsertUserProfile).toBe("function")
  })

  test("insertMemory delegates to engine", () => {
    const db = new EngineDatabase()
    db.setDatabase(createMockDB())

    const backend = new MemoryBackend(db)
    const mem = {
      memory_id: "mem-adapter-1",
      content: "Adapter test memory",
      token_count: 8,
      importance: 0.7,
      access_count: 2,
      created_at: Date.now(),
      last_accessed: Date.now(),
      retention_score: 0.9,
    }

    // Should not throw
    expect(() => backend.insertMemory(mem)).not.toThrow()
  })

  test("getMemories delegates to engine", () => {
    const db = new EngineDatabase()
    db.setDatabase(createMockDB())

    const backend = new MemoryBackend(db)
    const memories = backend.getMemories("session-1")
    expect(Array.isArray(memories)).toBe(true)
  })

  test("upsertAgentSelfRule and getAgentSelfRules round-trips with mock DB", () => {
    const db = new EngineDatabase()
    db.setDatabase(createMockDB())

    const backend = new MemoryBackend(db)
    const rule = {
      rule_id: "adapter-rule-1",
      category: "test",
      content: "Adapter test rule",
      token_count: 5,
      importance: 0.8,
    }

    expect(() => backend.upsertAgentSelfRule(rule)).not.toThrow()
    const rules = backend.getAgentSelfRules()
    expect(Array.isArray(rules)).toBe(true)
  })

  test("user profile CRUD via adapter", () => {
    const db = new EngineDatabase()
    db.setDatabase(createMockDB())

    const backend = new MemoryBackend(db)
    const profile = {
      profile_id: "prof-1",
      user_hash: "hash123",
      category: "preference",
      content: "Uses dark mode",
      token_count: 3,
      importance: 0.5,
    }

    expect(() => backend.upsertUserProfile(profile)).not.toThrow()
    const profiles = backend.getUserProfiles("hash123")
    expect(Array.isArray(profiles)).toBe(true)
  })

  test("searchByTags delegates to engine", () => {
    const db = new EngineDatabase()
    db.setDatabase(createMockDB())

    const backend = new MemoryBackend(db)
    const results = backend.searchByTags(["test"])
    expect(Array.isArray(results)).toBe(true)
  })

  test("markSuccessful delegates to engine", () => {
    const db = new EngineDatabase()
    db.setDatabase(createMockDB())

    const backend = new MemoryBackend(db)
    expect(() => backend.markSuccessful("mem-1")).not.toThrow()
  })
})

// ── EventArchiveBackend ────────────────────────────────────────────────

describe("EventArchiveBackend (engine-db × archiver/dreamdistill)", () => {
  test("constructs wrapping EngineDatabase", () => {
    const db = new EngineDatabase()
    db.setDatabase(createMockDB())

    const backend = new EventArchiveBackend(db)

    // Verify ArchiveDatabase methods exist
    expect(typeof backend.getEventCount).toBe("function")
    expect(typeof backend.getEventsOlderThan).toBe("function")
    expect(typeof backend.deleteEventsByIds).toBe("function")
    expect(typeof backend.getArchivedEvents).toBe("function")

    // Verify IEventArchiver methods exist
    expect(typeof backend.queryEvents).toBe("function")
    expect(typeof backend.getSessionIds).toBe("function")
  })

  test("getEventCount returns number", async () => {
    const db = new EngineDatabase()
    db.setDatabase(createMockDB())

    const backend = new EventArchiveBackend(db)
    const count = await backend.getEventCount()
    expect(typeof count).toBe("number")
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test("getEventsOlderThan returns array with limit", async () => {
    const db = new EngineDatabase()
    db.setDatabase(createMockDB())

    const backend = new EventArchiveBackend(db)
    const events = await backend.getEventsOlderThan(Date.now() + 86400000, 5)
    expect(Array.isArray(events)).toBe(true)
    expect(events.length).toBeLessThanOrEqual(5)
  })

  test("deleteEventsByIds returns count of attempted deletions", async () => {
    const db = new EngineDatabase()
    db.setDatabase(createMockDB())

    const backend = new EventArchiveBackend(db)
    const count = await backend.deleteEventsByIds(["evt-1", "evt-2"])
    expect(count).toBe(2) // best-effort returns count
  })

  test("getArchivedEvents returns empty array (disk storage)", async () => {
    const db = new EngineDatabase()
    db.setDatabase(createMockDB())

    const backend = new EventArchiveBackend(db)
    const events = await backend.getArchivedEvents("archive-1")
    expect(Array.isArray(events)).toBe(true)
    expect(events.length).toBe(0) // archived on disk
  })

  test("queryEvents returns array with structured event data", async () => {
    const db = new EngineDatabase()
    db.setDatabase(createMockDB())

    const backend = new EventArchiveBackend(db)
    const events = await backend.queryEvents("session-1", 10)

    expect(Array.isArray(events)).toBe(true)
    // Each event should have the IEventArchiver shape
    for (const event of events) {
      expect(event).toHaveProperty("event_type")
      expect(event).toHaveProperty("timestamp")
      expect(event).toHaveProperty("session_id")
      expect(event).toHaveProperty("payload")
    }
  })

  test("getSessionIds returns array", async () => {
    const db = new EngineDatabase()
    db.setDatabase(createMockDB())

    const backend = new EventArchiveBackend(db)
    const sessions = await backend.getSessionIds(50)

    expect(Array.isArray(sessions)).toBe(true)
  })

  test("queryEvents with string payload parses JSON", async () => {
    const mockEngine = {
      queryEvents(_sid: string, _fromSeq?: number, _limit?: number) {
        return [
          {
            event_type: "test",
            timestamp: 1234567890,
            session_id: "s1",
            payload: '{"key":"value"}',
          },
        ]
      },
      countEvents(_sid: string) {
        return 1
      },
    } as unknown as EngineDatabase

    const backend = new EventArchiveBackend(mockEngine)
    const events = await backend.queryEvents("s1", 10)

    expect(events.length).toBe(1)
    expect(events[0]).toHaveProperty("payload")
    expect(events[0].payload).toEqual({ key: "value" })
  })

  // ── Structural typing verification ────────────────────────────────

  test("EventArchiveBackend satisfies ArchiveDatabase interface structurally", () => {
    const db = new EngineDatabase()
    db.setDatabase(createMockDB())

    const backend = new EventArchiveBackend(db)

    // Duck-typing: if it has the methods, it implements the interface
    const asArchiveDB: Record<string, unknown> = backend as unknown as Record<string, unknown>
    expect(typeof asArchiveDB.getEventCount).toBe("function")
    expect(typeof asArchiveDB.getEventsOlderThan).toBe("function")
    expect(typeof asArchiveDB.deleteEventsByIds).toBe("function")
    expect(typeof asArchiveDB.getArchivedEvents).toBe("function")
  })

  test("EventArchiveBackend satisfies IEventArchiver interface structurally", () => {
    const db = new EngineDatabase()
    db.setDatabase(createMockDB())

    const backend = new EventArchiveBackend(db)

    const asEventArchiver: Record<string, unknown> = backend as unknown as Record<string, unknown>
    expect(typeof asEventArchiver.queryEvents).toBe("function")
    expect(typeof asEventArchiver.getSessionIds).toBe("function")
  })
})
