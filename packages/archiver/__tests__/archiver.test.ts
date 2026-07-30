import { describe, expect, test, afterAll } from "bun:test"
import {
  EventArchiver,
  DEFAULT_ARCHIVE_CONFIG,
  type ArchiveConfig,
  type ArchiveDatabase,
  type ArchiveResult,
} from "../src/index"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { rm } from "node:fs/promises"

const TEST_DIR = path.join(import.meta.dirname ?? ".", "test-archives")

function makeDB(events?: Record<string, unknown>[]): ArchiveDatabase & {
  eventCount: number
  events: Record<string, unknown>[]
  deletedIds: string[]
} {
  return {
    eventCount: 0,
    events: events ?? [],
    deletedIds: [] as string[],
    async getEventCount() {
      return this.events.length
    },
    async getEventsOlderThan(_timestamp: number, _limit: number) {
      return [...this.events]
    },
    async deleteEventsByIds(ids: string[]) {
      this.deletedIds.push(...ids)
      this.events = this.events.filter(
        (e) => !ids.includes(String(e.eventId ?? e.id ?? "")),
      )
      return ids.length
    },
    async getArchivedEvents(_archiveId: string) {
      return []
    },
  }
}

afterAll(async () => {
  try { await rm(TEST_DIR, { recursive: true, force: true }) } catch { /* ignore */ }
})

describe("EventArchiver", () => {
  // ── Configuration ──────────────────────────────────────────────────────

  test("default config is applied", () => {
    const archiver = new EventArchiver()
    expect(archiver.config.maxHotEvents).toBe(DEFAULT_ARCHIVE_CONFIG.maxHotEvents)
    expect(archiver.config.compress).toBe(false)
    expect(archiver.config.storageDir).toBe("./archives")
  })

  test("partial config overrides defaults", () => {
    const archiver = new EventArchiver({ maxHotEvents: 500, compress: true })
    expect(archiver.config.maxHotEvents).toBe(500)
    expect(archiver.config.compress).toBe(true)
    // Unspecified defaults remain
    expect(archiver.config.storageDir).toBe("./archives")
  })

  // ── shouldArchive ──────────────────────────────────────────────────────

  test("shouldArchive returns false when count < threshold", async () => {
    const archiver = new EventArchiver({ maxHotEvents: 100 })
    const db = makeDB()
    db.events = Array.from({ length: 50 }, (_, i) => ({ eventId: `${i}` }))
    archiver.setDatabase(db)

    const should = await archiver.shouldArchive()
    expect(should).toBe(false)
  })

  test("shouldArchive returns true when count >= threshold", async () => {
    const archiver = new EventArchiver({ maxHotEvents: 100 })
    const db = makeDB()
    db.events = Array.from({ length: 150 }, (_, i) => ({ eventId: `${i}` }))
    archiver.setDatabase(db)

    const should = await archiver.shouldArchive()
    expect(should).toBe(true)
  })

  test("shouldArchive returns false when no database is set", async () => {
    const archiver = new EventArchiver()
    const should = await archiver.shouldArchive()
    expect(should).toBe(false)
  })

  // ── archive ────────────────────────────────────────────────────────────

  test("archive writes events to disk and deletes from hot storage", async () => {
    const archiver = new EventArchiver({ storageDir: TEST_DIR })
    const events = Array.from({ length: 10 }, (_, i) => ({
      eventId: `evt_${i}`,
      type: "plan",
      payload: { index: i },
    }))
    const db = makeDB(events)
    archiver.setDatabase(db)

    const result = await archiver.archive(Date.now() + 100000) // future cutoff to include all
    expect(result).toBeDefined()
    expect(result!.eventCount).toBe(10)
    expect(result!.filePath).toContain(TEST_DIR)
    expect(result!.compressed).toBe(false)
    expect(result!.byteSize).toBeGreaterThan(0)

    // Verify file exists on disk
    const fileExists = await fs.stat(result!.filePath).then(
      () => true,
      () => false,
    )
    expect(fileExists).toBe(true)

    // Verify events were deleted from hot storage
    expect(db.events.length).toBe(0)
    expect(db.deletedIds.length).toBe(10)
  })

  test("archive returns null when there are no events", async () => {
    const archiver = new EventArchiver({ storageDir: TEST_DIR })
    const db = makeDB([])
    archiver.setDatabase(db)

    const result = await archiver.archive()
    expect(result).toBeNull()
  })

  test("archive returns null when no database is set", async () => {
    const archiver = new EventArchiver({ storageDir: TEST_DIR })
    const result = await archiver.archive()
    expect(result).toBeNull()
  })

  // ── loadArchive ────────────────────────────────────────────────────────

  test("loadArchive reads events from disk", async () => {
    const archiver = new EventArchiver({ storageDir: TEST_DIR })
    const events = Array.from({ length: 5 }, (_, i) => ({
      eventId: `load_${i}`,
      data: `payload_${i}`,
    }))
    const db = makeDB(events)
    archiver.setDatabase(db)

    const archived = await archiver.archive(Date.now() + 100000)
    expect(archived).toBeDefined()

    if (archived) {
      const loaded = await archiver.loadArchive(archived.archiveId)
      expect(loaded.length).toBe(5)
      expect(loaded[0]!.eventId).toBe("load_0")
    }
  })

  // ── shouldCompress ─────────────────────────────────────────────────────

  test("shouldCompress returns false when compress is disabled", async () => {
    const archiver = new EventArchiver({ compress: false })
    const result = await archiver.shouldCompress(5000)
    expect(result).toBe(false)
  })

  test("shouldCompress returns false when event count is low", async () => {
    const archiver = new EventArchiver({ compress: true })
    const result = await archiver.shouldCompress(500)
    expect(result).toBe(false)
  })

  test("shouldCompress returns true when compress enabled and count high", async () => {
    const archiver = new EventArchiver({ compress: true })
    const result = await archiver.shouldCompress(2000)
    expect(result).toBe(true)
  })

  // ── listArchives ───────────────────────────────────────────────────────

  test("listArchives returns archive IDs", async () => {
    const archiver = new EventArchiver({ storageDir: TEST_DIR })
    const db = makeDB([{ eventId: "e1" }])
    archiver.setDatabase(db)
    await archiver.archive(Date.now() + 100000)

    const archives = await archiver.listArchives()
    expect(archives.length).toBeGreaterThanOrEqual(1)
    for (const id of archives) {
      expect(id).toMatch(/^cold_/)
    }
  })
})
