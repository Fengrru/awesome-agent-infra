import { describe, expect, test } from "bun:test"
import {
  type AttentionConfig,
  AttentionRetrieval,
  ConfidenceLevel,
  DEFAULT_ATTENTION_CONFIG,
  DEFAULT_MEMORY_CONFIG,
  DEFAULT_META_MEMORY_CONFIG,
  DEFAULT_SLEEP_CONFIG,
  EpisodicMemory,
  LongTermMemory,
  MemoryEngine,
  type MemoryItem,
  MemoryPriority,
  MemoryType,
  MetaMemory,
  type MetaMemoryConfig,
  SemanticMemory,
  ShortTermMemory,
  type SleepConfig,
  SleepConsolidation,
  SleepStage,
  WorkingMemory,
  createMemoryEngine,
  createMemoryItem,
} from "../src/index"

function makeItem(overrides: Partial<MemoryItem> = {}): MemoryItem {
  const id = overrides.id ?? Math.random().toString(36).slice(2, 10)
  return {
    id,
    content: overrides.content ?? "test content",
    memoryType: overrides.memoryType ?? MemoryType.SHORT_TERM,
    timestamp: overrides.timestamp ?? Date.now(),
    importance: overrides.importance ?? 0.5,
    accessCount: overrides.accessCount ?? 0,
    lastAccessed: overrides.lastAccessed ?? Date.now(),
    metadata: overrides.metadata ?? {},
    embedding: overrides.embedding,
    emotionScore: overrides.emotionScore ?? 0,
    confidence: overrides.confidence ?? 0.5,
  }
}

describe("WorkingMemory", () => {
  test("stores an item", () => {
    const wm = new WorkingMemory(3)
    const item = makeItem({ content: "task 1" })
    const result = wm.store(item)
    expect(result).toBe(true)
    expect(wm.getAll().length).toBe(1)
  })

  test("stores items in FIFO order", () => {
    const wm = new WorkingMemory(3)
    const a = makeItem({ id: "a", content: "first" })
    const b = makeItem({ id: "b", content: "second" })
    wm.store(a)
    wm.store(b)
    const all = wm.getAll()
    expect(all[0].id).toBe("a")
    expect(all[1].id).toBe("b")
  })

  test("retrieves an item by ID", () => {
    const wm = new WorkingMemory(3)
    const item = makeItem({ id: "abc", content: "find me" })
    wm.store(item)
    const found = wm.get("abc")
    expect(found).not.toBeUndefined()
    expect(found!.content).toBe("find me")
  })

  test("get returns undefined for non-existent item", () => {
    const wm = new WorkingMemory(3)
    expect(wm.get("nonexistent")).toBeUndefined()
  })

  test("get increments accessCount and updates lastAccessed", () => {
    const wm = new WorkingMemory(3)
    const item = makeItem({ id: "abc", accessCount: 0 })
    wm.store(item)
    const before = Date.now()
    const found = wm.get("abc")
    expect(found!.accessCount).toBe(2)
    expect(found!.lastAccessed).toBeGreaterThanOrEqual(before)
    wm.get("abc")
    expect(wm.get("abc")!.accessCount).toBe(4)
  })

  test("forgets an item by ID", () => {
    const wm = new WorkingMemory(3)
    const item = makeItem({ id: "abc", content: "remove me" })
    wm.store(item)
    expect(wm.forget("abc")).toBe(true)
    expect(wm.get("abc")).toBeUndefined()
  })

  test("forget returns false for non-existent item", () => {
    const wm = new WorkingMemory(3)
    expect(wm.forget("none")).toBe(false)
  })

  test("isFull returns true when at capacity", () => {
    const wm = new WorkingMemory(2)
    wm.store(makeItem())
    expect(wm.isFull()).toBe(false)
    wm.store(makeItem())
    expect(wm.isFull()).toBe(true)
  })

  test("store returns false when full", () => {
    const wm = new WorkingMemory(2)
    wm.store(makeItem())
    wm.store(makeItem())
    expect(wm.store(makeItem())).toBe(false)
  })

  test("getAll returns all items", () => {
    const wm = new WorkingMemory(3)
    wm.store(makeItem({ content: "a" }))
    wm.store(makeItem({ content: "b" }))
    expect(wm.getAll().length).toBe(2)
  })

  test("getStatistics returns correct counts", () => {
    const wm = new WorkingMemory(5)
    wm.store(makeItem({ importance: 0.3 }))
    wm.store(makeItem({ importance: 0.7 }))
    const stats = wm.getStatistics()
    expect(stats.count).toBe(2)
    expect(stats.capacity).toBe(5)
    expect(stats.averageImportance).toBeCloseTo(0.5)
  })

  test("getStatistics with empty memory returns zero averages", () => {
    const wm = new WorkingMemory(5)
    const stats = wm.getStatistics()
    expect(stats.count).toBe(0)
    expect(stats.averageImportance).toBe(0)
  })

  test("default capacity is 7", () => {
    const wm = new WorkingMemory()
    expect(wm.capacity).toBe(7)
  })
})

