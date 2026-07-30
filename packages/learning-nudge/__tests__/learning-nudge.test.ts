import { describe, expect, test } from "bun:test"
import {
  LearningNudge,
  type ProviderAdapter,
  type IProjectMemory,
  type ISkillManager,
} from "../src/index"

class FakeMemory implements IProjectMemory {
  entries: Array<{ section: string; content: string; confidence: number }> = []
  failNext = false
  async upsertEntry(entry: { section: string; content: string; confidence: number } & Record<string, unknown>) {
    if (this.failNext) { this.failNext = false; throw new Error("db down") }
    this.entries.push({ section: entry.section, content: entry.content, confidence: entry.confidence })
    return entry
  }
}

class FakeSkills implements ISkillManager {
  created: Array<{ name: string; category: string }> = []
  async createSkill(skill: { name: string; category: string } & Record<string, unknown>) {
    this.created.push({ name: skill.name, category: skill.category })
    return skill
  }
}

function providerReturning(content: string): ProviderAdapter {
  return { async chat() { return { content } } }
}

const INSIGHT_JSON = JSON.stringify({
  insights: [
    { type: "facts", content: "API rate limit is 100/min", confidence: 0.9 },
    { type: "patterns", content: "retry with backoff works", confidence: 0.8, should_be_skill: true, skill_name: "retry-backoff" },
    { type: "facts", content: "low confidence guess", confidence: 0.3 },
  ],
  summary: "productive session",
})

describe("evaluate", () => {
  test("no nudge before minToolCalls", () => {
    const nudge = new LearningNudge({ periodicInterval: 3, minToolCalls: 5 })
    expect(nudge.evaluate(1)).toBeNull()
    expect(nudge.evaluate(1)).toBeNull()
    expect(nudge.evaluate(1)).toBeNull() // interval hit but below minToolCalls
    expect(nudge.evaluate(1)).toBeNull()
  })

  test("periodic nudge fires after interval and minToolCalls", () => {
    const nudge = new LearningNudge({ periodicInterval: 5, minToolCalls: 5 })
    for (let i = 0; i < 4; i++) expect(nudge.evaluate(1)).toBeNull()
    const action = nudge.evaluate(1)
    expect(action!.type).toBe("periodic")
    expect(nudge.hasPending()).toBe(true)
  })

  test("no duplicate periodic nudge while one is pending", () => {
    const nudge = new LearningNudge({ periodicInterval: 2, minToolCalls: 1 })
    nudge.evaluate(1)
    expect(nudge.evaluate(1)!.type).toBe("periodic")
    expect(nudge.evaluate(1)).toBeNull() // pending blocks another
  })

  test("pattern detection fires at every patternThreshold successes", () => {
    const nudge = new LearningNudge({ patternThreshold: 3, periodicInterval: 100, minToolCalls: 100 })
    expect(nudge.evaluate(1, "cap-x", true)).toBeNull()
    expect(nudge.evaluate(1, "cap-x", true)).toBeNull()
    const action = nudge.evaluate(1, "cap-x", true)
    expect(action!.type).toBe("pattern_detection")
    expect(action!.capabilityId).toBe("cap-x")

    // 4th and 5th success: silent; 6th fires again (count % threshold === 0)
    expect(nudge.evaluate(1, "cap-x", true)).toBeNull()
    expect(nudge.evaluate(1, "cap-x", true)).toBeNull()
    expect(nudge.evaluate(1, "cap-x", true)!.type).toBe("pattern_detection")
  })

  test("failed calls do not count toward patterns", () => {
    const nudge = new LearningNudge({ patternThreshold: 2, periodicInterval: 100, minToolCalls: 100 })
    expect(nudge.evaluate(1, "cap-x", false)).toBeNull()
    expect(nudge.evaluate(1, "cap-x", false)).toBeNull()
    expect(nudge.getPatternStats().get("cap-x")).toBeUndefined()
  })
})

