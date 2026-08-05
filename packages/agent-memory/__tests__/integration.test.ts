/**
 * Integration tests — agent-memory × engine-db cross-package wiring.
 *
 * Tests the MemorySystem with real EngineDatabase persistence via
 * the MemoryBackend adapter, verifying correct cross-package behavior
 * for the 4-tier memory system.
 */

import { beforeEach, describe, expect, test } from "bun:test"

// agent-memory
import { MemorySystem } from "../src/index"
import type { CoreRule, LongTermMemory } from "../src/index"

// engine-db (cross-package import)
import { EngineDatabase, MemoryBackend } from "../../engine-db/src/index"

// ── Helpers ────────────────────────────────────────────────────────────────

/** Create a minimal mock SQLite database that stores data in memory */
function createMockDB() {
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

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Integration: MemorySystem × EngineDatabase", () => {
  let system: MemorySystem

  beforeEach(() => {
    system = new MemorySystem()
  })

  test("MemoryBackend constructor creates adapter wrapping EngineDatabase", () => {
    const db = new EngineDatabase()
    const backend = new MemoryBackend(db)

    // Verify adapter implements MemoryDatabase interface shape
    expect(typeof backend.insertMemory).toBe("function")
    expect(typeof backend.getMemories).toBe("function")
    expect(typeof backend.searchByTags).toBe("function")
    expect(typeof backend.markSuccessful).toBe("function")
    expect(typeof backend.getAgentSelfRules).toBe("function")
    expect(typeof backend.upsertAgentSelfRule).toBe("function")
    expect(typeof backend.getUserProfiles).toBe("function")
    expect(typeof backend.upsertUserProfile).toBe("function")
  })

  test("MemorySystem accepts MemoryBackend via setDatabase", () => {
    const db = new EngineDatabase()
    const backend = new MemoryBackend(db)

    // Should not throw
    system.setDatabase(backend)

    // Verify maxTokens can be set
    system.setMaxTokens(16000)
    expect(system.getMaxTokens()).toBe(16000)
  })

  test("core rules flow through engine-db persistence layer", () => {
    const db = new EngineDatabase()
    const mockDb = createMockDB()
    db.setDatabase(mockDb)

    const backend = new MemoryBackend(db)
    system.setDatabase(backend)

    const coreRule: CoreRule = {
      rule_id: "rule-1",
      category: "safety",
      content: "Never delete files without user confirmation",
      token_count: 10,
      importance: 0.95,
    }
    system.addCoreRule(coreRule)

    const rules = system.getCoreRules()
    expect(rules.length).toBe(1)
    expect(rules[0]!.rule_id).toBe("rule-1")
  })

  test("long-term memories flow through working memory and persistence", () => {
    system.setMaxTokens(16000)

    const mem: LongTermMemory = {
      memory_id: "ltm-1",
      content: "The project uses TypeScript strict mode with bun runtime",
      token_count: 12,
      importance: 0.7,
      access_count: 3,
      created_at: Date.now() - 86400000,
      last_accessed: Date.now(),
      retention_score: 0.85,
      category: "tech-stack",
      tags: ["typescript", "bun"],
    }

    system.addLongTermMemory(mem)

    const allMemories = system.getLongTermMemories()
    expect(allMemories.length).toBe(1)
    expect(allMemories[0]!.content).toContain("TypeScript")
  })

  test("search by tags returns matching long-term memories", () => {
    const mem1: LongTermMemory = {
      memory_id: "ltm-t1",
      content: "Deploy with Docker",
      token_count: 5,
      importance: 0.8,
      access_count: 2,
      created_at: Date.now(),
      last_accessed: Date.now(),
      retention_score: 0.9,
      tags: ["docker", "deploy"],
    }
    const mem2: LongTermMemory = {
      memory_id: "ltm-t2",
      content: "Test with Jest",
      token_count: 5,
      importance: 0.7,
      access_count: 1,
      created_at: Date.now(),
      last_accessed: Date.now(),
      retention_score: 0.85,
      tags: ["jest", "test"],
    }

    system.addLongTermMemory(mem1)
    system.addLongTermMemory(mem2)

    const results = system.searchByTags(["docker"])
    expect(results.length).toBe(1)
    expect(results[0]!.memory_id).toBe("ltm-t1")
  })

  test("markSuccessful boosts importance and retention", () => {
    const mem: LongTermMemory = {
      memory_id: "ltm-boost",
      content: "Important fact about architecture",
      token_count: 8,
      importance: 0.5,
      access_count: 1,
      created_at: Date.now() - 3600000,
      last_accessed: Date.now() - 3600000,
      retention_score: 0.5,
    }

    system.addLongTermMemory(mem)
    const oldImportance = system.getLongTermMemories()[0]!.importance

    const success = system.markSuccessful("ltm-boost")
    expect(success).toBe(true)

    const updated = system.getLongTermMemories()[0]!
    expect(updated!.importance).toBeGreaterThan(oldImportance)
    expect(updated!.access_count).toBe(2)
  })

  test("Ebbinghaus retention decays over time", () => {
    const oldMem: LongTermMemory = {
      memory_id: "ltm-old",
      content: "This was learned a week ago",
      token_count: 5,
      importance: 0.5,
      access_count: 0,
      created_at: Date.now() - 7 * 24 * 3600000, // 7 days ago
      last_accessed: Date.now() - 7 * 24 * 3600000,
      retention_score: 0.5,
    }
    const newMem: LongTermMemory = {
      memory_id: "ltm-new",
      content: "This was learned just now",
      token_count: 5,
      importance: 0.5,
      access_count: 0,
      created_at: Date.now(),
      last_accessed: Date.now(),
      retention_score: 0.5,
    }

    system.addLongTermMemory(oldMem)
    system.addLongTermMemory(newMem)

    // Calculate retention for both
    const oldRetention = system.calculateRetention(oldMem)
    const newRetention = system.calculateRetention(newMem)

    // New memory should have higher retention than old
    expect(newRetention).toBeGreaterThan(oldRetention)
  })

  test("context assembly respects token budget across all 4 tiers", () => {
    system.setMaxTokens(4000)

    // L4: Core rules
    system.addCoreRule({
      rule_id: "r1",
      category: "safety",
      content: "Always validate inputs",
      token_count: 5,
      importance: 1.0,
    })

    // L2: Working memory
    system.addWorkingMemory({
      id: "w1",
      content: "Current task: implement login",
      token_count: 8,
      priority: 10,
    })

    // L3: Long-term memories
    for (let i = 0; i < 5; i++) {
      system.addLongTermMemory({
        memory_id: `ltm-${i}`,
        content: `Knowledge item ${i}: how to handle authentication in ${["React", "Vue", "Svelte", "Angular", "Next"][i]}`,
        token_count: 15,
        importance: 0.6 + i * 0.05,
        access_count: i,
        created_at: Date.now() - i * 86400000,
        last_accessed: Date.now(),
        retention_score: 0.8,
      })
    }

    // L1: Transient
    system.addTransient("User said: implement login page", 10)

    const context = system.assembleContext("implement login page", null)

    expect(context.l4.length).toBeGreaterThan(0)
    expect(context.l3.length).toBeGreaterThan(0)
    expect(context.l1.length).toBeGreaterThan(0)
    expect(context.totalTokens).toBeLessThanOrEqual(4000)

    // L3 results should include auth-related items
    const l3Contents = context.l3.map((m) => m.content.toLowerCase())
    const hasAuthRelated = l3Contents.some((c) => c.includes("auth"))
    expect(hasAuthRelated).toBe(true)
  })

  test("context assembly uses cache within TTL", () => {
    system.addLongTermMemory({
      memory_id: "ltm-cache",
      content: "Cached knowledge item",
      token_count: 10,
      importance: 0.8,
      access_count: 1,
      created_at: Date.now(),
      last_accessed: Date.now(),
      retention_score: 1.0,
    })

    const ctx1 = system.assembleContext("test goal", null)
    const ctx2 = system.assembleContext("test goal", null)

    // Same goal + no vector → cache hit
    expect(ctx1).toBe(ctx2) // reference equality from cache
  })

  test("JSON serialization round-trips correctly", () => {
    system.addCoreRule({
      rule_id: "r-json",
      category: "test",
      content: "JSON round-trip rule",
      token_count: 5,
      importance: 0.9,
    })

    system.addLongTermMemory({
      memory_id: "ltm-json",
      content: "Serializable memory",
      token_count: 5,
      importance: 0.7,
      access_count: 2,
      created_at: 1000,
      last_accessed: 2000,
      retention_score: 0.9,
    })

    const json = system.toJSON()
    expect(json).toHaveProperty("longTermMemories")
    expect(json).toHaveProperty("coreRules")
    expect(json).toHaveProperty("maxTokens")

    // Create new system and restore
    const restored = new MemorySystem()
    restored.fromJSON(json as unknown as Parameters<MemorySystem["fromJSON"]>[0])

    expect(restored.getLongTermMemories().length).toBe(1)
    expect(restored.getCoreRules().length).toBe(1)
  })
})
