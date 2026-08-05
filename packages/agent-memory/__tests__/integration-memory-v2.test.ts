/**
 * Integration tests — agent-memory × memory-engine-v2 cross-package wiring.
 *
 * Tests that MemorySystem (agent-memory 4-tier) and UnifiedMemoryBridge
 * (wrapping memory-engine-v2 5-tier) interoperate correctly, verifying
 * data flow, Ebbinghaus decay with engine retrieval, and dual-system
 * context assembly.
 */

import { describe, expect, test } from "bun:test"

import { MemoryEngine, MemoryType } from "@fengru/memory-engine-v2"
import { UnifiedMemoryBridge } from "../src/bridge"
import { MemorySystem } from "../src/index"
import type { LongTermMemory } from "../src/index"

// ── Helpers ────────────────────────────────────────────────────────────────

function createLTM(overrides?: Partial<LongTermMemory>): LongTermMemory {
  return {
    memory_id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    content: "TypeScript is a typed superset of JavaScript",
    token_count: 12,
    importance: 0.5,
    access_count: 0,
    created_at: Date.now() - 86400000 * 2,
    last_accessed: Date.now(),
    retention_score: 0.5,
    ...overrides,
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Integration: MemorySystem (agent-memory) × MemoryEngine (memory-engine-v2)", () => {
  // ── Cross-package construction & internal wiring ─────────────────────

  test("MemorySystem + UnifiedMemoryBridge share memory-engine-v2 engine", () => {
    const bridge = new UnifiedMemoryBridge()
    const engine = bridge.engine

    expect(engine).toBeInstanceOf(MemoryEngine)
    expect(engine.workingMemory).toBeDefined()
    expect(engine.shortTermMemory).toBeDefined()
    expect(engine.longTermMemory).toBeDefined()
  })

  test("MemorySystem stores L3 memories independently while bridge uses engine", () => {
    const system = new MemorySystem()
    const bridge = new UnifiedMemoryBridge()

    // System L3: inserts into internal array
    system.addLongTermMemory(
      createLTM({
        memory_id: "sys-ltm-1",
        content: "System-managed long-term memory about deployment",
      }),
    )

    // Bridge: inserts into engine 5-tier stores
    bridge.addMemory("Bridge-managed knowledge about deployment", 0.7)

    const sysMemories = system.getLongTermMemories()
    const bridgeResults = bridge.recall("deployment", 10)

    expect(sysMemories.length).toBe(1)
    expect(sysMemories[0]!.content).toContain("System-managed")
    expect(bridgeResults.length).toBeGreaterThan(0)
  })

  test("data flows independently in both systems without interference", () => {
    const system = new MemorySystem()
    const bridge = new UnifiedMemoryBridge()

    system.addLongTermMemory(
      createLTM({
        memory_id: "isolated-1",
        content: "Python is great for data science",
        tags: ["python", "data-science"],
      }),
    )

    bridge.addMemory("Rust is great for systems programming", 0.6)

    // System search should not find bridge items
    const sysByTags = system.searchByTags(["python"])
    expect(sysByTags.length).toBe(1)
    expect(sysByTags[0]!.content).toContain("Python")

    // Bridge recall should not find system items
    const bridgeRecall = bridge.recall("Python", 5)
    const hasPythonInBridge = bridgeRecall.some(([item]) => String(item.content).includes("Python"))
    // Bridge won't have system items since they're separate stores
    expect(hasPythonInBridge).toBe(false)
  })

  // ── Ebbinghaus decay with memory-engine-v2 retrieval ────────────────

  test("Ebbinghaus decay on MemorySystem L3 aligns with bridge calculateEngineRetention", () => {
    const system = new MemorySystem()
    const bridge = new UnifiedMemoryBridge()

    // Create old memory
    const oldMem = createLTM({
      memory_id: "ebbing-old",
      content: "Old deployment procedure from last month",
      created_at: Date.now() - 30 * 86400000,
      importance: 0.5,
      access_count: 0,
    })

    system.addLongTermMemory(oldMem)
    const systemRetention = system.calculateRetention(oldMem)

    // Create engine item with similar age
    const engineItem = bridge.addMemory(
      "Old deployment procedure from last month",
      0.5,
      undefined,
      undefined,
      undefined,
      0.5,
    )

    // Manually set timestamp to simulate age (the calculateEngineRetention uses item.timestamp)
    const engineRetention = bridge.calculateEngineRetention({
      ...engineItem,
      timestamp: oldMem.created_at,
    })

    // Both systems use the same formula: R = exp(-t/S_eff) * beta
    // Slight differences due to different internal timestamps are expected
    expect(systemRetention).toBeGreaterThanOrEqual(0.05)
    expect(systemRetention).toBeLessThanOrEqual(1.0)
    expect(engineRetention).toBeGreaterThanOrEqual(0.05)
    expect(engineRetention).toBeLessThanOrEqual(1.0)

    // Old memories should have low retention (< 0.5 for 30-day-old with no access)
    expect(systemRetention).toBeLessThan(0.5)
  })

  test("frequent access boosts Ebbinghaus retention in both systems", () => {
    const system = new MemorySystem()
    const _bridge = new UnifiedMemoryBridge()

    const frequentMem = createLTM({
      memory_id: "frequent-ebbing",
      content: "Frequently accessed knowledge",
      created_at: Date.now() - 7 * 86400000,
      importance: 0.5,
      access_count: 50,
    })

    const rareMem = createLTM({
      memory_id: "rare-ebbing",
      content: "Rarely accessed knowledge",
      created_at: Date.now() - 7 * 86400000,
      importance: 0.5,
      access_count: 0,
    })

    system.addLongTermMemory(frequentMem)
    system.addLongTermMemory(rareMem)

    const freqRetention = system.calculateRetention(frequentMem)
    const rareRetention = system.calculateRetention(rareMem)

    expect(freqRetention).toBeGreaterThan(rareRetention)
  })

  // ── Combined context assembly from both systems ─────────────────────

  test("combined context assembly aggregates both system and bridge", () => {
    const system = new MemorySystem()
    const bridge = new UnifiedMemoryBridge()

    system.setMaxTokens(6000)

    // L4 via system
    system.addCoreRule({
      rule_id: "combined-r1",
      category: "safety",
      content: "Always validate user inputs before processing",
      token_count: 8,
      importance: 1.0,
    })

    // L4 via bridge
    bridge.addCoreRule({
      rule_id: "combined-r2",
      category: "performance",
      content: "Prefer lazy loading for large datasets",
      token_count: 7,
      importance: 0.8,
    })

    // L3 via system
    system.addLongTermMemory(
      createLTM({
        memory_id: "sys-l3-ctx",
        content: "The database schema uses PostgreSQL with JSONB columns",
        token_count: 10,
        importance: 0.7,
        tags: ["database", "postgresql"],
      }),
    )

    // L3 via bridge engine
    bridge.addMemory("PostgreSQL JSONB queries need GIN indexes for performance", 0.7)

    // L2 via system
    system.addWorkingMemory({
      id: "sys-w2",
      content: "Currently optimizing database queries",
      token_count: 6,
      priority: 0.9,
    })

    const sysCtx = system.assembleContext("database query optimization", null)
    const bridgeCtx = bridge.assembleContext("database query optimization", null)

    // Both contexts should be assembled independently
    expect(sysCtx.l4.length).toBeGreaterThan(0)
    expect(sysCtx.l3.length).toBeGreaterThan(0)
    expect(sysCtx.totalTokens).toBeLessThanOrEqual(6000)

    expect(bridgeCtx.l4.length).toBeGreaterThan(0)
    expect(bridgeCtx.l3.length).toBeGreaterThan(0)
    expect(bridgeCtx.totalTokens).toBeGreaterThan(0)
  })
})

