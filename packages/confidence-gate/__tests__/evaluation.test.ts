import { describe, expect, test } from "bun:test"
import { evaluateModel, unknownQuestionAccuracy } from "../src/index.js"
import { spearmanR } from "../src/index.js"

// ─── evaluateModel ──────────────────────────────────────────────────────────

describe("evaluateModel", () => {
  test("empty input returns zeroed report", () => {
    const report = evaluateModel([], [], [])
    expect(report.numSamples).toBe(0)
    expect(report.ece).toBe(0)
    expect(report.brier).toBe(0)
    expect(report.pearsonR).toBe(0)
    expect(report.spearmanR).toBe(0)
    expect(report.hallucinationRate).toBe(0)
    expect(report.difficultyBins).toEqual([])
    expect(report.summary).toBe("No samples")
  })

  test("slices all arrays to the shortest length", () => {
    const report = evaluateModel([0.9, 0.8], [true, true, true], [0.2, 0.5, 0.8])
    expect(report.numSamples).toBe(2)
  })

  test("well-calibrated model yields low ECE and three difficulty bins", () => {
    const confidences: number[] = []
    const correctness: boolean[] = []
    const difficulties: number[] = []
    for (let i = 0; i < 120; i++) {
      // confidence tracks difficulty: easy → high confidence & correct
      const difficulty = [0.2, 0.5, 0.8][i % 3]!
      const c = difficulty === 0.2 ? 0.9 : difficulty === 0.5 ? 0.7 : 0.55
      confidences.push(c)
      // per-bin accuracy matches confidence → well calibrated, accuracy > 0
      correctness.push(i % 10 < (difficulty === 0.2 ? 9 : difficulty === 0.5 ? 7 : 5))
      difficulties.push(difficulty)
    }

    const report = evaluateModel(confidences, correctness, difficulties)
    expect(report.numSamples).toBe(120)
    expect(report.ece).toBeLessThan(0.3)
    expect(report.brier).toBeGreaterThan(0)
    expect(report.difficultyBins).toHaveLength(3)
    expect(report.difficultyBins.map((b) => b.label)).toEqual(["easy", "medium", "hard"])
    for (const bin of report.difficultyBins) {
      expect(bin.count).toBe(40)
      expect(bin.accuracy).toBeGreaterThan(0)
      expect(bin.avgConfidence).toBeGreaterThan(0)
      expect(bin.ece).toBeGreaterThanOrEqual(0)
    }
    expect(report.reliabilityCurve.length).toBeGreaterThan(0)
    expect(report.summary).toContain("ECE=")
    expect(report.optimalTemperature).toBeGreaterThan(0)
    expect(report.dynamicThreshold).toBeGreaterThanOrEqual(0)
  })

  test("hard questions poorly calibrated is flagged in summary", () => {
    const confidences = Array.from({ length: 90 }, (_, i) => (i < 30 ? 0.95 : i < 60 ? 0.7 : 0.55))
    const correctness = Array.from({ length: 90 }, (_, i) => (i < 30 ? true : i < 60 ? true : i % 2 === 0))
    const difficulties = Array.from({ length: 90 }, (_, i) => (i < 30 ? 0.2 : i < 60 ? 0.5 : 0.8))

    const report = evaluateModel(confidences, correctness, difficulties)
    // hard bin: 0.55 confidence, ~50% accuracy → poorly calibrated
    const hardBin = report.difficultyBins.find((b) => b.label === "hard")
    expect(hardBin).toBeDefined()
    expect(hardBin!.ece).toBeGreaterThan(0.1)
    expect(report.summary).toContain("Hard questions poorly calibrated")
  })

  test("custom config is honored", () => {
    const report = evaluateModel([0.9, 0.7, 0.5], [true, true, false], [0.2, 0.5, 0.8], {
      eceBins: 3,
      hallucinationThreshold: 0.6,
    })
    expect(report.numSamples).toBe(3)
    expect(report.hallucinationRate).toBeGreaterThanOrEqual(0)
  })
})

// ─── unknownQuestionAccuracy ────────────────────────────────────────────────

describe("unknownQuestionAccuracy", () => {
  test("fills all four quadrants correctly", () => {
    const confidences = [0.9, 0.9, 0.1, 0.1] // answer, answer, reject, reject
    const correctness = [true, false, false, true] // Q1, Q4, Q3, Q2
    const result = unknownQuestionAccuracy(confidences, correctness, 0.5)

    expect(result.confusionMatrix).toEqual({
      trueAnswerTrueReject: 1,
      trueAnswerFalseReject: 1,
      falseAnswerTrueReject: 1,
      falseAnswerFalseReject: 1,
    })
    expect(result.answerAccuracy).toBe(0.5) // 1 of 2 answers correct
    expect(result.rejectAccuracy).toBe(0.5) // 1 of 2 rejects correct
    expect(result.overallAccuracy).toBe(0.5) // 2 of 4 correct decisions
    expect(result.decisionF1).toBeCloseTo(0.5, 5)
  })

  test("perfect gating yields 100% metrics", () => {
    const confidences = [0.95, 0.9, 0.1, 0.2]
    const correctness = [true, true, false, false]
    const result = unknownQuestionAccuracy(confidences, correctness, 0.5)

    expect(result.answerAccuracy).toBe(1)
    expect(result.rejectAccuracy).toBe(1)
    expect(result.overallAccuracy).toBe(1)
    expect(result.decisionF1).toBe(1)
  })

  test("empty input is safe", () => {
    const result = unknownQuestionAccuracy([], [], 0.5)
    expect(result.overallAccuracy).toBe(0)
    expect(result.decisionF1).toBe(0)
    expect(result.answerAccuracy).toBe(0)
    expect(result.rejectAccuracy).toBe(0)
  })

  test("always answering gives zero reject accuracy", () => {
    const result = unknownQuestionAccuracy([0.9, 0.8, 0.7], [true, false, true], 0.5)
    expect(result.rejectAccuracy).toBe(0)
    expect(result.answerAccuracy).toBeCloseTo(2 / 3, 5)
  })
})

// ─── spearmanR ──────────────────────────────────────────────────────────────

describe("spearmanR", () => {
  test("monotonic increasing series has ρ = 1", () => {
    expect(spearmanR([1, 2, 3, 4, 5], [10, 20, 30, 40, 50])).toBeCloseTo(1, 10)
  })

  test("monotonic decreasing series has ρ = -1", () => {
    expect(spearmanR([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1, 10)
  })

  test("tied ranks use average-rank tie breaking", () => {
    const rho = spearmanR([1, 1, 2, 2, 3], [1, 1, 2, 2, 3])
    expect(rho).toBeCloseTo(1, 10)
  })

  test("fewer than two samples returns 0", () => {
    expect(spearmanR([1], [1])).toBe(0)
    expect(spearmanR([], [])).toBe(0)
  })
})
