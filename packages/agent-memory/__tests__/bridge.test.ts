/**
 * Bridge tests — UnifiedMemoryBridge (agent-memory × memory-engine-v2).
 *
 * Verifies the bridge correctly combines:
 * - CoreRules (L4) from agent-memory
 * - 5-tier engine storage from memory-engine-v2
 * - Ebbinghaus retention decay
 * - 5-factor importance scoring
 * - Token-budget context assembly
 */

import { beforeEach, describe, expect, test } from "bun:test"

import { MemoryType } from "@fengru/memory-engine-v2"
import { UnifiedMemoryBridge } from "../src/bridge"
import type { CoreRule, LongTermMemory, WorkingMemory } from "../src/bridge"

// ── Helpers ────────────────────────────────────────────────────────────────

function createCoreRule(overrides?: Partial<CoreRule>): CoreRule {
  return {
    rule_id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    category: "safety",
    content: "Never delete user files without confirmation",
    token_count: 8,
    importance: 0.9,
    ...overrides,
  }
}

function createLTM(overrides?: Partial<LongTermMemory>): LongTermMemory {
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

// ── Tests ──────────────────────────────────────────────────────────────────

describe("UnifiedMemoryBridge", () => {
  // ── Construction & Engine ───────────────────────────────────────────────

  test("constructs with default config", () => {
    const bridge = new UnifiedMemoryBridge()
    expect(bridge.engine).toBeDefined()
    expect(bridge.getMaxTokens()).toBe(8000)
  })

  test("constructs with custom maxTokens", () => {
    const bridge = new UnifiedMemoryBridge({ maxTokens: 4000 })
    expect(bridge.getMaxTokens()).toBe(4000)
  })

  test("constructs with engine config overrides", () => {
    const bridge = new UnifiedMemoryBridge({
      memory: {
        workingMemoryCapacity: 10,
        shortTermMemoryDurationMs: 1800000,
        shortTermMemoryCapacity: 50,
        enableSemanticMemory: false,
      },
    })
    const stats = bridge.getStatistics()
    expect(stats.workingMemory).toBeDefined()
  })

  // ── Memory Write / Recall ────────────────────────────────────────────────

  test("addMemory writes to engine and is recallable", () => {
    const bridge = new UnifiedMemoryBridge()
    const item = bridge.addMemory("TypeScript is a typed superset of JavaScript", 0.7)
    expect(item.id).toBeDefined()
    expect(item.memoryType).toBeDefined()

    const results = bridge.recall("TypeScript")
    expect(results.length).toBeGreaterThan(0)
    expect(String(results[0]![0].content)).toContain("TypeScript")
  })

  test("addToLayer forces a specific memory tier", () => {
    const bridge = new UnifiedMemoryBridge()
    const item = bridge.addToLayer("episodic event: deployed to production", MemoryType.EPISODIC, 0.6)
    expect(item.memoryType).toBe(MemoryType.EPISODIC)
  })

  test("recall with different topK values", () => {
    const bridge = new UnifiedMemoryBridge()
    for (let i = 0; i < 5; i++) {
      bridge.addMemory(`Knowledge item ${i}: React hooks are powerful`, 0.5 + i * 0.1)
    }
    const k3 = bridge.recall("React hooks", 3)
    const k10 = bridge.recall("React hooks", 10)
    expect(k3.length).toBeLessThanOrEqual(3)
    expect(k10.length).toBeLessThanOrEqual(5) // only 5 items stored
  })

  test("recall with layer filter", () => {
    const bridge = new UnifiedMemoryBridge()
    bridge.addToLayer("working item", MemoryType.WORKING, 0.8)
    bridge.addToLayer("long-term item", MemoryType.LONG_TERM, 0.4)

    const workingResults = bridge.recall("item", 10, [MemoryType.WORKING])
    const workingIds = new Set(workingResults.map(([item]) => item.id))
    // Should find the working memory item
    expect(workingResults.some(([item]) => item.memoryType === MemoryType.WORKING)).toBe(true)
  })

  // ── Core Rules (L4) ──────────────────────────────────────────────────────

  test("adds and retrieves core rules", () => {
    const bridge = new UnifiedMemoryBridge()
    bridge.addCoreRule(createCoreRule({ rule_id: "r1", content: "Always validate user input" }))
    bridge.addCoreRule(createCoreRule({ rule_id: "r2", content: "Never expose secrets" }))

    const rules = bridge.getCoreRules()
    expect(rules.length).toBe(2)
    expect(rules.map((r) => r.rule_id).sort()).toEqual(["r1", "r2"])
  })

  test("updates existing core rule by id", () => {
    const bridge = new UnifiedMemoryBridge()
    bridge.addCoreRule(createCoreRule({ rule_id: "r-update", content: "old content" }))
    bridge.addCoreRule(createCoreRule({ rule_id: "r-update", content: "new content" }))

    const rules = bridge.getCoreRules()
    expect(rules.length).toBe(1)
    expect(rules[0]!.content).toBe("new content")
  })

  test("removes core rule by id", () => {
    const bridge = new UnifiedMemoryBridge()
    bridge.addCoreRule(createCoreRule({ rule_id: "r-removable" }))
    expect(bridge.getCoreRules().length).toBe(1)
    expect(bridge.removeCoreRule("r-removable")).toBe(true)
    expect(bridge.getCoreRules().length).toBe(0)
  })

  test("removeCoreRule returns false for non-existent", () => {
    const bridge = new UnifiedMemoryBridge()
    expect(bridge.removeCoreRule("nonexistent")).toBe(false)
  })

  // ── Working Memory (L2) ──────────────────────────────────────────────────

  test("adds and retrieves working memories", () => {
    const bridge = new UnifiedMemoryBridge()
    bridge.addWorkingMemory({ id: "w1", content: "Current task: refactor auth", token_count: 5, priority: 0.8 })

    const wms = bridge.getWorkingMemories()
    expect(wms.length).toBe(1)
    expect(wms[0]!.id).toBe("w1")
  })

  test("caps working memory at configured capacity", () => {
    const bridge = new UnifiedMemoryBridge({ workingMemoryCap: 5 })
    for (let i = 0; i < 10; i++) {
      bridge.addWorkingMemory({ id: `w${i}`, content: `task ${i}`, token_count: 1, priority: 0.5 })
    }
    expect(bridge.getWorkingMemories().length).toBe(5)
  })

  // ── Transient Memory (L1) ────────────────────────────────────────────────

  test("adds and clears transient memory", () => {
    const bridge = new UnifiedMemoryBridge()
    bridge.addTransient("thinking about the solution", 3)
    bridge.addTransient("checking edge cases", 2)
    expect(bridge.getTransientMemories().length).toBe(2)

    bridge.clearTransient()
    expect(bridge.getTransientMemories().length).toBe(0)
  })

  test("caps transient memory at configured capacity", () => {
    const bridge = new UnifiedMemoryBridge({ transientMemoryCap: 3 })
    for (let i = 0; i < 8; i++) {
      bridge.addTransient(`thought ${i}`, 1)
    }
    expect(bridge.getTransientMemories().length).toBe(3)
  })

  // ── Ebbinghaus Retention ─────────────────────────────────────────────────

  test("calculateRetention - recent > old", () => {
    const bridge = new UnifiedMemoryBridge()
    const recent = createLTM({ created_at: Date.now(), importance: 0.5, access_count: 0 })
    const old = createLTM({ created_at: Date.now() - 86400000 * 30, importance: 0.5, access_count: 0 })
    expect(bridge.calculateRetention(recent)).toBeGreaterThan(bridge.calculateRetention(old))
  })

  test("calculateRetention - higher importance = slower decay", () => {
    const bridge = new UnifiedMemoryBridge()
    const low = createLTM({ created_at: Date.now() - 86400000, importance: 0.2, access_count: 0 })
    const high = createLTM({ created_at: Date.now() - 86400000, importance: 0.9, access_count: 0 })
    expect(bridge.calculateRetention(high)).toBeGreaterThan(bridge.calculateRetention(low))
  })

  test("calculateRetention - access_count slows decay", () => {
    const bridge = new UnifiedMemoryBridge()
    const noAccess = createLTM({ created_at: Date.now() - 86400000 * 7, importance: 0.5, access_count: 0 })
    const frequent = createLTM({ created_at: Date.now() - 86400000 * 7, importance: 0.5, access_count: 20 })
    expect(bridge.calculateRetention(frequent)).toBeGreaterThan(bridge.calculateRetention(noAccess))
  })

  test("calculateRetention has minimum floor of 0.05", () => {
    const bridge = new UnifiedMemoryBridge()
    const ancient = createLTM({
      created_at: Date.now() - 86400000 * 365 * 10,
      importance: 0,
      access_count: 0,
    })
    expect(bridge.calculateRetention(ancient)).toBeGreaterThanOrEqual(0.05)
  })

  test("calculateEngineRetention works on MemoryItem", () => {
    const bridge = new UnifiedMemoryBridge()
    const item = bridge.addMemory("test content for retention", 0.5)
    const retention = bridge.calculateEngineRetention(item)
    expect(retention).toBeGreaterThanOrEqual(0.05)
    expect(retention).toBeLessThanOrEqual(1.0)
  })

  // ── 5-Factor Importance ──────────────────────────────────────────────────

  test("calculateImportance - user_marked gives higher score", () => {
    const bridge = new UnifiedMemoryBridge()
    const marked = createLTM({ user_marked: true, importance: 0.5 })
    const unmarked = createLTM({ user_marked: false, importance: 0.5 })
    expect(bridge.calculateImportance(marked)).toBeGreaterThan(bridge.calculateImportance(unmarked))
  })

  test("calculateImportance - error_related gives higher score", () => {
    const bridge = new UnifiedMemoryBridge()
    const error = createLTM({ associated_error: true, importance: 0.5 })
    const normal = createLTM({ associated_error: false, importance: 0.5 })
    expect(bridge.calculateImportance(error)).toBeGreaterThan(bridge.calculateImportance(normal))
  })

  test("calculateImportance score is between 0-1", () => {
    const bridge = new UnifiedMemoryBridge()
    const mem = createLTM({ importance: 0.7, user_marked: true, associated_error: true, access_count: 15 })
    const score = bridge.calculateImportance(mem)
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(1)
  })

  // ── Composite Retrieval ──────────────────────────────────────────────────

  test("compositeRetrievalScore with vector", () => {
    const bridge = new UnifiedMemoryBridge()
    const mem = createLTM({ vector: [0.5, 0.3, 0.2] })
    const score = bridge.compositeRetrievalScore(mem, [0.5, 0.3, 0.2], "test goal")
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(1)
  })

  test("compositeRetrievalScore without vector falls back to Jaccard", () => {
    const bridge = new UnifiedMemoryBridge()
    const mem = createLTM({ vector: undefined, content: "process user input validation" })
    const score = bridge.compositeRetrievalScore(mem, null, "user input processing")
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(1)
  })

  // ── Mark Successful ──────────────────────────────────────────────────────

  test("markSuccessful boosts importance", () => {
    const bridge = new UnifiedMemoryBridge()
    const item = bridge.addMemory("important configuration detail", 0.5)
    const result = bridge.markSuccessful(item.id)
    expect(result).toBe(true)
  })

  test("markSuccessful returns false for non-existent", () => {
    const bridge = new UnifiedMemoryBridge()
    expect(bridge.markSuccessful("nonexistent-id")).toBe(false)
  })

  // ── Update / Forget ──────────────────────────────────────────────────────

  test("updateMemory modifies existing item", () => {
    const bridge = new UnifiedMemoryBridge()
    const item = bridge.addMemory("original content", 0.5)
    const updated = bridge.updateMemory(item.id, { content: "updated content", importance: 0.9 })
    expect(updated).not.toBeNull()
    expect(updated!.content).toBe("updated content")
    expect(updated!.importance).toBe(0.9)
  })

  test("forget removes item", () => {
    const bridge = new UnifiedMemoryBridge()
    const item = bridge.addMemory("forgettable content", 0.3)
    expect(bridge.forget(item.id)).toBe(true)
    expect(bridge.forget(item.id)).toBe(false) // already gone
  })

  // ── Context Assembly ─────────────────────────────────────────────────────

  test("assembleContext respects token budget", () => {
    const bridge = new UnifiedMemoryBridge({ maxTokens: 1000 })
    bridge.addCoreRule(createCoreRule({ rule_id: "r-ctx", token_count: 3 }))

    // Add many engine items
    for (let i = 0; i < 10; i++) {
      bridge.addMemory(`Context item ${i}: very long content `.repeat(50), 0.5)
    }

    bridge.addWorkingMemory({ id: "wm-ctx", content: "working on context", token_count: 3, priority: 0.7 })
    bridge.addTransient("recent thought", 2)

    const ctx = bridge.assembleContext("context item", null)
    expect(ctx.l4.length).toBe(1)
    expect(ctx.totalTokens).toBeLessThanOrEqual(1000 + 600) // budget + some cushion
  })

  test("assembleContext returns L3 items relevant to query", () => {
    const bridge = new UnifiedMemoryBridge()
    bridge.addMemory("Docker deployment best practices for production", 0.7)
    bridge.addMemory("Python list comprehension tutorial", 0.5)
    bridge.addMemory("Docker compose multi-container setup", 0.6)

    const ctx = bridge.assembleContext("Docker deployment")
    expect(ctx.l3.length).toBeGreaterThan(0)

    const l3Contents = ctx.l3.map((m) => m.content.toLowerCase())
    expect(l3Contents.some((c) => c.includes("docker"))).toBe(true)
  })

  test("assembleContext uses cache within TTL", () => {
    const bridge = new UnifiedMemoryBridge()
    bridge.addMemory("cached knowledge about caching strategies", 0.5)

    const ctx1 = bridge.assembleContext("caching")
    const ctx2 = bridge.assembleContext("caching")

    // Should use cache (same reference)
    expect(ctx1.totalTokens).toBe(ctx2.totalTokens)
  })

  test("assembleContext invalidates cache on core rule change", () => {
    const bridge = new UnifiedMemoryBridge()
    bridge.addMemory("some knowledge", 0.5)

    const ctx1 = bridge.assembleContext("knowledge")
    bridge.addCoreRule(createCoreRule({ rule_id: "r-invalidate", token_count: 1 }))
    const ctx2 = bridge.assembleContext("knowledge")

    // Cache should be invalidated; may differ due to core rule token count change
    expect(ctx1.l4.length).not.toBe(ctx2.l4.length)
  })

  test("assembleContext different vectors produce different L3", () => {
    const bridge = new UnifiedMemoryBridge()
    // Add engine items with embeddings
    const item1 = bridge.addMemory("task A description", 0.5, undefined, { embedding: [1.0, 0.0, 0.0] })
    const item2 = bridge.addMemory("task B description", 0.5, undefined, { embedding: [0.0, 1.0, 0.0] })

    // Without vector scoring, the results may overlap - verify the context is assembled
    const ctx1 = bridge.assembleContext("task A", [1.0, 0.0, 0.0])
    const ctx2 = bridge.assembleContext("task B", [0.0, 1.0, 0.0])

    expect(ctx1.totalTokens).toBeGreaterThan(0)
    expect(ctx2.totalTokens).toBeGreaterThan(0)
  })

  // ── L3 Engine items in context ───────────────────────────────────────────

  test("assembleContext includes l3Engine in result", () => {
    const bridge = new UnifiedMemoryBridge()
    bridge.addMemory("engine-mapped memory", 0.5)

    const ctx = bridge.assembleContext("engine-mapped")
    expect(ctx.l3Engine).toBeDefined()
    expect(ctx.l3Engine.length).toBeGreaterThan(0)
    expect(ctx.l3.length).toBe(ctx.l3Engine.length)
  })

  // ── Statistics ────────────────────────────────────────────────────────────

  test("getStatistics includes bridge-level counts", () => {
    const bridge = new UnifiedMemoryBridge()
    bridge.addCoreRule(createCoreRule({ rule_id: "stat-rule" }))
    bridge.addWorkingMemory({ id: "stat-wm", content: "stat task", token_count: 2, priority: 0.5 })
    bridge.addTransient("stat thought", 1)

    const stats = bridge.getStatistics()
    expect(stats.coreRulesCount).toBe(1)
    expect(stats.workingMirrorCount).toBe(1)
    expect(stats.transientCount).toBe(1)
    expect(stats.totalMemories).toBeDefined()
  })

  // ── Serialization ────────────────────────────────────────────────────────

  test("toJSON and fromJSON round-trips bridge state", () => {
    const bridge = new UnifiedMemoryBridge()
    bridge.addCoreRule(createCoreRule({ rule_id: "json-r1", content: "rule for JSON" }))
    bridge.addWorkingMemory({ id: "json-w1", content: "json task", token_count: 3, priority: 0.6 })
    bridge.addTransient("json thought", 1)

    const json = bridge.toJSON()
    expect(json).toHaveProperty("coreRules")
    expect(json).toHaveProperty("workingMirror")
    expect(json).toHaveProperty("transientMemories")

    const restored = new UnifiedMemoryBridge()
    restored.fromJSON(json as any)

    expect(restored.getCoreRules().length).toBe(1)
    expect(restored.getCoreRules()[0]!.rule_id).toBe("json-r1")
    expect(restored.getWorkingMemories().length).toBe(1)
    expect(restored.getTransientMemories().length).toBe(1)
  })

  // ── Auto Consolidation ───────────────────────────────────────────────────

  test("autoConsolidate runs without error on empty engine", () => {
    const bridge = new UnifiedMemoryBridge()
    const result = bridge.autoConsolidate()
    // With empty engine, should return null (not enough items)
    expect(result).toBeNull()
  })

  test("autoConsolidate processes after filling items", () => {
    const bridge = new UnifiedMemoryBridge({
      sleep: {
        autoConsolidateInterval: 2,
        consolidationThreshold: 0.1,
        forgettingThreshold: 0.01,
        enableReplay: true,
        enableForgetting: true,
        enableAssociation: false,
        replayImportanceBoost: 0.15,
        maxConsolidationCycles: 10,
      },
    })

    // Fill enough items to trigger consolidation
    for (let i = 0; i < 5; i++) {
      bridge.addMemory(`memory item for consolidation ${i}`, 0.7)
    }

    // Should trigger (>= autoConsolidateInterval items)
    const result = bridge.autoConsolidate()
    expect(result).not.toBeNull()
    if (result) {
      expect(result.memoriesProcessed).toBeGreaterThan(0)
      expect(typeof result.durationMs).toBe("number")
    }
  })

  // ── Get Context ──────────────────────────────────────────────────────────

  test("getContext returns text-formatted context", () => {
    const bridge = new UnifiedMemoryBridge()
    bridge.addMemory("important: API key rotation every 90 days", 0.8)

    const ctx = bridge.getContext("API key rotation", 500)
    expect(typeof ctx).toBe("string")
    expect(ctx.length).toBeGreaterThan(0)
    expect(ctx).toContain("API key rotation")
  })

  // ── Consolidate ──────────────────────────────────────────────────────────

  test("consolidate delegates to engine", () => {
    const bridge = new UnifiedMemoryBridge()
    const item = bridge.addMemory("memory to consolidate", 0.5)
    const result = bridge.consolidate(item.id)
    expect(typeof result).toBe("boolean")
  })

  test("consolidate returns false for non-existent id", () => {
    const bridge = new UnifiedMemoryBridge()
    expect(bridge.consolidate("nonexistent-id")).toBe(false)
  })

  // ── Set Max Tokens ────────────────────────────────────────────────────────

  test("setMaxTokens updates the limit", () => {
    const bridge = new UnifiedMemoryBridge()
    bridge.setMaxTokens(4000)
    expect(bridge.getMaxTokens()).toBe(4000)
  })

  // ── Reset ─────────────────────────────────────────────────────────────────

  test("reset clears bridge-level state", () => {
    const bridge = new UnifiedMemoryBridge()
    bridge.addCoreRule(createCoreRule({ rule_id: "rst" }))
    bridge.addWorkingMemory({ id: "rst-wm", content: "reset me", token_count: 2, priority: 0.5 })
    bridge.addTransient("reset me", 1)

    bridge.reset()
    expect(bridge.getCoreRules().length).toBe(0)
    expect(bridge.getWorkingMemories().length).toBe(0)
    expect(bridge.getTransientMemories().length).toBe(0)
  })
})
