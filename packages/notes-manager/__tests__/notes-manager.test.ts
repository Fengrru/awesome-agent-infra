import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NotesManager } from "../src/index"
import type { NoteEntry, NoteTag, NotesConfig } from "../src/index"

const testDir = join(tmpdir(), `notes-manager-test-${Date.now()}`)

afterAll(async () => {
  try {
    await rm(testDir, { recursive: true, force: true })
  } catch {
    // best-effort cleanup
  }
})

function createManager(overrides?: Partial<NotesConfig>): NotesManager {
  return new NotesManager({ notesDir: testDir, ...overrides })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripTimestamps(entries: NoteEntry[]): Pick<NoteEntry, "content" | "tag">[] {
  return entries.map(({ content, tag }) => ({ content, tag }))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NotesManager", () => {
  // 1 ── append + readAll round-trip ────────────────────────────────────────

  test("append and readAll round-trip", async () => {
    const mgr = createManager()
    const sid = "round-trip"

    await mgr.append(sid, "first note", "observation")
    await mgr.append(sid, "second note", "decision")
    await mgr.append(sid, "third note")

    const all = await mgr.readAll(sid)
    expect(all.length).toBe(3)
    expect(stripTimestamps(all)).toEqual([
      { content: "first note", tag: "observation" },
      { content: "second note", tag: "decision" },
      { content: "third note", tag: "general" },
    ])

    for (const entry of all) {
      expect(typeof entry.timestamp).toBe("number")
      expect(entry.timestamp).toBeGreaterThan(0)
    }
  })

  // 2 ── entries preserve insertion order ───────────────────────────────────

  test("multiple entries preserve insertion order", async () => {
    const mgr = createManager()
    const sid = "ordering"

    for (let i = 0; i < 5; i++) {
      await mgr.append(sid, `note-${i}`, "general")
    }

    const all = await mgr.readAll(sid)
    expect(all.length).toBe(5)
    for (let i = 0; i < 5; i++) {
      expect(all[i]!.content).toBe(`note-${i}`)
    }
  })

  // 3 ── readByTag groups entries by tag ───────────────────────────────────

  test("readByTag groups entries by tag", async () => {
    const mgr = createManager()
    const sid = "grouping"

    const tags: NoteTag[] = ["discovery", "error", "decision", "observation", "general"]
    for (const tag of tags) {
      await mgr.append(sid, `content-for-${tag}`, tag)
      await mgr.append(sid, `second-${tag}`, tag)
    }

    const grouped = await mgr.readByTag(sid)
    expect(grouped.discovery.length).toBe(2)
    expect(grouped.error.length).toBe(2)
    expect(grouped.decision.length).toBe(2)
    expect(grouped.observation.length).toBe(2)
    expect(grouped.general.length).toBe(2)

    expect(grouped.discovery[0]!.content).toBe("content-for-discovery")
    expect(grouped.error[0]!.content).toBe("content-for-error")
  })

  // 4 ── readByTag returns empty arrays for tags with no entries ────────────

  test("readByTag returns empty arrays for unused tags", async () => {
    const mgr = createManager()
    const sid = "partial-tags"

    await mgr.append(sid, "only discovery", "discovery")

    const grouped = await mgr.readByTag(sid)
    expect(grouped.discovery.length).toBe(1)
    expect(grouped.error).toEqual([])
    expect(grouped.decision).toEqual([])
    expect(grouped.observation).toEqual([])
    expect(grouped.general).toEqual([])
  })

  // 5 ── clear empties the session file ────────────────────────────────────

  test("clear empties the session", async () => {
    const mgr = createManager()
    const sid = "clear-test"

    await mgr.append(sid, "note one", "general")
    await mgr.append(sid, "note two", "general")
    expect((await mgr.readAll(sid)).length).toBe(2)

    await mgr.clear(sid)
    expect((await mgr.readAll(sid)).length).toBe(0)
  })

  // 6 ── clear on non-existent session does not throw ──────────────────────

  test("clear on non-existent session does not throw", async () => {
    const mgr = createManager()
    const sid = "never-existed"

    await mgr.clear(sid)
    const all = await mgr.readAll(sid)
    expect(all).toEqual([])
  })

  // 7 ── shouldCompact detects file over maxSizeChars ──────────────────────

  test("shouldCompact detects when file exceeds maxSizeChars", async () => {
    // JSONL overhead is ~60 chars per entry, plus content length.
    // 1 entry with 5-char content ≈ 65 chars, 2 entries ≈ 130 chars.
    const mgr = createManager({ maxSizeChars: 100 })
    const sid = "compact-detect"

    await mgr.append(sid, "A", "general")
    expect(await mgr.shouldCompact(sid)).toBe(false)

    await mgr.append(sid, "B", "general")
    expect(await mgr.shouldCompact(sid)).toBe(true)
  })

  // 8 ── shouldCompact returns false for non-existent session ──────────────

  test("shouldCompact returns false for non-existent session", async () => {
    const mgr = createManager()
    expect(await mgr.shouldCompact("ghost-session")).toBe(false)
  })

  // 9 ── deleteSession removes the file ────────────────────────────────────

  test("deleteSession removes session data", async () => {
    const mgr = createManager()
    const sid = "delete-me"

    await mgr.append(sid, "some content", "general")
    expect((await mgr.readAll(sid)).length).toBe(1)

    await mgr.deleteSession(sid)
    expect((await mgr.readAll(sid)).length).toBe(0)
  })

  // 10 ── deleteSession on non-existent session does not throw ─────────────

  test("deleteSession on non-existent session does not throw", async () => {
    const mgr = createManager()
    const sid = "already-gone"

    await mgr.deleteSession(sid)
    // Should not throw — just a no-op
  })

  // 11 ── readAll returns empty array for never-written session ─────────────

  test("readAll returns empty array for never-written session", async () => {
    const mgr = createManager()
    const entries = await mgr.readAll("fresh-session")
    expect(entries).toEqual([])
  })

  // 12 ── default tag is "general" ─────────────────────────────────────────

  test("append defaults tag to general", async () => {
    const mgr = createManager()
    const sid = "default-tag"

    await mgr.append(sid, "no tag provided")
    const all = await mgr.readAll(sid)
    expect(all.length).toBe(1)
    expect(all[0]!.tag).toBe("general")
  })

  // 13 ── custom maxSizeChars is respected ──────────────────────────────────

  test("custom maxSizeChars is respected by shouldCompact", async () => {
    const smallMgr = createManager({ maxSizeChars: 10 })
    const largeMgr = createManager({ maxSizeChars: 10000 })
    const sid = "custom-max"

    await smallMgr.append(sid, "x".repeat(50), "general")
    expect(await smallMgr.shouldCompact(sid)).toBe(true)

    // Same content under larger limit should NOT trigger compact
    const sid2 = "custom-max-2"
    await largeMgr.append(sid2, "x".repeat(50), "general")
    expect(await largeMgr.shouldCompact(sid2)).toBe(false)
  })
})

