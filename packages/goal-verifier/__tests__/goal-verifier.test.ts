import { describe, expect, test } from "bun:test"
import {
  DEFAULT_GOAL_VERIFIER_CONFIG,
  type GoalContext,
  GoalVerifier,
  type ProviderAdapter,
  createGoalVerifier,
} from "../src/index"

function makeContext(overrides?: Partial<GoalContext>): GoalContext {
  return {
    goal: "Implement user authentication",
    conversationSummary: "We discussed JWT-based auth.",
    dagProgress: { total: 5, completed: 3, failed: 0, pending: 2 },
    sessionId: "session_1",
    retryCount: 0,
    ...overrides,
  }
}

describe("GoalVerifier", () => {
  // ── Heuristic (no provider) ─────────────────────────────────────────────

  test("heuristic: all tasks completed returns satisfied", async () => {
    const v = new GoalVerifier()
    const result = await v.verify(
      makeContext({
        dagProgress: { total: 5, completed: 5, failed: 0, pending: 0 },
      }),
    )
    expect(result.satisfied).toBe(true)
    expect(result.confidence).toBe(0.8)
  })

  test("heuristic: high completion with low failure returns satisfied", async () => {
    const v = new GoalVerifier()
    const result = await v.verify(
      makeContext({
        dagProgress: { total: 10, completed: 9, failed: 1, pending: 0 },
      }),
    )
    expect(result.satisfied).toBe(true)
    expect(result.confidence).toBe(0.6)
  })

  test("heuristic: moderate completion returns not satisfied", async () => {
    const v = new GoalVerifier()
    const result = await v.verify(
      makeContext({
        dagProgress: { total: 10, completed: 5, failed: 2, pending: 3 },
      }),
    )
    expect(result.satisfied).toBe(false)
    expect(result.confidence).toBeGreaterThanOrEqual(0.5)
  })

  test("heuristic: no tasks returns not satisfied", async () => {
    const v = new GoalVerifier()
    const result = await v.verify(
      makeContext({
        dagProgress: { total: 0, completed: 0, failed: 0, pending: 0 },
      }),
    )
    expect(result.satisfied).toBe(false)
    expect(result.confidence).toBe(0.3)
  })

  test("heuristic: low completion returns not satisfied with high confidence", async () => {
    const v = new GoalVerifier()
    const result = await v.verify(
      makeContext({
        dagProgress: { total: 10, completed: 2, failed: 3, pending: 5 },
      }),
    )
    expect(result.satisfied).toBe(false)
    expect(result.confidence).toBe(0.9)
  })

  // ── Dead-loop protection ────────────────────────────────────────────────

  test("forces satisfied when retryCount >= maxRetries", async () => {
    const v = new GoalVerifier({ maxRetries: 3 })
    const result = await v.verify(
      makeContext({
        retryCount: 3,
        dagProgress: { total: 10, completed: 0, failed: 10, pending: 0 },
      }),
    )
    expect(result.satisfied).toBe(true)
    expect(result.confidence).toBe(0.5)
  })

  test("retryCount below maxRetries does not trigger dead-loop", async () => {
    const v = new GoalVerifier({ maxRetries: 3 })
    const result = await v.verify(
      makeContext({
        retryCount: 2,
        dagProgress: { total: 10, completed: 0, failed: 0, pending: 10 },
      }),
    )
    expect(result.satisfied).toBe(false)
  })

  // ── LLM Provider ────────────────────────────────────────────────────────

  test("uses provider when set", async () => {
    const v = new GoalVerifier()
    const mockProvider: ProviderAdapter = {
      chat: async () => ({
        content: JSON.stringify({
          satisfied: true,
          confidence: 0.95,
          evidence: "All 5 tasks completed successfully.",
        }),
      }),
    }
    v.setProvider(mockProvider)
    const result = await v.verify(
      makeContext({
        dagProgress: { total: 5, completed: 5, failed: 0, pending: 0 },
      }),
    )
    expect(result.satisfied).toBe(true)
    expect(result.confidence).toBe(0.95)
  })

  test("provider returns impossible task", async () => {
    const v = new GoalVerifier()
    const mockProvider: ProviderAdapter = {
      chat: async () => ({
        content: JSON.stringify({
          satisfied: false,
          confidence: 0.9,
          impossible: true,
          impossible_reason: "Missing API key for external service",
        }),
      }),
    }
    v.setProvider(mockProvider)
    const result = await v.verify(makeContext())
    expect(result.satisfied).toBe(false)
    expect(result.impossible).toBe(true)
    expect(result.impossible_reason).toBe("Missing API key for external service")
  })

  test("provider returns with gaps and suggestions", async () => {
    const v = new GoalVerifier()
    const mockProvider: ProviderAdapter = {
      chat: async () => ({
        content: JSON.stringify({
          satisfied: false,
          confidence: 0.7,
          gap: "Unit tests not written",
          suggestions: ["Write tests for auth module", "Add integration tests"],
        }),
      }),
    }
    v.setProvider(mockProvider)
    const result = await v.verify(makeContext())
    expect(result.satisfied).toBe(false)
    expect(result.gap).toBe("Unit tests not written")
    expect(result.suggestions!.length).toBe(2)
  })

  test("provider parse failure falls back to heuristic", async () => {
    const v = new GoalVerifier()
    const mockProvider: ProviderAdapter = {
      chat: async () => ({ content: "not valid json!" }),
    }
    v.setProvider(mockProvider)
    const result = await v.verify(
      makeContext({
        dagProgress: { total: 5, completed: 5, failed: 0, pending: 0 },
      }),
    )
    expect(result.satisfied).toBe(true)
    expect(result.confidence).toBe(0.8)
  })

  test("provider error falls back to heuristic", async () => {
    const v = new GoalVerifier()
    const mockProvider: ProviderAdapter = {
      chat: async () => {
        throw new Error("Network error")
      },
    }
    v.setProvider(mockProvider)
    const result = await v.verify(
      makeContext({
        dagProgress: { total: 5, completed: 5, failed: 0, pending: 0 },
      }),
    )
    expect(result.satisfied).toBe(true)
    expect(result.confidence).toBe(0.8)
  })

  // ── Default config ──────────────────────────────────────────────────────

  test("uses default config", () => {
    expect(DEFAULT_GOAL_VERIFIER_CONFIG.maxRetries).toBe(3)
    expect(DEFAULT_GOAL_VERIFIER_CONFIG.temperature).toBe(0.1)
    expect(DEFAULT_GOAL_VERIFIER_CONFIG.maxTokens).toBe(2000)
  })

  test("custom config on construction", () => {
    const v = new GoalVerifier({ maxRetries: 5 })
    expect(v.config.maxRetries).toBe(5)
  })

  // ── Stop conditions ─────────────────────────────────────────────────────

  test("context can include stop conditions", async () => {
    const v = new GoalVerifier()
    const result = await v.verify(
      makeContext({
        stopConditions: ["max tokens exceeded"],
      }),
    )
    expect(result.satisfied).toBeDefined()
  })
})

describe("createGoalVerifier factory", () => {
  test("returns a GoalVerifier instance", () => {
    const v = createGoalVerifier()
    expect(v).toBeInstanceOf(GoalVerifier)
    expect(v.config.maxRetries).toBe(DEFAULT_GOAL_VERIFIER_CONFIG.maxRetries)
  })

  test("forwards custom config", () => {
    const v = createGoalVerifier({ maxRetries: 7 })
    expect(v.config.maxRetries).toBe(7)
  })
})