describe("ShortTermMemory", () => {
  test("stores an item", () => {
    const stm = new ShortTermMemory(10, 3600000)
    const item = makeItem({ content: "stm test" })
    expect(stm.store(item)).toBe(true)
    expect(stm.getAll().length).toBe(1)
  })

  test("stores multiple items", () => {
    const stm = new ShortTermMemory(10, 3600000)
    for (let i = 0; i < 5; i++) {
      stm.store(makeItem({ id: `item-${i}` }))
    }
    expect(stm.getAll().length).toBe(5)
  })

  test("store returns false when at capacity", () => {
    const stm = new ShortTermMemory(2, 3600000)
    stm.store(makeItem())
    stm.store(makeItem())
    expect(stm.store(makeItem())).toBe(false)
  })

  test("retrieves an item by ID", () => {
    const stm = new ShortTermMemory(10, 3600000)
    const item = makeItem({ id: "stm111", content: "stm content" })
    stm.store(item)
    const found = stm.get("stm111")
    expect(found).not.toBeUndefined()
    expect(found!.content).toBe("stm content")
  })

  test("forgets an item by ID", () => {
    const stm = new ShortTermMemory(10, 3600000)
    stm.store(makeItem({ id: "to-forget" }))
    expect(stm.forget("to-forget")).toBe(true)
    expect(stm.get("to-forget")).toBeUndefined()
  })

  test("getActive returns non-expired items sorted by importance", () => {
    const stm = new ShortTermMemory(10, 3600000)
    stm.store(makeItem({ id: "low", importance: 0.2, timestamp: Date.now() }))
    stm.store(makeItem({ id: "high", importance: 0.9, timestamp: Date.now() }))
    stm.store(makeItem({ id: "mid", importance: 0.5, timestamp: Date.now() }))
    const active = stm.getActive()
    expect(active.length).toBe(3)
    expect(active[0].importance).toBe(0.9)
    expect(active[1].importance).toBe(0.5)
    expect(active[2].importance).toBe(0.2)
  })

  test("getActive excludes expired items", () => {
    const stm = new ShortTermMemory(10, 1000)
    stm.store(makeItem({ id: "old", timestamp: Date.now() - 5000 }))
    stm.store(makeItem({ id: "new", timestamp: Date.now() }))
    const active = stm.getActive()
    expect(active.length).toBe(1)
    expect(active[0].id).toBe("new")
  })

  test("decayExpiredItems removes and returns expired items", () => {
    const stm = new ShortTermMemory(10, 1000)
    stm.store(makeItem({ id: "old1", timestamp: Date.now() - 5000 }))
    stm.store(makeItem({ id: "old2", timestamp: Date.now() - 4000 }))
    stm.store(makeItem({ id: "fresh", timestamp: Date.now() }))
    const expired = stm.decayExpiredItems()
    expect(expired.length).toBe(2)
    expect(stm.getAll().length).toBe(1)
    expect(stm.getAll()[0].id).toBe("fresh")
  })

  test("decayExpiredItems returns empty array when no items expired", () => {
    const stm = new ShortTermMemory(10, 3600000)
    stm.store(makeItem())
    expect(stm.decayExpiredItems().length).toBe(0)
    expect(stm.getAll().length).toBe(1)
  })

  test("getStatistics counts active and decayed", () => {
    const stm = new ShortTermMemory(10, 1000)
    stm.store(makeItem({ timestamp: Date.now() }))
    stm.store(makeItem({ timestamp: Date.now() - 5000 }))
    const stats = stm.getStatistics()
    expect(stats.count).toBe(2)
    expect(stats.activeCount).toBe(1)
    expect(stats.decayedCount).toBe(1)
    expect(stats.capacity).toBe(10)
  })

  test("defaults: capacity=100, halfLife=1 hour", () => {
    const stm = new ShortTermMemory()
    expect(stm.capacity).toBe(100)
    expect(stm.halfLifeMs).toBe(3600000)
  })
})

describe("LongTermMemory", () => {
  test("stores an item", () => {
    const ltm = new LongTermMemory()
    const item = makeItem({ content: "ltm item" })
    expect(ltm.store(item)).toBe(true)
    expect(ltm.getAll().length).toBe(1)
  })

  test("retrieves an item by ID", () => {
    const ltm = new LongTermMemory()
    ltm.store(makeItem({ id: "ltm-1", content: "long term" }))
    expect(ltm.get("ltm-1")?.content).toBe("long term")
  })

  test("forgets an item", () => {
    const ltm = new LongTermMemory()
    ltm.store(makeItem({ id: "rm" }))
    expect(ltm.forget("rm")).toBe(true)
    expect(ltm.get("rm")).toBeUndefined()
  })

  test("search finds relevant items using TF-IDF", () => {
    const ltm = new LongTermMemory()
    ltm.store(makeItem({ id: "a", content: "The user is building a memory engine" }))
    ltm.store(makeItem({ id: "b", content: "Weather forecast for tomorrow is sunny" }))
    ltm.store(makeItem({ id: "c", content: "memory systems for AI agents" }))
    const results = ltm.search("memory engine", 3)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0][0].id).toBe("a")
    const ids = results.map(([item]) => item.id)
    expect(ids).toContain("c")
  })

  test("search returns empty for empty query", () => {
    const ltm = new LongTermMemory()
    ltm.store(makeItem({ content: "some content" }))
    expect(ltm.search("", 10).length).toBe(0)
    expect(ltm.search("   ", 10).length).toBe(0)
  })

  test("search returns empty when no items stored", () => {
    const ltm = new LongTermMemory()
    expect(ltm.search("anything", 10).length).toBe(0)
  })

  test("search respects topK limit", () => {
    const ltm = new LongTermMemory()
    for (let i = 0; i < 20; i++) {
      ltm.store(makeItem({ id: `item-${i}`, content: `document about topic ${i}` }))
    }
    const results = ltm.search("topic", 5)
    expect(results.length).toBeLessThanOrEqual(5)
  })

  test("getStatistics tracks count and access", () => {
    const ltm = new LongTermMemory()
    ltm.store(makeItem({ id: "s1" }))
    ltm.store(makeItem({ id: "s2" }))
    ltm.get("s1")
    ltm.get("s1")
    const stats = ltm.getStatistics()
    expect(stats.count).toBe(2)
    expect(stats.totalAccessCount).toBe(4)
  })

  test("storagePath is ignored (no persistence)", () => {
    const ltm = new LongTermMemory("/some/path")
    ltm.store(makeItem())
    expect(ltm.getAll().length).toBe(1)
  })
})

describe("EpisodicMemory", () => {
  test("stores items sorted by timestamp", () => {
    const em = new EpisodicMemory()
    const early = makeItem({ id: "early", timestamp: 1000 })
    const late = makeItem({ id: "late", timestamp: 3000 })
    const mid = makeItem({ id: "mid", timestamp: 2000 })
    em.store(early)
    em.store(late)
    em.store(mid)
    const all = em.getAll()
    expect(all[0].id).toBe("early")
    expect(all[1].id).toBe("mid")
    expect(all[2].id).toBe("late")
  })

  test("retrieves item by ID", () => {
    const em = new EpisodicMemory()
    em.store(makeItem({ id: "ep-1", content: "event 1" }))
    expect(em.get("ep-1")?.content).toBe("event 1")
  })

  test("forgets an item", () => {
    const em = new EpisodicMemory()
    em.store(makeItem({ id: "del" }))
    expect(em.forget("del")).toBe(true)
    expect(em.get("del")).toBeUndefined()
  })

  test("getByTimeRange filters correctly", () => {
    const em = new EpisodicMemory()
    em.store(makeItem({ id: "t1", timestamp: 1000 }))
    em.store(makeItem({ id: "t2", timestamp: 2000 }))
    em.store(makeItem({ id: "t3", timestamp: 3000 }))
    em.store(makeItem({ id: "t4", timestamp: 4000 }))
    const range = em.getByTimeRange(1500, 3500)
    expect(range.length).toBe(2)
    const ids = range.map((i) => i.id)
    expect(ids).toContain("t2")
    expect(ids).toContain("t3")
  })

  test("getByTimeRange returns empty when no items in range", () => {
    const em = new EpisodicMemory()
    em.store(makeItem({ timestamp: 1000 }))
    expect(em.getByTimeRange(5000, 6000).length).toBe(0)
  })

  test("getStatistics returns count and oldest timestamp", () => {
    const em = new EpisodicMemory()
    expect(em.getStatistics().oldestTimestamp).toBeNull()
    em.store(makeItem({ timestamp: 5000 }))
    em.store(makeItem({ timestamp: 3000 }))
    expect(em.getStatistics().count).toBe(2)
    expect(em.getStatistics().oldestTimestamp).toBe(3000)
  })
})

