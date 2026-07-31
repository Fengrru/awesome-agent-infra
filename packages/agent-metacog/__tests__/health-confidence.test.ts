import { describe, expect, test } from "bun:test"
import {
  AgentMetacog,
  type DomainHealthItem,
  type ForgettingAlert,
  type MemoryStatistics,
  SleepConsolidator,
  createAgentMetacog,
  estimateConfidence,
  estimateCoverage,
  estimateQueryComplexity,
  getOptimizationRecommendations,
  isComputationQuery,
  monitorMemoryHealth,
} from "../src/index.js"

// ─── SleepConsolidator ──────────────────────────────────────────────────────

const DAY_MS = 24 * 3600 * 1000

function makeMemories() {
  return [
    { importance: 0.9, accessedAt: new Date() },
    { importance: 0.8, accessedAt: new Date() },
    { importance: 0.7, accessedAt: new Date() },
    { importance: 0.6, accessedAt: new Date() },
    { importance: 0.05, accessedAt: new Date(Date.now() - 10 * DAY_MS) },
    { importance: 0.05, accessedAt: new Date() }, // low importance but recently accessed
  ]
}

describe("SleepConsolidator", () => {
  test("starts awake with zeroed state", () => {
    const sc = new SleepConsolidator()
    expect(sc.currentStage).toBe("awake")
    const state = sc.state
    expect(state.transferredCount).toBe(0)
    expect(state.createdAssociations).toBe(0)
    expect(state.prunedCount).toBe(0)
    expect(state.progress).toBe(0)
  })

  test("advanceStage walks through the sleep stages in order", () => {
    const sc = new SleepConsolidator()
    const memories = makeMemories()
    expect(sc.advanceStage(memories).currentStage).toBe("n1_light_sleep")
    expect(sc.advanceStage(memories).currentStage).toBe("n2_light_sleep")
    expect(sc.advanceStage(memories).currentStage).toBe("n3_slow_wave")
    expect(sc.advanceStage(memories).currentStage).toBe("rem")
    expect(sc.advanceStage(memories).currentStage).toBe("consolidation")
    expect(sc.advanceStage(memories).currentStage).toBe("awake")
  })

  test("n3 transfers important memories, rem creates associations, consolidation prunes", () => {
    const sc = new SleepConsolidator()
    const memories = makeMemories()
    sc.advanceStage(memories) // n1
    sc.advanceStage(memories) // n2
    let state = sc.advanceStage(memories) // n3_slow_wave
    expect(state.transferredCount).toBe(4) // importance > 0.5
    state = sc.advanceStage(memories) // rem
    expect(state.createdAssociations).toBe(Math.floor(4 * 0.3))
    state = sc.advanceStage(memories) // consolidation
    expect(state.prunedCount).toBe(1) // importance < 0.1 AND stale > 7 days
  })

  test("progress increases monotonically until consolidation", () => {
    const sc = new SleepConsolidator()
    let prev = sc.state.progress
    for (let i = 0; i < 5; i++) {
      const state = sc.advanceStage([])
      expect(state.progress).toBeGreaterThan(prev)
      prev = state.progress
    }
    expect(prev).toBe(1)
  })

  test("runFullCycle completes a cycle and returns to awake", () => {
    const sc = new SleepConsolidator()
    const state = sc.runFullCycle(makeMemories())
    expect(state.currentStage).toBe("awake")
    expect(state.transferredCount).toBe(4)
    expect(state.prunedCount).toBe(1)
  })

  test("reset restores the initial state", () => {
    const sc = new SleepConsolidator()
    sc.runFullCycle(makeMemories())
    sc.reset()
    expect(sc.currentStage).toBe("awake")
    expect(sc.state.transferredCount).toBe(0)
    expect(sc.state.createdAssociations).toBe(0)
    expect(sc.state.prunedCount).toBe(0)
  })
})

// ─── monitorMemoryHealth ────────────────────────────────────────────────────