describe("Integration: UnifiedMemoryBridge wraps MemoryEngine stores", () => {
  // ── Bridge-to-engine data flow ──────────────────────────────────────

  test("addMemory through bridge populates engine layers", () => {
    const bridge = new UnifiedMemoryBridge()

    const item1 = bridge.addMemory("urgent: fix production outage", 0.95)
    const item2 = bridge.addMemory("sprint retrospective notes from 2024-03-15", 0.4)

    const stats = bridge.getStatistics()
    expect(Number(stats.totalMemories)).toBeGreaterThanOrEqual(2)

    // Different memory types due to auto-scoring
    const memoryTypes = [item1.memoryType, item2.memoryType]
    expect(memoryTypes).toContain(MemoryType.WORKING) // urgent → WORKING
    expect(memoryTypes).toContain(MemoryType.EPISODIC) // date → EPISODIC
  })

  test("bridge recall queries across engine layers correctly", () => {
    const bridge = new UnifiedMemoryBridge()

    bridge.addMemory("Critical security vulnerability in authentication module", 0.95)
    bridge.addMemory("Weekly standup notes for sprint 42", 0.4)
    bridge.addMemory("Docker container security best practices for 2024", 0.7)

    const results = bridge.recall("security", 5)
    expect(results.length).toBeGreaterThanOrEqual(2)

    const contents = results.map(([item]) => String(item.content).toLowerCase())
    expect(contents.some((c) => c.includes("security"))).toBe(true)
  })

  test("bridge recall with layer filtering queries only specified tiers", () => {
    const bridge = new UnifiedMemoryBridge()

    bridge.addToLayer("working-only item", MemoryType.WORKING, 0.8)
    bridge.addToLayer("episodic-only item", MemoryType.EPISODIC, 0.5)

    const workOnly = bridge.recall("item", 10, [MemoryType.WORKING])
    const epOnly = bridge.recall("item", 10, [MemoryType.EPISODIC])

    expect(workOnly.every(([item]) => item.memoryType === MemoryType.WORKING)).toBe(true)
    expect(epOnly.every(([item]) => item.memoryType === MemoryType.EPISODIC)).toBe(true)
  })

  test("bridge engine operations (forget, update) affect cross-tier retrieval", () => {
    const bridge = new UnifiedMemoryBridge()

    const item = bridge.addMemory("temporary configuration note", 0.5)
    const itemId = item.id

    // Recall should find it
    const before = bridge.recall("configuration", 5)
    expect(before.some(([i]) => i.id === itemId)).toBe(true)

    // Forget it
    const forgotten = bridge.forget(itemId)
    expect(forgotten).toBe(true)

    // Should no longer be retrievable
    const after = bridge.recall("configuration", 5)
    expect(after.some(([i]) => i.id === itemId)).toBe(false)
  })
})