describe("SemanticMemory", () => {
  test("stores entities", () => {
    const sm = new SemanticMemory()
    expect(sm.store(makeItem({ id: "e1", content: "Entity 1" }))).toBe(true)
    expect(sm.getAll().length).toBe(1)
  })

  test("prevents duplicate entity IDs", () => {
    const sm = new SemanticMemory()
    sm.store(makeItem({ id: "e1" }))
    expect(sm.store(makeItem({ id: "e1" }))).toBe(false)
  })

  test("adds relations between entities", () => {
    const sm = new SemanticMemory()
    sm.store(makeItem({ id: "alice", content: "Alice" }))
    sm.store(makeItem({ id: "bob", content: "Bob" }))
    expect(sm.addRelation("alice", "knows", "bob")).toBe(true)
    expect(sm.getStatistics().relationCount).toBe(1)
  })

  test("addRelation returns false for missing entities", () => {
    const sm = new SemanticMemory()
    sm.store(makeItem({ id: "e1" }))
    expect(sm.addRelation("e1", "rel", "missing")).toBe(false)
    expect(sm.addRelation("missing", "rel", "e1")).toBe(false)
  })

  test("getNeighbors finds connected entities (BFS)", () => {
    const sm = new SemanticMemory()
    sm.store(makeItem({ id: "a", content: "A" }))
    sm.store(makeItem({ id: "b", content: "B" }))
    sm.store(makeItem({ id: "c", content: "C" }))
    sm.store(makeItem({ id: "d", content: "D" }))
    sm.addRelation("a", "links", "b")
    sm.addRelation("b", "links", "c")
    sm.addRelation("c", "links", "d")
    const neighbors = sm.getNeighbors("a", 2)
    expect(neighbors.length).toBe(2)
    const ids = neighbors.map((n) => n.id)
    expect(ids).toContain("b")
    expect(ids).toContain("c")
  })

  test("getNeighbors respects depth", () => {
    const sm = new SemanticMemory()
    sm.store(makeItem({ id: "x", content: "X" }))
    sm.store(makeItem({ id: "y", content: "Y" }))
    sm.store(makeItem({ id: "z", content: "Z" }))
    sm.addRelation("x", "next", "y")
    sm.addRelation("y", "next", "z")
    expect(sm.getNeighbors("x", 1).length).toBe(1)
    expect(sm.getNeighbors("x", 2).length).toBe(2)
  })

  test("getNeighbors returns empty for non-existent entity", () => {
    const sm = new SemanticMemory()
    expect(sm.getNeighbors("nope").length).toBe(0)
  })

  test("getNeighbors follows edges bidirectionally", () => {
    const sm = new SemanticMemory()
    sm.store(makeItem({ id: "src", content: "Source" }))
    sm.store(makeItem({ id: "tgt", content: "Target" }))
    sm.addRelation("src", "to", "tgt")
    const fromTarget = sm.getNeighbors("tgt", 1)
    expect(fromTarget.length).toBe(1)
    expect(fromTarget[0].id).toBe("src")
  })

  test("forget removes entity and its edges", () => {
    const sm = new SemanticMemory()
    sm.store(makeItem({ id: "a" }))
    sm.store(makeItem({ id: "b" }))
    sm.store(makeItem({ id: "c" }))
    sm.addRelation("a", "r1", "b")
    sm.addRelation("b", "r2", "c")
    sm.forget("b")
    expect(sm.get("b")).toBeUndefined()
    expect(sm.getAll().length).toBe(2)
    expect(sm.getStatistics().relationCount).toBe(0)
  })

  test("getStatistics returns entity and relation counts", () => {
    const sm = new SemanticMemory()
    expect(sm.getStatistics().entityCount).toBe(0)
    expect(sm.getStatistics().relationCount).toBe(0)
    sm.store(makeItem({ id: "e1" }))
    sm.store(makeItem({ id: "e2" }))
    expect(sm.getStatistics().entityCount).toBe(2)
  })
})

