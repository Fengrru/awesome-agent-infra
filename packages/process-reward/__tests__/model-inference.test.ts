import { describe, expect, test } from "bun:test"
import {
  type GenerateFn,
  GuidedInferenceEngine,
  type PRMModelData,
  ProcessRewardModel,
  StepSegmenter,
  VerifierPool,
  createProcessRewardModel,
  loadPRMModel,
  savePRMModel,
} from "../src/index.js"

// ─── ProcessRewardModel ─────────────────────────────────────────────────────

describe("ProcessRewardModel", () => {
  test("scoreStep returns a bounded heuristic score", async () => {
    const model = new ProcessRewardModel({ labelingStrategy: "heuristic" })
    const result = await model.scoreStep("Start", "2 + 2 = 4, therefore the sum is 4", undefined, "math")
    expect(result.method).toBe("heuristic")
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(1)
    expect(result.confidence).toBe(0.7)
  })

  test("batchScoreSteps assigns sequential step indices", async () => {
    const model = new ProcessRewardModel()
    const results = await model.batchScoreSteps(["s0", "s1", "s2"], ["a0", "a1", "a2"])
    expect(results).toHaveLength(3)
    expect(results.map((r) => r.stepIndex)).toEqual([0, 1, 2])
  })

  test("scorePath scores every step of a reasoning chain", async () => {
    const model = new ProcessRewardModel({ labelingStrategy: "heuristic" })
    const steps = ["Let x = 5", "Then 2x = 10", "Therefore the answer is 10"]
    const scores = await model.scorePath(steps, undefined, "math")
    expect(scores).toHaveLength(3)
    for (const [i, s] of scores.entries()) {
      expect(s.stepIndex).toBe(i)
      expect(s.score).toBeGreaterThanOrEqual(0)
      expect(s.score).toBeLessThanOrEqual(1)
    }
  })

  test("scorePathHeuristic works synchronously without LLM callbacks", () => {
    const model = new ProcessRewardModel()
    const scores = model.scorePathHeuristic(["step one", "step two"])
    expect(scores).toHaveLength(2)
    expect(scores.every((s) => s.method === "heuristic")).toBe(true)
  })

  test("labelSteps falls back to weak supervision without MC callbacks", async () => {
    const model = new ProcessRewardModel({ labelingStrategy: "hybrid" })
    const { labels, confidences } = await model.labelSteps(["a", "b"], true)
    expect(labels).toHaveLength(2)
    expect(confidences).toEqual([0.6, 0.6])
    for (const label of labels) {
      expect(label).toBeGreaterThanOrEqual(0)
      expect(label).toBeLessThanOrEqual(1)
    }
  })

  test("labelSteps uses MC rollout when callbacks are provided", async () => {
    const model = new ProcessRewardModel({ labelingStrategy: "mc_rollout", numRollouts: 2 })
    const generateFn: GenerateFn = async (_state, n) => Array.from({ length: n }, (_, i) => `completion ${i}`)
    const { labels, confidences } = await model.labelSteps(["step"], true, "general", {
      generateFn,
      verifyFn: () => true,
      referenceAnswer: "42",
    })
    expect(labels).toHaveLength(1)
    expect(labels[0]).toBeGreaterThan(0.5) // all rollouts verified correct
    expect(confidences[0]).toBeGreaterThan(0)
  })

  test("registerScorer and unregisterScorer manage custom scorers", () => {
    const model = new ProcessRewardModel()
    model.registerScorer("custom", () => 0.42)
    expect(model.unregisterScorer("custom")).toBe(true)
    expect(model.unregisterScorer("custom")).toBe(false)
  })

  test("updateConfig changes the labeling strategy", () => {
    const model = new ProcessRewardModel()
    expect(model.labelingStrategy).toBe("hybrid")
    model.updateConfig({ labelingStrategy: "heuristic" })
    expect(model.labelingStrategy).toBe("heuristic")
  })

  test("createProcessRewardModel forwards constructor arguments", () => {
    const model = createProcessRewardModel({ numRollouts: 3 })
    expect(model).toBeInstanceOf(ProcessRewardModel)
    expect(model.numRollouts).toBe(3)
  })
})

// ─── savePRMModel / loadPRMModel ────────────────────────────────────────────

describe("savePRMModel / loadPRMModel", () => {
  test("round-trips config through serialization", () => {
    const model = new ProcessRewardModel({ labelingStrategy: "heuristic", numRollouts: 5 })
    const data = savePRMModel(model, { note: "unit-test" })
    expect(data.version).toBe("1.0.0")
    expect(data.config.labelingStrategy).toBe("heuristic")
    expect(data.config.numRollouts).toBe(5)
    expect(data.metadata).toEqual({ note: "unit-test" })

    const restored = loadPRMModel(data)
    expect(restored.labelingStrategy).toBe("heuristic")
    expect(restored.numRollouts).toBe(5)
  })

  test("loadPRMModel accepts hand-written model data", () => {
    const data: PRMModelData = {
      version: "1.0.0",
      config: {
        labelingStrategy: "mc_rollout",
        numRollouts: 2,
        confidenceWeighting: true,
        maxContextTokens: 256,
        minConfidence: 0.5,
      },
      heuristicConfig: {},
      trainedWeights: null,
      metadata: {},
    }
    const model = loadPRMModel(data)
    expect(model.labelingStrategy).toBe("mc_rollout")
    expect(model.numRollouts).toBe(2)
  })
})