describe("executeNudge", () => {
  test("without provider returns empty result and clears pending", async () => {
    const nudge = new LearningNudge({ periodicInterval: 1, minToolCalls: 1 })
    nudge.evaluate(1)
    const result = await nudge.executeNudge("s1", ["step"])
    expect(result.hasInsights).toBe(false)
    expect(nudge.hasPending()).toBe(false)
  })

  test("persists high-confidence insights and creates suggested skills", async () => {
    const nudge = new LearningNudge()
    const memory = new FakeMemory()
    const skills = new FakeSkills()
    nudge.setProvider(providerReturning(INSIGHT_JSON))
    nudge.setProjectMemory(memory)
    nudge.setSkillManager(skills)

    const result = await nudge.executeNudge("s1", ["did a thing"])
    expect(result.hasInsights).toBe(true)
    // confidence 0.3 insight is filtered (< 0.5)
    expect(result.memoryEntries).toBe(2)
    expect(memory.entries.map((e) => e.section)).toEqual(["facts", "patterns"])
    expect(result.skillSuggestions).toBe(1)
    expect(skills.created[0]!.name).toBe("retry-backoff")
    expect(skills.created[0]!.category).toBe("auto-generated")
  })

  test("non-JSON provider output yields no insights without throwing", async () => {
    const nudge = new LearningNudge()
    nudge.setProvider(providerReturning("sorry, no json here"))
    const result = await nudge.executeNudge("s1", ["x"])
    expect(result.hasInsights).toBe(false)
    expect(result.errors).toEqual([])
  })

  test("provider failure is captured in errors", async () => {
    const nudge = new LearningNudge()
    nudge.setProvider({ async chat() { throw new Error("llm offline") } })
    const result = await nudge.executeNudge("s1", ["x"])
    expect(result.errors[0]).toContain("llm offline")
  })

  test("memory persistence failure is isolated per-insight", async () => {
    const nudge = new LearningNudge()
    const memory = new FakeMemory()
    memory.failNext = true
    nudge.setProvider(providerReturning(INSIGHT_JSON))
    nudge.setProjectMemory(memory)

    const result = await nudge.executeNudge("s1", ["x"])
    // first insight failed, second succeeded
    expect(result.memoryEntries).toBe(1)
    expect(result.errors.length).toBe(1)
    expect(result.errors[0]).toContain("db down")
  })
})

describe("sessionEndNudge", () => {
  test("returns reflection content alongside persisted insights", async () => {
    const nudge = new LearningNudge()
    const memory = new FakeMemory()
    nudge.setProvider(providerReturning(INSIGHT_JSON))
    nudge.setProjectMemory(memory)

    const result = await nudge.sessionEndNudge("s1", "fix bug", 20, 18, 2, ["e1", "e2"])
    expect(result.hasInsights).toBe(true)
    expect(result.reflection).toBe(INSIGHT_JSON)
    expect(result.memoryEntries).toBe(2)
  })

  test("without provider is a silent no-op", async () => {
    const nudge = new LearningNudge()
    const result = await nudge.sessionEndNudge("s1", "goal", 0, 0, 0, [])
    expect(result.hasInsights).toBe(false)
    expect(result.errors).toEqual([])
  })
})

describe("userDeclarationNudge", () => {
  test("persists immediately to project memory", async () => {
    const nudge = new LearningNudge()
    const memory = new FakeMemory()
    nudge.setProjectMemory(memory)

    const result = await nudge.userDeclarationNudge("s1", "always deploy on fridays... not")
    expect(result.hasInsights).toBe(true)
    expect(result.memoryEntries).toBe(1)
    expect(memory.entries[0]!.confidence).toBe(0.9)
  })

  test("without memory manager reports no insights", async () => {
    const nudge = new LearningNudge()
    const result = await nudge.userDeclarationNudge("s1", "remember me")
    expect(result.hasInsights).toBe(false)
  })

  test("persistence failure lands in errors", async () => {
    const nudge = new LearningNudge()
    const memory = new FakeMemory()
    memory.failNext = true
    nudge.setProjectMemory(memory)
    const result = await nudge.userDeclarationNudge("s1", "x")
    expect(result.hasInsights).toBe(false)
    expect(result.errors[0]).toContain("db down")
  })
})

describe("state management", () => {
  test("reset clears counters, patterns and pending flag", () => {
    const nudge = new LearningNudge({ periodicInterval: 1, minToolCalls: 1 })
    nudge.evaluate(1, "cap-x", true)
    expect(nudge.getToolCallCount()).toBe(1)
    nudge.reset()
    expect(nudge.getToolCallCount()).toBe(0)
    expect(nudge.getPatternStats().size).toBe(0)
    expect(nudge.hasPending()).toBe(false)
  })

  test("getPatternStats returns a defensive copy", () => {
    const nudge = new LearningNudge()
    nudge.evaluate(1, "cap-x", true)
    const stats = nudge.getPatternStats()
    stats.set("cap-x", 999)
    expect(nudge.getPatternStats().get("cap-x")).toBe(1)
  })
})