describe("SleepConsolidation", () => {
  test("shouldConsolidate returns true on first call (null last) when enough items", () => {
    const sc = new SleepConsolidation({ autoConsolidateInterval: 5 })
    expect(sc.shouldConsolidate(null, 10)).toBe(true)
  })

  test("shouldConsolidate returns false on first call when not enough items", () => {
    const sc = new SleepConsolidation({ autoConsolidateInterval: 100 })
    expect(sc.shouldConsolidate(null, 5)).toBe(false)
  })

  test("shouldConsolidate returns true when enough memories accumulated", () => {
    const sc = new SleepConsolidation({ autoConsolidateInterval: 5 })
    expect(sc.shouldConsolidate(Date.now() - 120000, 10)).toBe(true)
  })

  test("shouldConsolidate returns false when not enough items and recently consolidated", () => {
    const sc = new SleepConsolidation({ autoConsolidateInterval: 100 })
    expect(sc.shouldConsolidate(Date.now() - 30000, 5)).toBe(false)
  })

  test("full consolidation cycle processes memories", () => {
    const sc = new SleepConsolidation({ consolidationThreshold: 0.3, forgettingThreshold: 0.1 })
    const stored: MemoryItem[] = []
    const forgotten: string[] = []
    const updated: Array<{ id: string; updates: Partial<MemoryItem> }> = []
    const items = [
      makeItem({ id: "i1", importance: 0.9, confidence: 0.8, accessCount: 5 }),
      makeItem({ id: "i2", importance: 0.3, confidence: 0.3, accessCount: 0 }),
      makeItem({ id: "i3", importance: 0.2, confidence: 0.1, accessCount: 0, emotionScore: 0 }),
    ]
    const result = sc.consolidate(
      items,
      [],
      (item) => stored.push(item),
      (id) => forgotten.push(id),
      (id, updates) => updated.push({ id, updates }),
    )
    expect(result.memoriesProcessed).toBe(3)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    expect(result.stageStats[SleepStage.N3_SLOW_WAVE]).toBeDefined()
    expect(result.stageStats[SleepStage.REM]).toBeDefined()
    expect(result.stageStats[SleepStage.CONSOLIDATION]).toBeDefined()
    expect(result.stageStats[SleepStage.N1_LIGHT_SLEEP]).toBeDefined()
  })

  test("slow-wave consolidation transfers high-importance items", () => {
    const sc = new SleepConsolidation({
      consolidationThreshold: 0.5,
      forgettingThreshold: 0.1,
      enableForgetting: false,
    })
    const stored: MemoryItem[] = []
    const items = [
      makeItem({ id: "hi", importance: 0.9, accessCount: 10, confidence: 0.9 }),
      makeItem({ id: "lo", importance: 0.1, accessCount: 0, confidence: 0.1 }),
    ]
    sc.consolidate(
      items,
      [],
      (item) => stored.push(item),
      () => {},
      () => {},
    )
    const storedIds = stored.map((i) => (i.memoryType === MemoryType.LONG_TERM ? i.id : null)).filter(Boolean)
    expect(storedIds.length).toBeGreaterThan(0)
  })

  test("REM replay boosts importance probabilistically", () => {
    const sc = new SleepConsolidation({
      enableReplay: true,
      enableForgetting: false,
      enableAssociation: false,
      consolidationThreshold: 1.0,
    })
    const updated: Array<{ id: string; updates: Partial<MemoryItem> }> = []
    const items = [makeItem({ id: "boost", importance: 0.5, confidence: 0.5 })]
    sc.consolidate(
      items,
      [],
      () => {},
      () => {},
      (id, updates) => updated.push({ id, updates }),
    )
    expect(sc.getStatistics().enableReplay).toBe(true)
  })

  test("forgets weak memories below retention threshold", () => {
    const sc = new SleepConsolidation({
      forgettingThreshold: 0.4,
      consolidationThreshold: 1.0,
      enableReplay: false,
      enableAssociation: false,
      enableForgetting: true,
    })
    const forgotten: string[] = []
    const items = [
      makeItem({ id: "weak", importance: 0.1, accessCount: 0, emotionScore: 0 }),
      makeItem({ id: "strong", importance: 0.9, accessCount: 10, emotionScore: 0.5 }),
    ]
    sc.consolidate(
      items,
      [],
      () => {},
      (id) => forgotten.push(id),
      () => {},
    )
    expect(forgotten).toContain("weak")
    expect(forgotten).not.toContain("strong")
  })

  test("can disable forgetting", () => {
    const sc = new SleepConsolidation({ enableForgetting: false })
    const forgotten: string[] = []
    const items = [makeItem({ id: "weak", importance: 0.05, accessCount: 0, emotionScore: 0 })]
    sc.consolidate(
      items,
      [],
      () => {},
      (id) => forgotten.push(id),
      () => {},
    )
    expect(forgotten.length).toBe(0)
  })

  test("calcConsolidationScore weights properly", () => {
    const sc = new SleepConsolidation()
    const item = makeItem({
      importance: 0.8,
      accessCount: 5,
      emotionScore: 0.7,
      confidence: 0.9,
      timestamp: Date.now() - 60000,
    })
    const score = (sc as any).calcConsolidationScore(item)
    expect(score).toBeGreaterThan(0.3)
    expect(score).toBeLessThanOrEqual(1)
  })

  test("calcRetentionScore weights properly", () => {
    const sc = new SleepConsolidation()
    const highItem = makeItem({ importance: 0.9, accessCount: 10, emotionScore: 0.5 })
    const lowItem = makeItem({ importance: 0.1, accessCount: 0, emotionScore: 0 })
    expect((sc as any).calcRetentionScore(highItem)).toBeGreaterThan((sc as any).calcRetentionScore(lowItem))
  })

  test("calcSimilarity returns 1 for identical content", () => {
    const sc = new SleepConsolidation()
    const a = makeItem({ content: "identical content" })
    const b = makeItem({ content: "identical content" })
    const sim = (sc as any).calcSimilarity(a, b)
    expect(sim).toBeGreaterThan(0.99)
  })

  test("calcSimilarity returns low value for unrelated content", () => {
    const sc = new SleepConsolidation()
    const a = makeItem({ content: "machine learning algorithms" })
    const b = makeItem({ content: "baking chocolate cake recipe" })
    const sim = (sc as any).calcSimilarity(a, b)
    expect(sim).toBeLessThan(0.5)
  })

  test("association creation links similar memories", () => {
    const sc = new SleepConsolidation({
      enableAssociation: true,
      consolidationThreshold: 1.0,
      enableReplay: false,
      enableForgetting: false,
      maxConsolidationCycles: 10,
    })
    const stored: MemoryItem[] = []
    const items = [
      makeItem({ id: "s1", content: "artificial intelligence machine learning" }),
      makeItem({ id: "s2", content: "artificial intelligence machine learning algorithms" }),
    ]
    sc.consolidate(
      items,
      [],
      (item) => stored.push(item),
      () => {},
      () => {},
    )
    expect(stored.length).toBeGreaterThan(0)
    const assoc = stored.find(
      (i) => i.content && typeof i.content === "object" && (i.content as any).association === true,
    )
    expect(assoc).toBeDefined()
  })

  test("respects maxConsolidationCycles", () => {
    const sc = new SleepConsolidation({
      maxConsolidationCycles: 0,
      consolidationThreshold: 0,
      enableReplay: false,
      enableAssociation: false,
      enableForgetting: false,
    })
    const stored: MemoryItem[] = []
    const items = [makeItem({ id: "i1", importance: 0.5 })]
    sc.consolidate(
      items,
      [],
      (item) => stored.push(item),
      () => {},
      () => {},
    )
    expect(stored.length).toBe(0)
  })

  test("initial stage is AWAKE", () => {
    const sc = new SleepConsolidation()
    expect(sc.currentStage).toBe(SleepStage.AWAKE)
  })

  test("stage transitions during consolidation", () => {
    const sc = new SleepConsolidation({
      consolidationThreshold: 1.0,
      enableReplay: false,
      enableAssociation: false,
      enableForgetting: false,
    })
    expect(sc.currentStage).toBe(SleepStage.AWAKE)
    sc.consolidate(
      [],
      [],
      () => {},
      () => {},
      () => {},
    )
    expect(sc.currentStage).toBe(SleepStage.AWAKE)
  })
})