// ─── StepSegmenter ──────────────────────────────────────────────────────────

describe("StepSegmenter", () => {
  test("classify identifies implications, equations, assertions, and conclusions", () => {
    expect(StepSegmenter.classify("Therefore x must be positive")).toBe("implication")
    expect(StepSegmenter.classify("x = 42")).toBe("equation")
    expect(StepSegmenter.classify("Assume n is even")).toBe("assertion")
    expect(StepSegmenter.classify("In conclusion the statement holds")).toBe("conclusion")
    expect(StepSegmenter.classify("some plain narrative text")).toBe("unknown")
  })

  test("segment splits a reasoning path into indexed steps", () => {
    const text = "Assume x is even\n\nx = 2k\n\nTherefore x is divisible by 2"
    const steps = StepSegmenter.segment(text)
    expect(steps).toHaveLength(3)
    expect(steps.map((s) => s.index)).toEqual([0, 1, 2])
    expect(steps[0]?.kind).toBe("assertion")
    expect(steps[1]?.kind).toBe("equation")
    expect(steps[2]?.kind).toBe("implication")
  })

  test("kindToTaskType maps kinds to task domains", () => {
    expect(StepSegmenter.kindToTaskType("equation")).toBe("math")
    expect(StepSegmenter.kindToTaskType("assertion")).toBe("logic")
    expect(StepSegmenter.kindToTaskType("implication")).toBe("logic")
    expect(StepSegmenter.kindToTaskType("conclusion")).toBe("logic")
    expect(StepSegmenter.kindToTaskType("unknown")).toBe("general")
  })
})

// ─── VerifierPool ───────────────────────────────────────────────────────────

describe("VerifierPool", () => {
  test("verifyMath matches GSM8K #### answers and comma numbers", () => {
    expect(VerifierPool.verifyMath("#### 1,234", "1234").correct).toBe(true)
    expect(VerifierPool.verifyMath("3/4", "0.75").correct).toBe(true)
    expect(VerifierPool.verifyMath("42", "43").correct).toBe(false)
  })

  test("verifyMath tolerates tiny float differences", () => {
    const result = VerifierPool.verifyMath("0.333333", "0.333334")
    expect(result.correct).toBe(true)
    expect(result.verifier).toBe("math_float")
  })

  test("verifyCode blocks dangerous modules and built-ins", () => {
    expect(VerifierPool.verifyCode("import os\nos.system('ls')").correct).toBe(false)
    expect(VerifierPool.verifyCode("eval('1+1')").correct).toBe(false)
  })

  test("verifyCode accepts well-structured code", () => {
    const result = VerifierPool.verifyCode("def add(a, b):\n    return a + b")
    expect(result.correct).toBe(true)
    expect(result.verifier).toBe("code_structure")
  })

  test("verifyLogic handles exact, contradiction, and partial matches", () => {
    expect(VerifierPool.verifyLogic("True", "true").correct).toBe(true)
    expect(VerifierPool.verifyLogic("this is a contradiction", "the statement holds").correct).toBe(false)
    expect(VerifierPool.verifyLogic("the answer is yes", "yes").correct).toBe(true)
  })

  test("verify dispatches by task type", () => {
    expect(VerifierPool.verify("42", "42", "math").correct).toBe(true)
    expect(VerifierPool.verify("exact", "exact", "general").verifier).toBe("general_exact")
    expect(VerifierPool.verify("a", "b", "general").correct).toBe(false)
  })
})

// ─── GuidedInferenceEngine ──────────────────────────────────────────────────

describe("GuidedInferenceEngine", () => {
  test("generates a PRM-guided path and stops at a conclusion", async () => {
    const prm = new ProcessRewardModel({ labelingStrategy: "heuristic" })
    let callCount = 0
    const generateFn: GenerateFn = async (_state, n) => {
      callCount++
      if (callCount >= 3) return ["Therefore the answer is 42"]
      return Array.from({ length: n }, (_, i) => `step ${callCount}, candidate ${i}: x = ${i}`)
    }

    const engine = new GuidedInferenceEngine(prm, generateFn, 3)
    const { path, scores } = await engine.generate("What is 6 * 7?", 10, "math")
    expect(path.length).toBe(3)
    expect(path[path.length - 1]).toContain("Therefore")
    expect(scores).toHaveLength(path.length)
  })

  test("stops when the generator returns no candidates", async () => {
    const prm = new ProcessRewardModel()
    const engine = new GuidedInferenceEngine(prm, async () => [], 4)
    const { path, scores } = await engine.generate("problem")
    expect(path).toEqual([])
    expect(scores).toEqual([])
  })

  test("respects the maxSteps limit", async () => {
    const prm = new ProcessRewardModel()
    const engine = new GuidedInferenceEngine(prm, async (_s, n) => Array.from({ length: n }, (_, i) => `step ${i}`), 2)
    const { path } = await engine.generate("problem", 3)
    expect(path.length).toBeLessThanOrEqual(3)
    expect(path.length).toBeGreaterThan(0)
  })
})
