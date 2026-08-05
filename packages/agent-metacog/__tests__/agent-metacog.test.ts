import { describe, expect, test } from "bun:test"
import { createConfidenceCalibrator } from "../src/calibrator.js"
import { AgentMetacog, ebbinghausRetention, nextReviewDays } from "../src/index.js"
import {
  addVectors,
  dotProduct,
  matMulVec,
  subMatrices,
  subVectors,
  transpose,
  vectorNorm,
  zeros,
} from "../src/linalg.js"

// ─── Ebbinghaus ─────────────────────────────────────────────────────────────

describe("ebbinghausRetention", () => {
  test("returns 1 at day 0", () => {
    expect(ebbinghausRetention(0, 7)).toBeCloseTo(1, 5)
  })

  test("returns ~0.5 at half-life", () => {
    expect(ebbinghausRetention(7, 7)).toBeCloseTo(0.5, 1)
  })

  test("returns ~0.25 at 2x half-life", () => {
    expect(ebbinghausRetention(14, 7)).toBeCloseTo(0.25, 1)
  })

  test("returns 1 for negative days", () => {
    expect(ebbinghausRetention(-5, 7)).toBe(1)
  })

  test("longer half-life means slower decay", () => {
    const r7 = ebbinghausRetention(7, 7) // ~0.5
    const r14 = ebbinghausRetention(7, 14) // > 0.5
    expect(r14).toBeGreaterThan(r7)
  })
})

describe("nextReviewDays", () => {
  test("returns positive for threshold < 1", () => {
    const days = nextReviewDays(7, 0.5)
    expect(days).toBeCloseTo(7, 0)
  })

  test("higher threshold means sooner review", () => {
    const d05 = nextReviewDays(7, 0.5)
    const d08 = nextReviewDays(7, 0.8)
    expect(d08).toBeLessThan(d05)
  })
})

// ─── AgentMetacog ───────────────────────────────────────────────────────────