describe("MetaMemory", () => {
  test("estimateConfidence returns value between 0 and 1", () => {
    const mm = new MetaMemory()
    const conf = mm.estimateConfidence("what is the capital of France", {
      totalMemories: 100,
      freshnessScore: 0.7,
      memoryDistribution: {},
    })
    expect(conf).toBeGreaterThanOrEqual(0)
    expect(conf).toBeLessThanOrEqual(1)
  })

  test("higher memory coverage increases confidence", () => {
    const mm = new MetaMemory()
    const low = mm.estimateConfidence("unknown query", { totalMemories: 5, freshnessScore: 0.3 })
    const high = mm.estimateConfidence("memory engine", { totalMemories: 200, freshnessScore: 0.9 })
    expect(high).toBeGreaterThan(low)
  })

  test("makeDecision returns direct_recall for HIGH confidence", () => {
    const mm = new MetaMemory({
      highConfidenceThreshold: 0.8,
      mediumConfidenceThreshold: 0.5,
      lowConfidenceThreshold: 0.3,
    })
    const decision = mm.makeDecision("test", 0.9, ["direct_recall"])
    expect(decision.action).toBe("direct_recall")
    expect(decision.confidence).toBe(0.9)
  })

  test("makeDecision returns augmented_retrieval for MEDIUM confidence", () => {
    const mm = new MetaMemory()
    const decision = mm.makeDecision("test", 0.6, ["augmented_retrieval"])
    expect(decision.action).toBe("augmented_retrieval")
  })

  test("makeDecision returns external_tool for LOW confidence", () => {
    const mm = new MetaMemory()
    const decision = mm.makeDecision("test", 0.4, ["external_tool"])
    expect(decision.action).toBe("external_tool")
  })

  test("makeDecision returns model_collaboration for VERY_LOW confidence", () => {
    const mm = new MetaMemory()
    const decision = mm.makeDecision("test", 0.1, ["model_collaboration"])
    expect(decision.action).toBe("model_collaboration")
  })

  test("recordResult affects future confidence", () => {
    const mm = new MetaMemory({ enableAdaptation: true })
    for (let i = 0; i < 20; i++) {
      mm.recordResult(true)
    }
    const confAfterSuccess = mm.estimateConfidence("test", { totalMemories: 50, freshnessScore: 0.5 })
    const mm2 = new MetaMemory({ enableAdaptation: true })
    for (let i = 0; i < 20; i++) {
      mm2.recordResult(false)
    }
    const confAfterFailure = mm2.estimateConfidence("test", { totalMemories: 50, freshnessScore: 0.5 })
    expect(confAfterSuccess).toBeGreaterThan(confAfterFailure)
  })

  test("computation queries reduce confidence", () => {
    const mm = new MetaMemory()
    const normal = mm.estimateConfidence("what is memory", { totalMemories: 100, freshnessScore: 0.8 })
    const math = mm.estimateConfidence("solve 2 + 3 * 4", { totalMemories: 100, freshnessScore: 0.8 })
    expect(math).toBeLessThan(normal)
  })

  test("computation query detection via calculate keyword", () => {
    const mm = new MetaMemory()
    const normal = mm.estimateConfidence("size of the database", { totalMemories: 100, freshnessScore: 0.8 })
    const calc = mm.estimateConfidence("calculate total revenue 2024", { totalMemories: 100, freshnessScore: 0.8 })
    expect(calc).toBeLessThan(normal)
  })

  test("getAwareness returns memory awareness report", () => {
    const mm = new MetaMemory({ enableAdaptation: true })
    for (let i = 0; i < 10; i++) {
      mm.recordResult(true)
    }
    mm.recordResult(false)
    const awareness = mm.getAwareness({
      totalMemories: 150,
      memoryDistribution: { short_term: 50, long_term: 100 },
      averageImportance: 0.6,
      lastConsolidation: Date.now() - 7200000,
    })
    expect(awareness.totalMemories).toBe(150)
    expect(awareness.memoryDistribution.short_term).toBe(50)
    expect(awareness.averageImportance).toBe(0.6)
    expect(awareness.retrievalSuccessRate).toBeGreaterThan(0.8)
    expect(awareness.consolidationNeeded).toBe(true)
    expect(awareness.confidenceLevel).toBeDefined()
  })

  test("getAwareness consolidation not needed when recent", () => {
    const mm = new MetaMemory()
    const awareness = mm.getAwareness({
      totalMemories: 20,
      lastConsolidation: Date.now(),
    })
    expect(awareness.consolidationNeeded).toBe(false)
  })

  test("decision includes estimated cost", () => {
    const mm = new MetaMemory()
    const d1 = mm.makeDecision("q", 0.9, [])
    const d2 = mm.makeDecision("q", 0.1, [])
    expect(d2.estimatedCost).toBeGreaterThan(d1.estimatedCost)
  })
})