describe("createNotesManager", () => {
  test("returns a NotesManager instance", () => {
    const { createNotesManager } = require("../src/index")
    const mgr = createNotesManager({ notesDir: testDir })
    expect(mgr).toBeInstanceOf(NotesManager)
  })
})

describe("in-memory fallback backend", () => {
  test("uses in-memory store when forced via env var", async () => {
    process.env.NOTES_MANAGER_BACKEND = "memory"
    try {
      const mgr = new NotesManager({ notesDir: "/tmp/notes-fallback" })
      const sid = "fb"

      await mgr.append(sid, "note-a", "discovery")
      await mgr.append(sid, "note-b")
      expect((await mgr.readAll(sid)).length).toBe(2)

      const grouped = await mgr.readByTag(sid)
      expect(grouped.discovery.length).toBe(1)
      expect(grouped.general.length).toBe(1)

      expect(await mgr.shouldCompact(sid)).toBe(false)
      await mgr.append(sid, "x".repeat(60000), "error")
      expect(await mgr.shouldCompact(sid)).toBe(true)

      await mgr.clear(sid)
      expect(await mgr.readAll(sid)).toEqual([])

      await mgr.append(sid, "again")
      await mgr.deleteSession(sid)
      expect(await mgr.readAll(sid)).toEqual([])
    } finally {
      delete process.env.NOTES_MANAGER_BACKEND
    }
  })
})
