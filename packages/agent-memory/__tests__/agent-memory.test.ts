import { describe, expect, test } from "bun:test"
import { MemorySystem } from "../src/index"
import type { CoreRule, LongTermMemory, MemoryDatabase, WorkingMemory } from "../src/index"

function createMem(overrides?: Partial<LongTermMemory>): LongTermMemory {
  return {
    memory_id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    content: "function add(a: number, b: number): number { return a + b }",
    token_count: 12,
    importance: 0.5,
    access_count: 0,
    created_at: Date.now() - 86400000 * 2,
    last_accessed: Date.now(),
    retention_score: 0.5,
    ...overrides,
  }
}

describe("MemorySystem", () => {
  // ── Core Rules ──────────────────────────────────────────────────────────

  test("adds core rule", () => {
    const ms = new MemorySystem()
    const rule: CoreRule = {
      rule_id: "r1",
      category: "safety",
      content: "Never delete user files",
      token_count: 4,
      importance: 1.0,
    }
    ms.addCoreRule(rule)
    const ctx = ms.assembleContext("test")
    expect(ctx.l4.length).toBe(1)
    expect(ctx.l4[0]!.rule_id).toBe("r1")
  })

  test("updates existing core rule by id", () => {
    const ms = new MemorySystem()
    const rule: CoreRule = {
      rule_id: "r1",
      category: "safety",
      content: "Never delete user files",
      token_count: 4,
      importance: 1.0,
    }
    ms.addCoreRule(rule)
    ms.addCoreRule({ ...rule, content: "Updated content" })
    const ctx = ms.assembleContext("test")
    expect(ctx.l4.length).toBe(1)
    expect(ctx.l4[0]!.content).toBe("Updated content")
  })

  // ── Working Memory ──────────────────────────────────────────────────────

  test("adds working memory", () => {
    const ms = new MemorySystem()
    const wm: WorkingMemory = {
      id: "w1",
      content: "current task context",
      token_count: 3,
      priority: 0.8,
    }
    ms.addWorkingMemory(wm)
    const ctx = ms.assembleContext("task")
    expect(ctx.l2.length).toBeGreaterThan(0)
    expect(ctx.l2.some((w) => w.id === "w1")).toBe(true)
  })

  test("caps working memory at 20", () => {
    const ms = new MemorySystem()
    for (let i = 0; i < 25; i++) {
      ms.addWorkingMemory({ id: `w${i}`, content: "x", token_count: 1, priority: 0.5 })
    }
    expect(ms.getWorkingMemories().length).toBe(20)
  })

  // ── Long-Term Memory ────────────────────────────────────────────────────

  test("adds long-term memory", () => {
    const ms = new MemorySystem()
    const mem = createMem({ memory_id: "mem1" })
    ms.addLongTermMemory(mem)
    const ctx = ms.assembleContext("test goal")
    expect(ctx.l3.length).toBe(1)
    expect(ctx.l3[0]!.memory_id).toBe("mem1")
  })

  test("pre-computes importance and retention on add", () => {
    const ms = new MemorySystem()
    const mem = createMem({
      memory_id: "mem_importance",
      user_marked: true,
      importance: 0.5,
      retention_score: 0.3,
    })
    ms.addLongTermMemory(mem)
    const stored = ms.getLongTermMemories().find((m) => m.memory_id === "mem_importance")
    expect(stored).toBeDefined()
    expect(stored!.importance).toBe(0.5)
    expect(stored!.retention_score).toBe(0.3)
  })

  test("updates existing long-term memory", () => {
    const ms = new MemorySystem()
    const mem = createMem({ memory_id: "m1", content: "old" })
    ms.addLongTermMemory(mem)
    ms.addLongTermMemory({ ...mem, content: "new" })
    expect(ms.getLongTermMemories().length).toBe(1)
    expect(ms.getLongTermMemories()[0]!.content).toBe("new")
  })

  // ── Tag Search ──────────────────────────────────────────────────────────

  test("searches by tags", () => {
    const ms = new MemorySystem()
    ms.addLongTermMemory(createMem({ memory_id: "a", tags: ["typescript", "function"] }))
    ms.addLongTermMemory(createMem({ memory_id: "b", tags: ["python", "function"] }))
    ms.addLongTermMemory(createMem({ memory_id: "c", tags: ["typescript"] }))

    const results = ms.searchByTags(["typescript"])
    expect(results.length).toBe(2)
  })

  test("returns empty for no tags", () => {
    const ms = new MemorySystem()
    ms.addLongTermMemory(createMem({ memory_id: "a", tags: ["ts"] }))
    expect(ms.searchByTags([]).length).toBe(0)
  })

  // ── Mark Successful ─────────────────────────────────────────────────────

  test("markSuccessful boosts access count and importance", () => {
    const ms = new MemorySystem()
    const before = Date.now()
    const mem = createMem({ memory_id: "test_mark", importance: 0.3, access_count: 0, last_accessed: before })
    ms.addLongTermMemory(mem)
    const result = ms.markSuccessful("test_mark")
    expect(result).toBe(true)
    const updated = ms.getLongTermMemories().find((m) => m.memory_id === "test_mark")
    expect(updated!.access_count).toBeGreaterThan(0)
    expect(updated!.importance).toBeGreaterThan(0.3)
    expect(updated!.last_accessed).toBeGreaterThanOrEqual(before)
  })

  test("markSuccessful returns false for non-existent memory", () => {
    const ms = new MemorySystem()
    expect(ms.markSuccessful("nonexistent")).toBe(false)
  })

  // ── Transient Memory ────────────────────────────────────────────────────

  test("adds and clears transient memory", () => {
    const ms = new MemorySystem()
    ms.addTransient("recent thought", 2)
    ms.addTransient("another thought", 2)
    expect(ms.getTransientMemories().length).toBe(2)
    ms.clearTransient()
    expect(ms.getTransientMemories().length).toBe(0)
  })

  test("caps transient memory at 10", () => {
    const ms = new MemorySystem()
    for (let i = 0; i < 15; i++) {
      ms.addTransient(`thought ${i}`, 1)
    }
    expect(ms.getTransientMemories().length).toBe(10)
  })

  // ── Scoring ─────────────────────────────────────────────────────────────

  test("calculateImportance - user_marked gives higher score", () => {
    const ms = new MemorySystem()
    const mem = createMem({ user_marked: true })
    const mem2 = createMem({ user_marked: false })
    expect(ms.calculateImportance(mem)).toBeGreaterThan(ms.calculateImportance(mem2))
  })

  test("calculateRetention decays over time", () => {
    const ms = new MemorySystem()
    const recent = createMem({ created_at: Date.now() })
    const old = createMem({ created_at: Date.now() - 86400000 * 30 })
    expect(ms.calculateRetention(recent)).toBeGreaterThan(ms.calculateRetention(old))
  })

  test("calculateRetention has minimum floor", () => {
    const ms = new MemorySystem()
    const ancient = createMem({
      created_at: Date.now() - 86400000 * 365 * 10,
      importance: 0,
    })
    expect(ms.calculateRetention(ancient)).toBeGreaterThanOrEqual(0.05)
  })

  // ── Composite Retrieval ─────────────────────────────────────────────────

  test("compositeRetrievalScore returns score between 0-1", () => {
    const ms = new MemorySystem()
    const mem = createMem({ vector: [0.5, 0.3, 0.2] })
    const score = ms.compositeRetrievalScore(mem, [0.5, 0.3, 0.2], "test goal")
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(1)
  })

  test("compositeRetrievalScore falls back to Jaccard when no vector", () => {
    const ms = new MemorySystem()
    const mem = createMem({ vector: undefined, content: "process user input" })
    const score = ms.compositeRetrievalScore(mem, null, "user input processing")
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(1)
  })

  // ── Context Assembly ────────────────────────────────────────────────────

  test("assembleContext respects token budget", () => {
    const ms = new MemorySystem()
    ms.setMaxTokens(500)
    ms.addCoreRule({
      rule_id: "r1",
      category: "safety",
      content: "Always validate input",
      token_count: 3,
      importance: 1.0,
    })
    ms.addLongTermMemory(
      createMem({
        memory_id: "large_mem",
        content: "a".repeat(10000),
        token_count: 10000,
      }),
    )
    const ctx = ms.assembleContext("test")
    expect(ctx.totalTokens).toBeLessThan(600)
  })

  test("assembleContext caches results with same goal and vector", () => {
    const ms = new MemorySystem()
    ms.addLongTermMemory(createMem({ memory_id: "c1" }))
    const ctx1 = ms.assembleContext("goal1", [0.1, 0.2])
    const ctx2 = ms.assembleContext("goal1", [0.1, 0.2])
    expect(ctx1.totalTokens).toBe(ctx2.totalTokens)
  })

  test("assembleContext invalidates cache on memory change", () => {
    const ms = new MemorySystem()
    ms.addLongTermMemory(createMem({ memory_id: "c2", token_count: 5 }))
    const ctx1 = ms.assembleContext("goal")
    ms.addLongTermMemory(createMem({ memory_id: "c3", token_count: 5 }))
    const ctx2 = ms.assembleContext("goal")
    expect(ctx1.l3.length).not.toBe(ctx2.l3.length)
  })

  test("assembleContext - different vectors invalidate cache", () => {
    const ms = new MemorySystem()
    ms.addLongTermMemory(createMem({ memory_id: "v1", vector: [1.0, 0.0], content: "task A" }))
    ms.addLongTermMemory(createMem({ memory_id: "v2", vector: [0.0, 1.0], content: "task B" }))
    const ctx1 = ms.assembleContext("goal", [1.0, 0.0])
    const ctx2 = ms.assembleContext("goal", [0.0, 1.0])
    expect(ctx1.l3).not.toEqual(ctx2.l3)
  })

  // ── Serialization ───────────────────────────────────────────────────────

  test("serializes and deserializes state", () => {
    const ms = new MemorySystem()
    ms.addCoreRule({
      rule_id: "r1",
      category: "safety",
      content: "rule1",
      token_count: 2,
      importance: 1.0,
    })
    ms.addWorkingMemory({ id: "w1", content: "work1", token_count: 2, priority: 0.5 })
    ms.addLongTermMemory(createMem({ memory_id: "ser1", content: "long1" }))

    const json = ms.toJSON()
    const ms2 = new MemorySystem()
    ms2.fromJSON(json as Parameters<typeof ms2.fromJSON>[0])

    expect(ms2.getCoreRules().length).toBe(1)
    expect(ms2.getWorkingMemories().length).toBe(1)
    expect(ms2.getLongTermMemories().length).toBe(1)
  })

  // ── Max Tokens ──────────────────────────────────────────────────────────

  test("setMaxTokens updates the limit", () => {
    const ms = new MemorySystem()
    ms.setMaxTokens(2000)
    expect(ms.getMaxTokens()).toBe(2000)
  })

  // ── L3 Eviction ─────────────────────────────────────────────────────────

  test("evicts low-retention memories when over capacity", () => {
    const ms = new MemorySystem()
    for (let i = 0; i < 1100; i++) {
      ms.addLongTermMemory(
        createMem({
          memory_id: `mem_evict_${i}`,
          retention_score: Math.random(),
          token_count: 1,
        }),
      )
    }
    expect(ms.getLongTermMemories().length).toBeLessThanOrEqual(700)
  })

  test("preserves user_marked memories during eviction", () => {
    const ms = new MemorySystem()
    for (let i = 0; i < 1050; i++) {
      ms.addLongTermMemory(
        createMem({
          memory_id: `mem_evict2_${i}`,
          retention_score: Math.random(),
          token_count: 1,
          user_marked: false,
        }),
      )
    }
    const important: LongTermMemory = createMem({
      memory_id: "important_mem",
      retention_score: 0.001,
      token_count: 1,
      user_marked: true,
    })
    ms.addLongTermMemory(important)
    // The important memory should still be present even with low retention
    const found = ms.getLongTermMemories().find((m) => m.memory_id === "important_mem")
    expect(found).toBeDefined()
  })

  // ── Database Integration ────────────────────────────────────────────────

  test("setDatabase loads core rules and long-term memories", () => {
    const ms = new MemorySystem()
    const db: MemoryDatabase = {
      insertMemory: () => {},
      getMemories: () => [createMem({ memory_id: "db_mem1", content: "from db" })],
      searchByTags: () => [],
      markSuccessful: () => {},
      getAgentSelfRules: () => [
        { rule_id: "db_r1", category: "safety", content: "db rule", token_count: 2, importance: 1.0 },
      ],
      upsertAgentSelfRule: () => {},
      getUserProfiles: () => [],
      upsertUserProfile: () => {},
    }
    ms.setDatabase(db)
    expect(ms.getLongTermMemories().length).toBe(1)
    expect(ms.getCoreRules().length).toBe(1)
  })

  // ── Edge Cases ──────────────────────────────────────────────────────────

  test("assembleContext works with empty memory system", () => {
    const ms = new MemorySystem()
    const ctx = ms.assembleContext("empty")
    expect(ctx.l4.length).toBe(0)
    expect(ctx.l2.length).toBe(0)
    expect(ctx.l3.length).toBe(0)
    expect(ctx.l1.length).toBe(0)
  })
})
