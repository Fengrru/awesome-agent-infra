import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DEFAULT_CONFIG, type Discovery, ProjectMemoryManager } from "../src/index"

async function withTempFile(fn: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "project-memory-test-"))
  try {
    await fn(join(dir, "MEMORY.md"))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function makeEntry(content: string, overrides?: Record<string, unknown>) {
  return {
    section: "facts" as const,
    content,
    verification_count: 1,
    confidence: 1.0,
    source_sessions: ["s1"],
    user_authored: false,
    ...overrides,
  }
}

describe("configuration", () => {
  test("defaults are applied and overridable", () => {
    const mgr = new ProjectMemoryManager()
    expect(mgr.config.filePath).toBe(DEFAULT_CONFIG.filePath)
    expect(mgr.config.maxEntries).toBe(500)

    const custom = new ProjectMemoryManager({ maxEntries: 10 })
    expect(custom.config.maxEntries).toBe(10)
    expect(custom.config.filePath).toBe(DEFAULT_CONFIG.filePath)
  })
})

describe("load", () => {
  test("missing file yields empty entries without throwing", async () => {
    await withTempFile(async (filePath) => {
      const mgr = new ProjectMemoryManager({ filePath })
      expect(await mgr.load()).toEqual([])
    })
  })

  test("parses sections, ids, content and confidence markers", async () => {
    await withTempFile(async (filePath) => {
      const md = [
        "# Project Memory",
        "",
        "## User Rules",
        "",
        "- [rule-1] Always use tabs",
        "",
        "## Verified Facts",
        "",
        "- [fact-1] Build uses bun",
        "  [conf:0.80]",
        "- [fact-2] Tests use bun test",
        "",
      ].join("\n")
      await writeFile(filePath, md, "utf-8")

      const mgr = new ProjectMemoryManager({ filePath })
      const entries = await mgr.load()

      expect(entries.length).toBe(3)
      const rule = entries.find((e) => e.id === "rule-1")!
      expect(rule.section).toBe("rules")
      expect(rule.content).toBe("Always use tabs")

      const fact1 = entries.find((e) => e.id === "fact-1")!
      expect(fact1.section).toBe("facts")
      expect(fact1.confidence).toBe(0.8)

      const fact2 = entries.find((e) => e.id === "fact-2")!
      expect(fact2.confidence).toBe(1.0)
    })
  })
})

describe("CRUD round-trip", () => {
  test("upsert creates entry and persists to disk", async () => {
    await withTempFile(async (filePath) => {
      const mgr = new ProjectMemoryManager({ filePath })
      const entry = await mgr.upsertEntry(makeEntry("The API uses REST"))
      expect(entry.id).toStartWith("mem_")
      expect(entry.created_at).toBeTruthy()

      const raw = await readFile(filePath, "utf-8")
      expect(raw).toContain("## Verified Facts")
      expect(raw).toContain("The API uses REST")

      // Reload from disk in a fresh manager
      const mgr2 = new ProjectMemoryManager({ filePath })
      const reloaded = await mgr2.getAllEntries()
      expect(reloaded.length).toBe(1)
      expect(reloaded[0]!.content).toBe("The API uses REST")
    })
  })

  test("upsert with existing id updates and bumps verification_count", async () => {
    await withTempFile(async (filePath) => {
      const mgr = new ProjectMemoryManager({ filePath })
      const created = await mgr.upsertEntry(makeEntry("v1"))
      const updated = await mgr.upsertEntry({
        ...makeEntry("v2", { source_sessions: ["s2"] }),
        id: created.id,
      })
      expect(updated.id).toBe(created.id)
      expect(updated.content).toBe("v2")
      expect(updated.verification_count).toBe(2)
      expect(updated.source_sessions.sort()).toEqual(["s1", "s2"])
      expect((await mgr.getAllEntries()).length).toBe(1)
    })
  })

  test("getEntry / deleteEntry / getSection", async () => {
    await withTempFile(async (filePath) => {
      const mgr = new ProjectMemoryManager({ filePath })
      const fact = await mgr.upsertEntry(makeEntry("a fact"))
      await mgr.upsertEntry(makeEntry("a rule", { section: "rules" }))

      expect((await mgr.getEntry(fact.id))!.content).toBe("a fact")
      expect(await mgr.getEntry("ghost")).toBeUndefined()

      expect((await mgr.getSection("facts")).length).toBe(1)
      expect((await mgr.getSection("rules")).length).toBe(1)
      expect((await mgr.getSection("patterns")).length).toBe(0)

      expect(await mgr.deleteEntry(fact.id)).toBe(true)
      expect(await mgr.deleteEntry(fact.id)).toBe(false)
      expect((await mgr.getSection("facts")).length).toBe(0)
    })
  })
})

describe("promoteDiscovery", () => {
  const discovery: Discovery = {
    id: "d1",
    description: "the build pipeline caches turbo outputs aggressively",
    confidence: 0.7,
    applicable_to: ["build"],
  }

  test("creates a new facts entry for novel discovery", async () => {
    await withTempFile(async (filePath) => {
      const mgr = new ProjectMemoryManager({ filePath })
      const entry = await mgr.promoteDiscovery("s1", discovery, 3)
      expect(entry.section).toBe("facts")
      expect(entry.content).toBe(discovery.description)
      expect(entry.verification_count).toBe(3)
      expect(entry.source_sessions).toEqual(["s1"])
    })
  })

  test("dedups similar discovery and merges instead of duplicating", async () => {
    await withTempFile(async (filePath) => {
      const mgr = new ProjectMemoryManager({ filePath })
      await mgr.promoteDiscovery("s1", discovery, 3)
      const merged = await mgr.promoteDiscovery(
        "s2",
        {
          ...discovery,
          description: "the build pipeline caches turbo outputs aggressively today",
          confidence: 0.9,
        },
        3,
      )

      expect((await mgr.getSection("facts")).length).toBe(1)
      expect(merged.verification_count).toBe(4)
      expect(merged.confidence).toBe(0.9) // max of both
      expect(merged.source_sessions.sort()).toEqual(["s1", "s2"])
    })
  })
})

describe("search", () => {
  test("matches keywords and ranks full-phrase hits higher", async () => {
    await withTempFile(async (filePath) => {
      const mgr = new ProjectMemoryManager({ filePath })
      await mgr.upsertEntry(makeEntry("database connection pooling is enabled"))
      await mgr.upsertEntry(makeEntry("the database uses postgres"))
      await mgr.upsertEntry(makeEntry("frontend built with react"))

      const results = await mgr.search("database connection")
      expect(results.length).toBe(2)
      expect(results[0]!.content).toContain("connection pooling") // phrase match ranked first

      expect(await mgr.search("nonexistent-term")).toEqual([])
    })
  })

  test("respects maxResults", async () => {
    await withTempFile(async (filePath) => {
      const mgr = new ProjectMemoryManager({ filePath })
      for (let i = 0; i < 5; i++) await mgr.upsertEntry(makeEntry(`shared keyword item ${i}`))
      expect((await mgr.search("keyword", 3)).length).toBe(3)
    })
  })
})

describe("shouldDream / getEntryCount", () => {
  test("dream triggers only above maxEntries", async () => {
    await withTempFile(async (filePath) => {
      const mgr = new ProjectMemoryManager({ filePath, maxEntries: 2 })
      expect(await mgr.shouldDream()).toBe(false)
      await mgr.upsertEntry(makeEntry("one"))
      await mgr.upsertEntry(makeEntry("two"))
      expect(await mgr.shouldDream()).toBe(false)
      await mgr.upsertEntry(makeEntry("three"))
      expect(await mgr.shouldDream()).toBe(true)
      expect(await mgr.getEntryCount()).toBe(3)
    })
  })
})

describe("markdown rendering", () => {
  test("renders confidence marker only when below 1.0", async () => {
    await withTempFile(async (filePath) => {
      const mgr = new ProjectMemoryManager({ filePath })
      await mgr.upsertEntry(makeEntry("certain fact", { confidence: 1.0 }))
      await mgr.upsertEntry(makeEntry("uncertain fact", { confidence: 0.5 }))

      const raw = await readFile(filePath, "utf-8")
      expect(raw).toContain("[conf:0.50]")
      expect(raw.match(/\[conf:/g)!.length).toBe(1)
    })
  })

  test("empty sections are omitted from output", async () => {
    await withTempFile(async (filePath) => {
      const mgr = new ProjectMemoryManager({ filePath })
      await mgr.upsertEntry(makeEntry("only a fact"))
      const raw = await readFile(filePath, "utf-8")
      expect(raw).toContain("## Verified Facts")
      expect(raw).not.toContain("## User Rules")
      expect(raw).not.toContain("## Work Patterns")
    })
  })
})