describe("monitorMemoryHealth", () => {
  test("empty metacog reports zero domains and a default recommendation", () => {
    const report = monitorMemoryHealth(new AgentMetacog())
    expect(report.domainCount).toBe(0)
    expect(report.avgConfidence).toBe(0)
    expect(report.avgRetention).toBe(0)
    expect(report.domainHealth).toEqual([])
    expect(report.recommendations.length).toBeGreaterThan(0)
  })

  test("recently practiced successful domain is healthy", () => {
    const metacog = new AgentMetacog()
    for (let i = 0; i < 5; i++) {
      metacog.recordInteraction({ domain: "math", query: `q${i}`, success: true, timestamp: new Date() })
    }
    const report = monitorMemoryHealth(metacog)
    expect(report.domainCount).toBe(1)
    expect(report.domainHealth[0]?.domain).toBe("math")
    expect(report.domainHealth[0]?.retention).toBeGreaterThan(0.9)
    expect(report.healthScore).toBeGreaterThan(0)
    expect(report.healthScore).toBeLessThanOrEqual(1)
  })

  test("failures create gaps that lower the health score", () => {
    const healthy = new AgentMetacog()
    for (let i = 0; i < 5; i++) {
      healthy.recordInteraction({ domain: "math", query: `q${i}`, success: true, timestamp: new Date() })
    }
    const struggling = new AgentMetacog()
    for (let i = 0; i < 5; i++) {
      struggling.recordInteraction({
        domain: "math",
        query: "same failing query",
        success: false,
        timestamp: new Date(),
        failureReason: "wrong formula",
      })
    }
    const healthyReport = monitorMemoryHealth(healthy)
    const strugglingReport = monitorMemoryHealth(struggling)
    expect(strugglingReport.healthScore).toBeLessThan(healthyReport.healthScore)
    expect(strugglingReport.activeGaps).toBeGreaterThan(0)
  })
})

// ─── getOptimizationRecommendations ─────────────────────────────────────────

function domain(overrides: Partial<DomainHealthItem>): DomainHealthItem {
  return { domain: "d", confidence: 0.9, retention: 0.9, gapCount: 0, status: "healthy", ...overrides }
}

describe("getOptimizationRecommendations", () => {
  test("returns positive default message when everything is healthy", () => {
    const recs = getOptimizationRecommendations([domain({})], [], 0)
    expect(recs).toHaveLength(1)
    expect(recs[0]).toContain("Memory health is good")
  })

  test("flags critical domains as URGENT", () => {
    const recs = getOptimizationRecommendations([domain({ domain: "math", status: "critical" })], [], 0)
    expect(recs.some((r) => r.startsWith("URGENT") && r.includes("math"))).toBe(true)
  })

  test("flags at-risk domains", () => {
    const recs = getOptimizationRecommendations([domain({ status: "at_risk" })], [], 0)
    expect(recs.some((r) => r.includes("at risk"))).toBe(true)
  })

  test("flags urgent-review forgetting alerts", () => {
    const alerts: ForgettingAlert[] = [{ domain: "math", retention: 0.1, daysSinceAccess: 30, action: "urgent_review" }]
    const recs = getOptimizationRecommendations([domain({})], alerts, 0)
    expect(recs.some((r) => r.includes("urgent review"))).toBe(true)
  })

  test("flags a high consolidation backlog", () => {
    const recs = getOptimizationRecommendations([domain({})], [], 6)
    expect(recs.some((r) => r.includes("backlog"))).toBe(true)
  })

  test("recommends fundamental review when no domain is healthy", () => {
    const recs = getOptimizationRecommendations([domain({ status: "critical" })], [], 0)
    expect(recs.some((r) => r.includes("No healthy domains"))).toBe(true)
  })

  test("flags low-confidence domains and low-retention domains with gaps", () => {
    const recs = getOptimizationRecommendations(
      [domain({ confidence: 0.2, retention: 0.3, gapCount: 2, status: "critical" })],
      [],
      0,
    )
    expect(recs.some((r) => r.includes("Low confidence"))).toBe(true)
    expect(recs.some((r) => r.includes("low retention and active gaps"))).toBe(true)
  })
})

// ─── Confidence estimation ──────────────────────────────────────────────────