describe("AgentMetacog", () => {
  test("recordInteraction tracks successes and failures", () => {
    const metacog = new AgentMetacog()

    metacog.recordInteraction({
      domain: "math",
      query: "What is 2+2?",
      success: true,
      timestamp: new Date(),
      selfConfidence: 0.9,
    })

    metacog.recordInteraction({
      domain: "math",
      query: "What is 2+3?",
      success: true,
      timestamp: new Date(),
      selfConfidence: 0.85,
    })

    metacog.recordInteraction({
      domain: "math",
      query: "What is integral of sin(x)?",
      success: false,
      timestamp: new Date(),
      selfConfidence: 0.6,
      failureReason: "Could not compute integral correctly",
    })

    const knowledge = metacog.assessKnowledge("math")
    expect(knowledge).not.toBeNull()
    expect(knowledge!.successes).toBe(2)
    expect(knowledge!.failures).toBe(1)
    expect(knowledge!.confidence).toBeGreaterThan(0.5)
  })

  test("knowledge boundary separates known from unknown", () => {
    const metacog = new AgentMetacog()

    // Math: 2/3 success
    metacog.recordInteraction({ domain: "math", query: "q1", success: true, timestamp: new Date() })
    metacog.recordInteraction({ domain: "math", query: "q2", success: true, timestamp: new Date() })
    metacog.recordInteraction({ domain: "math", query: "q3", success: false, timestamp: new Date() })

    // Coding: 0/3 success
    metacog.recordInteraction({ domain: "coding", query: "q1", success: false, timestamp: new Date() })
    metacog.recordInteraction({ domain: "coding", query: "q2", success: false, timestamp: new Date() })
    metacog.recordInteraction({ domain: "coding", query: "q3", success: false, timestamp: new Date() })

    const boundary = metacog.getKnowledgeBoundary()
    expect(boundary.knownTopics).toContain("math")
    expect(boundary.unknownTopics).toContain("coding")
  })

  test("detectForgetting returns alerts for old domains", () => {
    const metacog = new AgentMetacog({ decayHalfLifeDays: 1 }) // fast decay for testing

    // Record a success 2 days ago
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    metacog.recordInteraction({
      domain: "ancient_history",
      query: "old stuff",
      success: true,
      timestamp: twoDaysAgo,
    })

    const alerts = metacog.detectForgetting()
    expect(alerts.length).toBe(1)
    expect(alerts[0]!.domain).toBe("ancient_history")
    expect(alerts[0]!.retention).toBeLessThan(0.5)
    expect(["review", "practice", "urgent_review"]).toContain(alerts[0]!.action)
  })

  test("recent interactions do not trigger forgetting alerts", () => {
    const metacog = new AgentMetacog()

    metacog.recordInteraction({
      domain: "fresh",
      query: "new stuff",
      success: true,
      timestamp: new Date(), // just now
    })

    const alerts = metacog.detectForgetting()
    expect(alerts.length).toBe(0)
  })

  test("shouldConsolidate triggers when alerts exist", () => {
    const metacog = new AgentMetacog({ decayHalfLifeDays: 1 })

    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
    metacog.recordInteraction({
      domain: "stale_topic",
      query: "old",
      success: true,
      timestamp: threeDaysAgo,
    })

    const result = metacog.shouldConsolidate()
    expect(result.needed).toBe(true)
    expect(result.reasons.length).toBeGreaterThan(0)
  })

  test("shouldConsolidate returns false when everything is fresh", () => {
    const metacog = new AgentMetacog()
    metacog.recordInteraction({
      domain: "current",
      query: "fresh",
      success: true,
      timestamp: new Date(),
    })

    const result = metacog.shouldConsolidate()
    expect(result.needed).toBe(false)
  })

  test("consolidation queue is generated and maintained", () => {
    const metacog = new AgentMetacog({ decayHalfLifeDays: 1, maxConsolidationQueue: 3 })

    const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000)

    metacog.recordInteraction({ domain: "math", query: "q", success: true, timestamp: daysAgo(5) })
    metacog.recordInteraction({ domain: "coding", query: "q", success: true, timestamp: daysAgo(4) })
    metacog.recordInteraction({ domain: "logic", query: "q", success: true, timestamp: daysAgo(3) })
    metacog.recordInteraction({ domain: "history", query: "q", success: true, timestamp: daysAgo(2) })

    const tasks = metacog.generateConsolidationTasks()
    expect(tasks.length).toBeLessThanOrEqual(3) // capped
    expect(tasks[0]!.priority).toBeGreaterThan(0)
  })

  test("dequeueConsolidation removes and returns task", () => {
    const metacog = new AgentMetacog({ decayHalfLifeDays: 1 })

    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
    metacog.recordInteraction({ domain: "old", query: "q", success: true, timestamp: fiveDaysAgo })

    metacog.generateConsolidationTasks()
    const queue = metacog.getConsolidationQueue()
    expect(queue.length).toBe(1)

    const task = metacog.dequeueConsolidation(queue[0]!.id)
    expect(task).toBeDefined()
    expect(metacog.getConsolidationQueue().length).toBe(0)
  })

  test("dequeueConsolidation returns undefined for bad id", () => {
    const metacog = new AgentMetacog()
    expect(metacog.dequeueConsolidation("nonexistent")).toBeUndefined()
  })

  test("knowledge gaps are tracked and accumulate severity", () => {
    const metacog = new AgentMetacog({ minGapOccurrences: 1 })

    // Record multiple failures with same reason
    for (let i = 0; i < 5; i++) {
      metacog.recordInteraction({
        domain: "calculus",
        query: `integral problem ${i}`,
        success: false,
        timestamp: new Date(),
        failureReason: "Cannot handle improper integrals",
      })
    }

    const gaps = metacog.getActiveGaps()
    const calculusGap = gaps.find((g) => g.domain === "calculus")
    expect(calculusGap).toBeDefined()
    expect(calculusGap!.severity).toBe("critical")
    expect(calculusGap!.occurrenceCount).toBe(5)
  })

  test("clearGapsForDomain removes gaps", () => {
    const metacog = new AgentMetacog()

    metacog.recordInteraction({
      domain: "physics",
      query: "q",
      success: false,
      timestamp: new Date(),
      failureReason: "misunderstood newton laws",
    })

    expect(metacog.getActiveGaps().length).toBeGreaterThan(0)
    metacog.clearGapsForDomain("physics")
    expect(metacog.getActiveGaps().length).toBe(0)
  })

  test("self-reflection generates meaningful text", () => {
    const metacog = new AgentMetacog()

    metacog.recordInteraction({ domain: "math", query: "2+2", success: true, timestamp: new Date() })
    metacog.recordInteraction({ domain: "math", query: "3+3", success: true, timestamp: new Date() })
    metacog.recordInteraction({ domain: "code", query: "write fn", success: false, timestamp: new Date() })

    const reflection = metacog.generateSelfReflection()
    expect(reflection.length).toBeGreaterThan(0)
    expect(typeof reflection).toBe("string")
  })

  test("evaluateMetacognition returns full state", () => {
    const metacog = new AgentMetacog()

    metacog.recordInteraction({
      domain: "math",
      query: "q",
      success: true,
      timestamp: new Date(),
      selfConfidence: 0.9,
    })
    metacog.recordInteraction({
      domain: "physics",
      query: "q",
      success: false,
      timestamp: new Date(),
      selfConfidence: 0.8,
      failureReason: "wrong formula",
    })

    const state = metacog.evaluateMetacognition()
    expect(state.selfAwarenessScore).toBeGreaterThanOrEqual(0)
    expect(state.selfAwarenessScore).toBeLessThanOrEqual(1)
    expect(state.summary.length).toBeGreaterThan(0)
    expect(state.knowledgeGaps.length).toBeGreaterThanOrEqual(0)
    expect(state.forgettingAlerts.length).toBeGreaterThanOrEqual(0)
  })

  test("reset clears all state", () => {
    const metacog = new AgentMetacog()

    metacog.recordInteraction({ domain: "test", query: "q", success: true, timestamp: new Date() })
    metacog.reset()

    expect(metacog.getDomainKnowledge().size).toBe(0)
    expect(metacog.getRecentHistory().length).toBe(0)
    expect(metacog.getConsolidationQueue().length).toBe(0)
    expect(metacog.getActiveGaps().length).toBe(0)
  })

  test("updateConfig changes behavior at runtime", () => {
    const metacog = new AgentMetacog({ decayHalfLifeDays: 7 })

    const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)
    metacog.recordInteraction({ domain: "test", query: "q", success: true, timestamp: oneDayAgo })

    // With 7-day half-life, 1 day shouldn't trigger alert
    let alerts = metacog.detectForgetting()
    expect(alerts.length).toBe(0)

    // Shrink half-life to make it decay faster
    metacog.updateConfig({ decayHalfLifeDays: 0.5 })
    alerts = metacog.detectForgetting()
    expect(alerts.length).toBe(1)
  })

  test("interaction without failure does not create gap", () => {
    const metacog = new AgentMetacog()

    metacog.recordInteraction({
      domain: "math",
      query: "q",
      success: false,
      timestamp: new Date(),
      // no failureReason
    })

    const gaps = metacog.getActiveGaps()
    expect(gaps.length).toBe(0)
  })

  test("getRecentHistory respects count limit", () => {
    const metacog = new AgentMetacog()

    for (let i = 0; i < 10; i++) {
      metacog.recordInteraction({ domain: "test", query: `q${i}`, success: true, timestamp: new Date() })
    }

    expect(metacog.getRecentHistory(3).length).toBe(3)
    expect(metacog.getRecentHistory().length).toBe(10)
  })
})

