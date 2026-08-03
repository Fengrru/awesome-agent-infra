import { afterAll, describe, expect, test } from "bun:test"
import * as fs from "node:fs/promises"
import { rm } from "node:fs/promises"
import * as path from "node:path"
import {
  type ArchiveConfig,
  type ArchiveDatabase,
  type ArchiveResult,
  createEventArchiver,
  DEFAULT_ARCHIVE_CONFIG,
  EventArchiver,
} from "../src/index"

const TEST_DIR = path.join(import.meta.dirname ?? ".", "test-archives")

declare const Bun: {
  gzipSync?: (data: Uint8Array) => Uint8Array | null
}

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
      this.events = this.events.filter((e) => !ids.includes(String(e.eventId ?? e.id ?? "")))
      return ids.length
    },
    async getArchivedEvents(_archiveId: string) {
      return this.events
    },
  }
}

afterAll(async () => {
  try {
    await rm(TEST_DIR, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
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

describe("EventArchiver - loadArchive fallbacks", () => {
  test("loadArchive returns empty array for non-existent archive", async () => {
    const archiver = new EventArchiver({ storageDir: TEST_DIR })
    const result = await archiver.loadArchive("nonexistent_archive_id")
    expect(result).toEqual([])
  })
})

describe("EventArchiver - compression", () => {
  test("archive compresses with gzip when enabled", async () => {
    const archiver = new EventArchiver({ storageDir: TEST_DIR, compress: true })
    const events = Array.from({ length: 10 }, (_, i) => ({ eventId: `gz_${i}`, n: i }))
    const db = makeDB(events)
    archiver.setDatabase(db)

    const result = await archiver.archive(Date.now() + 100000)
    expect(result).toBeDefined()
    expect(result!.compressed).toBe(true)
    expect(result!.filePath).toMatch(/\.json\.gz$/)
    expect(result!.byteSize).toBeGreaterThan(0)

    // Reading back decompresses via gunzip
    const loaded = await archiver.loadArchive(result!.archiveId)
    expect(loaded.length).toBe(10)
    expect(loaded[0]!.eventId).toBe("gz_0")
  })

  test("gzip failure falls back to uncompressed json", async () => {
    const original = Bun.gzipSync
    Bun.gzipSync = () => {
      throw new Error("gzip broken")
    }
    try {
      const archiver = new EventArchiver({ storageDir: TEST_DIR, compress: true })
      const db = makeDB([{ eventId: "e1" }])
      archiver.setDatabase(db)
      const result = await archiver.archive(Date.now() + 100000)
      expect(result!.compressed).toBe(false)
      expect(result!.filePath).toMatch(/\.json$/)
    } finally {
      Bun.gzipSync = original
    }
  })

  test("gzip returning null skips compression", async () => {
    const original = Bun.gzipSync
    Bun.gzipSync = () => null
    try {
      const archiver = new EventArchiver({ storageDir: TEST_DIR, compress: true })
      const db = makeDB([{ eventId: "e2" }])
      archiver.setDatabase(db)
      const result = await archiver.archive(Date.now() + 100000)
      expect(result!.compressed).toBe(false)
      expect(result!.byteSize).toBeGreaterThan(0)
    } finally {
      Bun.gzipSync = original
    }
  })

  test("loadArchive gunzip failure falls back to raw json", async () => {
    const archiver = new EventArchiver({ storageDir: TEST_DIR, coldPrefix: "c_gz_" })
    const db = makeDB([{ eventId: "e3" }])
    archiver.setDatabase(db)

    // archive uncompressed, but archiveId ends with _gz so loadArchive tries gunzip
    const result = await archiver.archive(Date.now() + 100000)
    expect(result).toBeDefined()
    expect(result!.filePath).toMatch(/\.json$/) // not compressed

    const loaded = await archiver.loadArchive(result!.archiveId)
    expect(loaded).toEqual([{ eventId: "e3" }])
  })

  test("loadArchive returns [] for corrupt gzip file", async () => {
    const archiver = new EventArchiver({ storageDir: TEST_DIR, compress: true })
    await fs.mkdir(TEST_DIR, { recursive: true })
    await fs.writeFile(path.join(TEST_DIR, "corrupt_gz.json.gz"), "not actually gzip")
    const result = await archiver.loadArchive("corrupt_gz")
    expect(result).toEqual([])
  })

  test("loadArchive returns [] for invalid json", async () => {
    const archiver = new EventArchiver({ storageDir: TEST_DIR })
    await fs.mkdir(TEST_DIR, { recursive: true })
    await fs.writeFile(path.join(TEST_DIR, "bad.json"), "{invalid")
    const result = await archiver.loadArchive("bad")
    expect(result).toEqual([])
  })

  test("loadArchive returns object wrapped in array when json is an object", async () => {
    const archiver = new EventArchiver({ storageDir: TEST_DIR })
    await fs.mkdir(TEST_DIR, { recursive: true })
    await fs.writeFile(path.join(TEST_DIR, "single.json"), JSON.stringify({ eventId: "solo" }))
    const result = await archiver.loadArchive("single")
    expect(result).toEqual([{ eventId: "solo" }])
  })
})

describe("EventArchiver - database fallback", () => {
  test("loadArchive falls back to database when files are missing", async () => {
    const archiver = new EventArchiver({ storageDir: TEST_DIR })
    const db = makeDB([{ fromDb: true }])
    archiver.setDatabase(db)
    const result = await archiver.loadArchive("missing_from_disk")
    expect(result).toEqual([{ fromDb: true }])
  })

  test("loadArchive returns [] when database fallback throws", async () => {
    const archiver = new EventArchiver({ storageDir: TEST_DIR })
    const db = makeDB()
    db.getArchivedEvents = async () => {
      throw new Error("db down")
    }
    archiver.setDatabase(db)
    const result = await archiver.loadArchive("missing_from_disk")
    expect(result).toEqual([])
  })

  test("archive returns null when no events older than cutoff", async () => {
    const archiver = new EventArchiver({ storageDir: TEST_DIR })
    const db = makeDB()
    db.getEventCount = async () => 5
    db.getEventsOlderThan = async () => []
    archiver.setDatabase(db)
    expect(await archiver.archive()).toBeNull()
  })

  test("listArchives returns [] when storage dir is missing", async () => {
    const archiver = new EventArchiver({ storageDir: path.join(TEST_DIR, "missing-dir") })
    expect(await archiver.listArchives()).toEqual([])
  })
})

describe("createEventArchiver", () => {
  test("returns an EventArchiver instance", () => {
    const archiver = createEventArchiver()
    expect(archiver).toBeInstanceOf(EventArchiver)
  })

  test("createEventArchiver with custom config", () => {
    const archiver = createEventArchiver({ maxHotEvents: 500 })
    expect(archiver.config.maxHotEvents).toBe(500)
  })
})