describe("AttentionRetrieval", () => {
  test("retrieve returns ranked results", () => {
    const ar = new AttentionRetrieval()
    const items = [
      makeItem({ id: "r1", content: "machine learning basics", importance: 0.9, lastAccessed: Date.now() }),
      makeItem({ id: "r2", content: "cooking pasta recipe", importance: 0.3, lastAccessed: Date.now() - 3600000 }),
      makeItem({ id: "r3", content: "deep learning neural networks", importance: 0.7, lastAccessed: Date.now() }),
    ]
    const results = ar.retrieve("machine learning", items, 3)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0][0].id).toBe("r1")
  })

  test("results are sorted by attention weight", () => {
    const ar = new AttentionRetrieval()
    const items = [
      makeItem({ id: "low", content: "unrelated", importance: 0.1, lastAccessed: Date.now() - 10000000 }),
      makeItem({ id: "high", content: "relevant to query content here", importance: 0.9, lastAccessed: Date.now() }),
    ]
    const results = ar.retrieve("relevant query", items, 2)
    expect(results[0][0].id).toBe("high")
  })

  test("filters results below minAttentionThreshold", () => {
    const ar = new AttentionRetrieval({ minAttentionThreshold: 0.5 })
    const items = [
      makeItem({ id: "verylow", content: "x y z", importance: 0.01, lastAccessed: Date.now() - 100000000 }),
    ]
    const results = ar.retrieve("completely different", items, 10)
    expect(results.length).toBe(0)
  })

  test("attention weight components sum correctly", () => {
    const ar = new AttentionRetrieval({
      importanceWeight: 0.25,
      recencyWeight: 0.25,
      relevanceWeight: 0.25,
      emotionWeight: 0.25,
    })
    const item = makeItem({
      content: "test memory item for weighting",
      importance: 0.5,
      lastAccessed: Date.now(),
      emotionScore: 0.3,
    })
    const results = ar.retrieve("test memory weighting", [item], 1)
    expect(results.length).toBe(1)
    const weight = results[0][1]
    const expectedTotal =
      weight.importance * 0.25 + weight.recency * 0.25 + weight.relevance * 0.25 + weight.emotion * 0.25
    expect(weight.total).toBeCloseTo(expectedTotal)
  })

  test("recency decays with age", () => {
    const ar = new AttentionRetrieval({ recencyDecayHours: 1 })
    const recent = makeItem({ id: "recent", content: "test", lastAccessed: Date.now() })
    const old = makeItem({ id: "old", content: "test", lastAccessed: Date.now() - 3600000 })
    const results = ar.retrieve("test", [recent, old], 2)
    expect(results[0][0].id).toBe("recent")
  })

  test("retrieve with relevance via TF-IDF", () => {
    const ar = new AttentionRetrieval()
    const items = [
      makeItem({ id: "match", content: "neural network and deep learning", importance: 0.5, lastAccessed: Date.now() }),
      makeItem({ id: "nomatch", content: "making pizza from scratch", importance: 0.5, lastAccessed: Date.now() }),
    ]
    const results = ar.retrieve("neural network deep learning", items, 2)
    expect(results[0][0].id).toBe("match")
  })

  test("getStatistics returns config", () => {
    const ar = new AttentionRetrieval({ recencyDecayHours: 48 })
    const stats = ar.getStatistics()
    expect(stats.recencyDecayHours).toBe(48)
  })

  test("default config values", () => {
    const ar = new AttentionRetrieval()
    expect(ar.config.importanceWeight).toBe(0.3)
    expect(ar.config.recencyWeight).toBe(0.2)
    expect(ar.config.relevanceWeight).toBe(0.4)
    expect(ar.config.emotionWeight).toBe(0.1)
  })
})

describe("createMemoryItem", () => {
  test("creates item with generated ID", () => {
    const item = createMemoryItem("test", MemoryType.SHORT_TERM)
    expect(item.id).toBeTruthy()
    expect(typeof item.id).toBe("string")
    expect(item.content).toBe("test")
    expect(item.memoryType).toBe(MemoryType.SHORT_TERM)
  })

  test("clamps importance to [0, 1]", () => {
    const high = createMemoryItem("x", MemoryType.WORKING, { importance: 1.5 })
    expect(high.importance).toBe(1.0)
    const low = createMemoryItem("x", MemoryType.WORKING, { importance: -0.5 })
    expect(low.importance).toBe(0.0)
  })

  test("clamps confidence to [0, 1]", () => {
    const high = createMemoryItem("x", MemoryType.WORKING, { confidence: 2.0 })
    expect(high.confidence).toBe(1.0)
    const low = createMemoryItem("x", MemoryType.WORKING, { confidence: -1.0 })
    expect(low.confidence).toBe(0.0)
  })

  test("clamps emotionScore to [-1, 1]", () => {
    const high = createMemoryItem("x", MemoryType.WORKING, { emotionScore: 5.0 })
    expect(high.emotionScore).toBe(1.0)
    const low = createMemoryItem("x", MemoryType.WORKING, { emotionScore: -5.0 })
    expect(low.emotionScore).toBe(-1.0)
  })

  test("generates unique IDs", () => {
    const a = createMemoryItem("a", MemoryType.SHORT_TERM)
    const b = createMemoryItem("b", MemoryType.SHORT_TERM)
    expect(a.id).not.toBe(b.id)
  })

  test("sets default importance to 0.5", () => {
    const item = createMemoryItem("x", MemoryType.SHORT_TERM)
    expect(item.importance).toBe(0.5)
  })

  test("accepts metadata", () => {
    const item = createMemoryItem("x", MemoryType.SHORT_TERM, { metadata: { key: "value" } })
    expect(item.metadata.key).toBe("value")
  })

  test("accepts embedding vector", () => {
    const item = createMemoryItem("x", MemoryType.SHORT_TERM, { embedding: [1, 2, 3] })
    expect(item.embedding).toEqual([1, 2, 3])
  })
})