function stats(overrides: Partial<MemoryStatistics>): MemoryStatistics {
  return { totalMemories: 100, domainMemories: 50, recentRatio: 0.5, successRate: 0.5, averageAgeDays: 5, ...overrides }
}

describe("estimateConfidence", () => {
  test("stays within [0, 1]", () => {
    expect(estimateConfidence("simple question", stats({}))).toBeGreaterThanOrEqual(0)
    expect(
      estimateConfidence(
        "simple",
        stats({ totalMemories: 1000, domainMemories: 1000, recentRatio: 1, successRate: 1 }),
      ),
    ).toBeLessThanOrEqual(1)
  })

  test("higher success rate raises confidence", () => {
    const low = estimateConfidence("question", stats({ successRate: 0.1 }))
    const high = estimateConfidence("question", stats({ successRate: 0.9 }))
    expect(high).toBeGreaterThan(low)
  })

  test("complex queries get lower confidence than simple ones", () => {
    const simple = estimateConfidence("capital of France", stats({}))
    const complex = estimateConfidence(
      "explain and analyze why the distributed database transaction algorithm is better versus the alternative, prove the trade-off",
      stats({}),
    )
    expect(complex).toBeLessThan(simple)
  })
})

describe("estimateQueryComplexity", () => {
  test("empty query returns 0.3", () => {
    expect(estimateQueryComplexity("")).toBe(0.3)
    expect(estimateQueryComplexity("   ")).toBe(0.3)
  })

  test("clamps to a minimum of 0.1", () => {
    expect(estimateQueryComplexity("hi")).toBe(0.1)
  })

  test("reasoning and technical terms increase complexity", () => {
    const simple = estimateQueryComplexity("what time is it")
    const complex = estimateQueryComplexity(
      "explain why the transformer embedding gradient behaves this way, then prove it and compare versus the alternative",
    )
    expect(complex).toBeGreaterThan(simple)
    expect(complex).toBeLessThanOrEqual(1)
  })
})

describe("isComputationQuery", () => {
  test("detects explicit computation verbs", () => {
    expect(isComputationQuery("calculate the area of a circle")).toBe(true)
    expect(isComputationQuery("solve for x")).toBe(true)
  })

  test("detects arithmetic expressions and open equations", () => {
    expect(isComputationQuery("12 + 34")).toBe(true)
    expect(isComputationQuery("x = ?")).toBe(true)
  })

  test("detects unit conversions", () => {
    expect(isComputationQuery("what is 10 miles in km")).toBe(true)
    expect(isComputationQuery("convert 3 km to miles")).toBe(true)
  })

  test("rejects non-computation queries", () => {
    expect(isComputationQuery("who wrote Hamlet")).toBe(false)
    expect(isComputationQuery("describe the plot of the novel")).toBe(false)
  })
})

describe("estimateCoverage", () => {
  test("returns 0 with no memories at all", () => {
    expect(estimateCoverage("anything", stats({ totalMemories: 0, domainMemories: 0 }))).toBe(0)
  })

  test("returns 0.1 with no domain memories", () => {
    expect(estimateCoverage("anything", stats({ totalMemories: 10, domainMemories: 0 }))).toBe(0.1)
  })

  test("keyword-rich queries get a coverage boost", () => {
    const s = stats({ totalMemories: 100, domainMemories: 40, recentRatio: 0.4 })
    const sparse = estimateCoverage("hi", s)
    const rich = estimateCoverage("neural network training convergence analysis", s)
    expect(rich).toBeGreaterThan(sparse)
    expect(rich).toBeLessThanOrEqual(1)
  })
})

// ─── Factory ────────────────────────────────────────────────────────────────

describe("createAgentMetacog", () => {
  test("returns a working AgentMetacog instance", () => {
    const metacog = createAgentMetacog({ decayHalfLifeDays: 3 })
    expect(metacog).toBeInstanceOf(AgentMetacog)
    metacog.recordInteraction({ domain: "code", query: "q", success: true, timestamp: new Date() })
    expect(metacog.assessKnowledge("code")?.successes).toBe(1)
  })
})