// ─── Linear Algebra ─────────────────────────────────────────────────────────

describe("matMulVec", () => {
  test("multiplies matrix and vector", () => {
    const M = [
      [1, 2],
      [3, 4],
    ]
    const v = [5, 6]
    const result = matMulVec(M, v)
    expect(result[0]).toBe(1 * 5 + 2 * 6)
    expect(result[1]).toBe(3 * 5 + 4 * 6)
  })
})

describe("transpose", () => {
  test("transposes a matrix", () => {
    const M = [
      [1, 2, 3],
      [4, 5, 6],
    ]
    const result = transpose(M)
    expect(result).toHaveLength(3)
    expect(result[0]!).toEqual([1, 4])
    expect(result[1]!).toEqual([2, 5])
    expect(result[2]!).toEqual([3, 6])
  })
})

describe("addVectors", () => {
  test("adds two vectors element-wise", () => {
    const a = [1, 2, 3]
    const b = [4, 5, 6]
    const result = addVectors(a, b)
    expect(result).toEqual([5, 7, 9])
  })
})

describe("subVectors", () => {
  test("subtracts two vectors element-wise", () => {
    const a = [10, 8, 6]
    const b = [1, 2, 3]
    const result = subVectors(a, b)
    expect(result).toEqual([9, 6, 3])
  })
})

describe("dotProduct", () => {
  test("computes dot product", () => {
    const a = [1, 2, 3]
    const b = [4, 5, 6]
    expect(dotProduct(a, b)).toBe(1 * 4 + 2 * 5 + 3 * 6)
  })
})

describe("vectorNorm", () => {
  test("computes Euclidean norm", () => {
    expect(vectorNorm([3, 4])).toBeCloseTo(5, 5)
    expect(vectorNorm([0, 0])).toBe(0)
  })
})

describe("zeros", () => {
  test("creates a zero-filled matrix", () => {
    const result = zeros(2, 3)
    expect(result).toHaveLength(2)
    expect(result[0]!).toEqual([0, 0, 0])
    expect(result[1]!).toEqual([0, 0, 0])
  })
})

describe("subMatrices", () => {
  test("subtracts two matrices element-wise", () => {
    const a = [
      [5, 4],
      [3, 2],
    ]
    const b = [
      [1, 2],
      [3, 4],
    ]
    const result = subMatrices(a, b)
    expect(result[0]!).toEqual([4, 2])
    expect(result[1]!).toEqual([0, -2])
  })
})

// ─── Calibrator Factory ─────────────────────────────────────────────────────

describe("createConfidenceCalibrator", () => {
  test("creates a calibrator from factory", () => {
    const calibrator = createConfidenceCalibrator(64)
    expect(calibrator).toBeDefined()
    expect(calibrator.config.hiddenDim).toBeGreaterThan(0)
  })
})