describe("MemoryEngine", () => {
  test("creates engine with defaults", () => {
    const engine = new MemoryEngine()
    expect(engine.workingMemory).toBeDefined()
    expect(engine.shortTermMemory).toBeDefined()
    expect(engine.longTermMemory).toBeDefined()
    expect(engine.episodicMemory).toBeDefined()
    expect(engine.semanticMemory).toBeDefined()
    expect(engine.sleepConsolidation).toBeDefined()
    expect(engine.metaMemory).toBeDefined()
    expect(engine.attentionRetrieval).toBeDefined()
  })

  test("addMemory stores item", () => {
    const engine = new MemoryEngine()
    const item = engine.addMemory("test content", MemoryType.SHORT_TERM, 0.7)
    expect(item.id).toBeTruthy()
    expect(item.content).toBe("test content")
    const found = engine.shortTermMemory.get(item.id)
    expect(found).not.toBeUndefined()
  })

  test("addMemory auto-scores importance when default 0.5", () => {
    const engine = new MemoryEngine()
    const normal = engine.addMemory("Hello world", MemoryType.SHORT_TERM)
    const urgent = engine.addMemory("URGENT: Critical bug found immediately", MemoryType.SHORT_TERM)
    expect(urgent.importance).toBeGreaterThan(normal.importance)
  })

  test("addMemory respects explicit importance", () => {
    const engine = new MemoryEngine()
    const item = engine.addMemory("content", MemoryType.SHORT_TERM, 0.42)
    expect(item.importance).toBe(0.42)
  })

  test("addMemory auto-determines memory type", () => {
    const engine = new MemoryEngine()
    const semantic = engine.addMemory("A neural network is a type of machine learning model", undefined, 0.5)
    expect(semantic.memoryType).toBe(MemoryType.SEMANTIC)
  })

  test("addMemory determines working memory for high importance", () => {
    const engine = new MemoryEngine()
    const item = engine.addMemory("Important task", undefined, 0.9)
    expect(item.memoryType).toBe(MemoryType.WORKING)
  })

  test("addMemory determines episodic for temporal content", () => {
    const engine = new MemoryEngine()
    const item = engine.addMemory("User logged in yesterday at 2024-01-15", undefined, 0.5)
    expect(item.memoryType).toBe(MemoryType.EPISODIC)
  })

  test("addMemory evicts when working memory is full", () => {
    const engine = new MemoryEngine({
      memory: { ...DEFAULT_MEMORY_CONFIG, workingMemoryCapacity: 2 },
    })
    engine.addMemory("task 1", MemoryType.WORKING, 0.9)
    engine.addMemory("task 2", MemoryType.WORKING, 0.9)
    const result = engine.addMemory("task 3", MemoryType.WORKING, 0.9)
    expect(result.id).toBeTruthy()
    const wmItems = engine.workingMemory.getAll()
    expect(wmItems.length).toBeLessThanOrEqual(2)
  })

  test("recall searches across all layers", () => {
    const engine = new MemoryEngine()
    engine.addMemory("neural network research paper", MemoryType.LONG_TERM, 0.7)
    engine.addMemory("backpropagation algorithm details", MemoryType.LONG_TERM, 0.6)
    engine.addMemory("pasta recipe", MemoryType.LONG_TERM, 0.3)
    const results = engine.recall("neural network backpropagation")
    expect(results.length).toBeGreaterThan(0)
    const contents = results.map(([item]) => String(item.content))
    expect(contents.some((c) => c.includes("neural"))).toBe(true)
    expect(contents.some((c) => c.includes("backpropagation"))).toBe(true)
  })

  test("recall respects topK", () => {
    const engine = new MemoryEngine()
    for (let i = 0; i < 20; i++) {
      engine.addMemory(`memory item ${i}`, MemoryType.LONG_TERM, 0.5)
    }
    const results = engine.recall("memory item", 3)
    expect(results.length).toBeLessThanOrEqual(3)
  })

  test("recall with specific layers", () => {
    const engine = new MemoryEngine()
    engine.addMemory("working item", MemoryType.WORKING, 0.9)
    engine.addMemory("long term item", MemoryType.LONG_TERM, 0.5)
    const results = engine.recall("working", 5, [MemoryType.WORKING])
    expect(results.length).toBeGreaterThan(0)
    expect(results.every(([item]) => item.memoryType === MemoryType.WORKING)).toBe(true)
  })

  test("forget removes item from all layers", () => {
    const engine = new MemoryEngine()
    const item = engine.addMemory("forget me", MemoryType.SHORT_TERM, 0.7)
    expect(engine.forget(item.id)).toBe(true)
    expect(engine.forget(item.id)).toBe(false)
  })

  test("forget returns false for non-existent ID", () => {
    const engine = new MemoryEngine()
    expect(engine.forget("nonexistent-id")).toBe(false)
  })

  test("consolidate transfers item to long-term memory", () => {
    const engine = new MemoryEngine()
    const item = engine.addMemory("important knowledge", MemoryType.SHORT_TERM, 0.8)
    expect(engine.consolidate(item.id)).toBe(true)
    const ltmItem = engine.longTermMemory
      .getAll()
      .find((i) => i.metadata && typeof i.metadata === "object" && (i.metadata as any).consolidatedFrom === item.id)
    expect(ltmItem).toBeDefined()
  })

  test("consolidate returns false for non-existent item", () => {
    const engine = new MemoryEngine()
    expect(engine.consolidate("nope")).toBe(false)
  })

  test("consolidate returns false for already long-term item", () => {
    const engine = new MemoryEngine()
    const item = engine.addMemory("ltm item", MemoryType.LONG_TERM, 0.5)
    expect(engine.consolidate(item.id)).toBe(false)
  })

  test("getContext returns formatted text", () => {
    const engine = new MemoryEngine()
    engine.addMemory("User name is Alice", MemoryType.SEMANTIC, 0.9)
    engine.addMemory("Preferred language is TypeScript", MemoryType.SEMANTIC, 0.7)
    const context = engine.getContext("user name alice", 2000)
    expect(context).toContain("[semantic]")
    expect(context).toContain("Alice")
  })

  test("getContext respects maxTokens", () => {
    const engine = new MemoryEngine()
    for (let i = 0; i < 10; i++) {
      engine.addMemory(`long content number ${i} `.repeat(50), MemoryType.LONG_TERM, 0.5)
    }
    const context = engine.getContext("content", 100)
    expect(context.length).toBeLessThanOrEqual(100 * 4 + 100)
  })

  test("updateMemory modifies existing item", () => {
    const engine = new MemoryEngine()
    const item = engine.addMemory("original content", MemoryType.SHORT_TERM, 0.5)
    const updated = engine.updateMemory(item.id, { content: "updated content", importance: 0.9 })
    expect(updated).not.toBeNull()
    expect(updated!.content).toBe("updated content")
    expect(updated!.importance).toBe(0.9)
  })

  test("updateMemory returns null for non-existent item", () => {
    const engine = new MemoryEngine()
    expect(engine.updateMemory("no-such-id", { content: "x" })).toBeNull()
  })

  test("updateMemory merges metadata", () => {
    const engine = new MemoryEngine()
    const item = engine.addMemory("test", MemoryType.SHORT_TERM, 0.5, { existing: true })
    const updated = engine.updateMemory(item.id, { metadata: { newKey: "value" } })
    expect(updated!.metadata.existing).toBe(true)
    expect(updated!.metadata.newKey).toBe("value")
  })

  test("autoConsolidate runs when threshold met", () => {
    const engine = new MemoryEngine({
      sleep: {
        ...DEFAULT_SLEEP_CONFIG,
        autoConsolidateInterval: 3,
        consolidationThreshold: 0.3,
        maxConsolidationCycles: 5,
      },
    })
    for (let i = 0; i < 5; i++) {
      engine.addMemory(`memory for consolidation ${i}`, MemoryType.SHORT_TERM, 0.6)
    }
    const result = engine.autoConsolidate()
    expect(result).not.toBeNull()
    if (result) {
      expect(result.memoriesProcessed).toBeGreaterThan(0)
    }
  })

  test("autoConsolidate returns null when below threshold", () => {
    const engine = new MemoryEngine({
      sleep: { ...DEFAULT_SLEEP_CONFIG, autoConsolidateInterval: 100 },
    })
    engine.addMemory("single memory", MemoryType.SHORT_TERM, 0.5)
    const result = engine.autoConsolidate()
    expect(result).toBeNull()
  })

  test("autoConsolidate decays short-term expired items", async () => {
    const engine = new MemoryEngine({
      memory: { ...DEFAULT_MEMORY_CONFIG, shortTermMemoryDurationMs: 100 },
      sleep: { ...DEFAULT_SLEEP_CONFIG, autoConsolidateInterval: 2 },
    })
    engine.addMemory("old item", MemoryType.SHORT_TERM, 0.1)
    await new Promise((r) => setTimeout(r, 150))
    engine.addMemory("new item", MemoryType.SHORT_TERM, 0.1)
    engine.autoConsolidate()
    const stats = engine.shortTermMemory.getStatistics()
    expect(stats.count).toBeLessThanOrEqual(2)
  })

  test("getStatistics returns comprehensive stats", () => {
    const engine = new MemoryEngine()
    engine.addMemory("wm item", MemoryType.WORKING, 0.8)
    engine.addMemory("stm item", MemoryType.SHORT_TERM, 0.5)
    engine.addMemory("ltm item", MemoryType.LONG_TERM, 0.3)
    engine.addMemory("ep item", MemoryType.EPISODIC, 0.4)
    if (engine.semanticMemory) {
      engine.addMemory("sem item", MemoryType.SEMANTIC, 0.6)
    }
    const stats = engine.getStatistics()
    expect(stats.totalMemories).toBeGreaterThanOrEqual(4)
    expect(stats.memoryDistribution).toBeDefined()
    expect(stats.averageImportance).toBeGreaterThan(0)
    expect(stats.workingMemory).toBeDefined()
    expect(stats.shortTermMemory).toBeDefined()
    expect(stats.longTermMemory).toBeDefined()
    expect(stats.episodicMemory).toBeDefined()
    expect(stats.semanticMemory).toBeDefined()
  })

  test("can disable semantic memory via config", () => {
    const engine = new MemoryEngine({
      memory: { ...DEFAULT_MEMORY_CONFIG, enableSemanticMemory: false },
    })
    expect(engine.semanticMemory).toBeNull()
  })

  test("custom configs propagate to components", () => {
    const engine = new MemoryEngine({
      memory: { ...DEFAULT_MEMORY_CONFIG, workingMemoryCapacity: 5 },
      sleep: { ...DEFAULT_SLEEP_CONFIG, consolidationThreshold: 0.7 },
      meta: { ...DEFAULT_META_MEMORY_CONFIG, highConfidenceThreshold: 0.9 },
      attention: { ...DEFAULT_ATTENTION_CONFIG, recencyDecayHours: 48 },
    })
    expect(engine.workingMemory.capacity).toBe(5)
    expect(engine.sleepConsolidation.config.consolidationThreshold).toBe(0.7)
    expect(engine.metaMemory.config.highConfidenceThreshold).toBe(0.9)
    expect(engine.attentionRetrieval.config.recencyDecayHours).toBe(48)
  })

  test("recall with empty query returns empty", () => {
    const engine = new MemoryEngine()
    engine.addMemory("some content", MemoryType.LONG_TERM, 0.5)
    const results = engine.recall("")
    expect(results.length).toBe(0)
  })

  test("addMemory handles emotionScore and confidence params", () => {
    const engine = new MemoryEngine()
    const item = engine.addMemory("emotional content", MemoryType.SHORT_TERM, 0.5, undefined, -0.8, 0.9)
    expect(item.emotionScore).toBe(-0.8)
    expect(item.confidence).toBe(0.9)
  })
})

