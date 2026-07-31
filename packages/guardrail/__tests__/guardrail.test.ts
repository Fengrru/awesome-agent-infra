import { describe, expect, test } from "bun:test"
import {
  DEFAULT_ENTROPY_CONFIG,
  EntropyController,
  type EntropyMetrics,
  type RiskLevel,
  describeRisk,
  isDestructive,
  requiresConfirmation,
} from "../src/index"

function makeMetrics(overrides?: Partial<EntropyMetrics>): EntropyMetrics {
  return {
    totalSteps: 10,
    retryCount: 0,
    consecutiveFailures: 0,
    cumulativeTokens: 10000,
    executionTimeMs: 5000,
    validationPassRate: 1.0,
    resultDivergence: 0.0,
    ...overrides,
  }
}

describe("Risk helpers", () => {
  test("describeRisk returns correct labels", () => {
    expect(describeRisk(0)).toBe("read-only")
    expect(describeRisk(1)).toBe("local-modify")
    expect(describeRisk(2)).toBe("global-impact")
    expect(describeRisk(3)).toBe("destructive")
  })

  test("describeRisk returns unknown for invalid level", () => {
    expect(describeRisk(99 as RiskLevel)).toBe("unknown")
  })

  test("isDestructive returns true for level >= 3", () => {
    expect(isDestructive(0)).toBe(false)
    expect(isDestructive(1)).toBe(false)
    expect(isDestructive(2)).toBe(false)
    expect(isDestructive(3)).toBe(true)
  })

  test("requiresConfirmation returns true for level >= 2", () => {
    expect(requiresConfirmation(0)).toBe(false)
    expect(requiresConfirmation(1)).toBe(false)
    expect(requiresConfirmation(2)).toBe(true)
    expect(requiresConfirmation(3)).toBe(true)
  })
})

describe("EntropyController", () => {
  test("with clean metrics returns CONTINUE", () => {
    const ctrl = new EntropyController()
    const action = ctrl.evaluate(makeMetrics())
    expect(action).toBe("CONTINUE")
  })

  test("token budget exceeded returns TERMINATE", () => {
    const ctrl = new EntropyController()
    const action = ctrl.evaluate(
      makeMetrics({
        cumulativeTokens: DEFAULT_ENTROPY_CONFIG.tokenBudget + 1,
      }),
    )
    expect(action).toBe("TERMINATE")
  })

  test("tokens above 90% returns ALERT", () => {
    const ctrl = new EntropyController()
    const action = ctrl.evaluate(
      makeMetrics({
        cumulativeTokens: DEFAULT_ENTROPY_CONFIG.tokenBudget * 0.92,
      }),
    )
    expect(action).toBe("ALERT")
  })

  test("high contradiction entropy returns PAUSE", () => {
    const ctrl = new EntropyController()
    const action = ctrl.evaluate(
      makeMetrics({
        contradictionEntropy: 0.6,
      }),
    )
    expect(action).toBe("PAUSE")
  })

  test("moderate contradiction entropy returns DEGRADE", () => {
    const ctrl = new EntropyController()
    const action = ctrl.evaluate(
      makeMetrics({
        contradictionEntropy: 0.4,
      }),
    )
    expect(action).toBe("DEGRADE")
  })

  test("consecutive failures over limit returns DEGRADE", () => {
    const ctrl = new EntropyController()
    const action = ctrl.evaluate(
      makeMetrics({
        consecutiveFailures: DEFAULT_ENTROPY_CONFIG.maxConsecutiveFailures + 1,
      }),
    )
    expect(action).toBe("DEGRADE")
  })

  test("research mode downgrades PAUSE instead of DEGRADE/ROLLBACK", () => {
    const ctrl = new EntropyController()
    ctrl.enableResearchMode()
    const action = ctrl.evaluate(
      makeMetrics({
        consecutiveFailures: DEFAULT_ENTROPY_CONFIG.maxConsecutiveFailures + 1,
      }),
    )
    expect(action).toBe("PAUSE")
  })

  test("high divergence with significant token usage returns PAUSE", () => {
    const ctrl = new EntropyController()
    const action = ctrl.evaluate(
      makeMetrics({
        resultDivergence: DEFAULT_ENTROPY_CONFIG.maxResultDivergence + 0.1,
        cumulativeTokens: DEFAULT_ENTROPY_CONFIG.tokenBudget * 0.6,
      }),
    )
    expect(action).toBe("PAUSE")
  })

  test("low divergence with high token usage returns CONTINUE", () => {
    const ctrl = new EntropyController()
    const action = ctrl.evaluate(
      makeMetrics({
        resultDivergence: DEFAULT_ENTROPY_CONFIG.maxResultDivergence + 0.1,
        cumulativeTokens: DEFAULT_ENTROPY_CONFIG.tokenBudget * 0.4,
      }),
    )
    expect(action).toBe("CONTINUE")
  })

  test("low validation pass rate returns ROLLBACK", () => {
    const ctrl = new EntropyController()
    const action = ctrl.evaluate(
      makeMetrics({
        validationPassRate: 0.1,
      }),
    )
    expect(action).toBe("ROLLBACK")
  })

  test("research mode vs non-research mode on validation", () => {
    const ctrlNon = new EntropyController()
    const ctrlResearch = new EntropyController()
    ctrlResearch.enableResearchMode()
    const goodMetrics = makeMetrics({
      validationPassRate: DEFAULT_ENTROPY_CONFIG.minValidationPassRate - 0.05,
    })
    expect(ctrlNon.evaluate(goodMetrics)).toBe("ROLLBACK")
    expect(ctrlResearch.evaluate(goodMetrics)).toBe("PAUSE")
  })

  test("research mode on consecutive failures returns PAUSE", () => {
    const ctrl = new EntropyController()
    ctrl.enableResearchMode()
    const action = ctrl.evaluate(
      makeMetrics({
        consecutiveFailures: DEFAULT_ENTROPY_CONFIG.maxConsecutiveFailures + 2,
      }),
    )
    expect(action).toBe("PAUSE")
  })

  test("getActionHistory returns actions", () => {
    const ctrl = new EntropyController()
    ctrl.evaluate(makeMetrics())
    ctrl.evaluate(makeMetrics({ consecutiveFailures: 5 }))
    const history = ctrl.getActionHistory()
    expect(history.length).toBe(2)
    expect(history[0]!.action).toBeDefined()
    expect(history[0]!.timestamp).toBeDefined()
    expect(history[0]!.reason).toBeDefined()
  })

  test("reset clears action history", () => {
    const ctrl = new EntropyController()
    ctrl.evaluate(makeMetrics())
    ctrl.reset()
    expect(ctrl.getActionHistory().length).toBe(0)
  })

  test("updateConfig changes behavior", () => {
    const ctrl = new EntropyController()
    ctrl.updateConfig({ maxConsecutiveFailures: 1 })
    const action = ctrl.evaluate(makeMetrics({ consecutiveFailures: 2 }))
    expect(action).toBe("DEGRADE")
  })

  test("custom config on construction", () => {
    const ctrl = new EntropyController({ tokenBudget: 100 })
    const action = ctrl.evaluate(makeMetrics({ cumulativeTokens: 101 }))
    expect(action).toBe("TERMINATE")
  })

  test("stale node metrics do not crash evaluation", () => {
    const ctrl = new EntropyController()
    const action = ctrl.evaluate(
      makeMetrics({
        staleNodeCount: 5,
        totalMemoryNodes: 10,
      }),
    )
    expect(action).toBe("CONTINUE")
  })
})