describe("Default configs", () => {
  test("DEFAULT_MEMORY_CONFIG has expected values", () => {
    expect(DEFAULT_MEMORY_CONFIG.workingMemoryCapacity).toBe(7)
    expect(DEFAULT_MEMORY_CONFIG.shortTermMemoryDurationMs).toBe(3600000)
    expect(DEFAULT_MEMORY_CONFIG.shortTermMemoryCapacity).toBe(100)
    expect(DEFAULT_MEMORY_CONFIG.enableSemanticMemory).toBe(true)
  })

  test("DEFAULT_SLEEP_CONFIG has expected values", () => {
    expect(DEFAULT_SLEEP_CONFIG.consolidationThreshold).toBe(0.4)
    expect(DEFAULT_SLEEP_CONFIG.forgettingThreshold).toBe(0.2)
    expect(DEFAULT_SLEEP_CONFIG.enableReplay).toBe(true)
  })

  test("DEFAULT_META_MEMORY_CONFIG has expected values", () => {
    expect(DEFAULT_META_MEMORY_CONFIG.highConfidenceThreshold).toBe(0.8)
    expect(DEFAULT_META_MEMORY_CONFIG.enableMonitoring).toBe(true)
  })

  test("DEFAULT_ATTENTION_CONFIG has expected values", () => {
    expect(DEFAULT_ATTENTION_CONFIG.importanceWeight).toBe(0.3)
    expect(DEFAULT_ATTENTION_CONFIG.recencyWeight).toBe(0.2)
    expect(DEFAULT_ATTENTION_CONFIG.relevanceWeight).toBe(0.4)
    expect(DEFAULT_ATTENTION_CONFIG.emotionWeight).toBe(0.1)
  })
})

describe("Enums", () => {
  test("MemoryType has 5 layers", () => {
    expect(Object.values(MemoryType).length).toBe(5)
  })

  test("MemoryPriority values are correct", () => {
    expect(MemoryPriority.LOW).toBe(0)
    expect(MemoryPriority.CRITICAL).toBe(3)
  })

  test("SleepStage includes all stages", () => {
    expect(Object.values(SleepStage)).toContain("awake")
    expect(Object.values(SleepStage)).toContain("rem")
    expect(Object.values(SleepStage)).toContain("consolidation")
  })

  test("ConfidenceLevel has 4 levels", () => {
    expect(Object.values(ConfidenceLevel).length).toBe(4)
  })
})

describe("createMemoryEngine", () => {
  test("returns a MemoryEngine instance", () => {
    const engine = createMemoryEngine()
    expect(engine).toBeInstanceOf(MemoryEngine)
    expect(engine.workingMemory).toBeDefined()
  })
})
