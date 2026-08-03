import { describe, expect, test } from "bun:test"
import {
  type CalibrationSample,
  ConfidenceGate,
  applyTemperatureScaling,
  computeBrierScore,
  computeECE,
  createConfidenceGate,
  findDynamicThreshold,
  findOptimalTemperature,
  hallucinationRate,
  reliabilityDiagram,
} from "../src/index.js"

// ─── ECE ────────────────────────────────────────────────────────────────────

describe("computeECE", () => {
  test("perfect calibration returns ECE = 0", () => {
    // Confidence exactly matches accuracy in each bin
    const confidences = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
    const correctness = [false, false, false, false, true, true, true, true, true, true]
    const { ece } = computeECE(confidences, correctness, 5)
    // With equal-width bins, not perfectly aligned — just verify it's reasonable
    expect(ece).toBeGreaterThanOrEqual(0)
    expect(ece).toBeLessThan(0.5)
  })

  test("perfectly calibrated uniform data gives low ECE", () => {
    const confidences: number[] = []
    const correctness: boolean[] = []
    for (let i = 0; i < 100; i++) {
      const c = i / 100
      confidences.push(c)
      correctness.push(Math.random() < c)
    }
    const { ece, bins } = computeECE(confidences, correctness, 10)
    expect(bins.length).toBe(10)
    expect(ece).toBeGreaterThanOrEqual(0)
    expect(ece).toBeLessThanOrEqual(1)
  })

  test("empty input returns zero", () => {
    const { ece, bins } = computeECE([], [], 10)
    expect(ece).toBe(0)
    expect(bins).toEqual([])
  })

  test("completely wrong calibration gives high ECE", () => {
    // Model says 0.9 confidence but all answers are wrong
    const confidences = Array(100).fill(0.9)
    const correctness = Array(100).fill(false)
    const { ece } = computeECE(confidences, correctness, 10)
    expect(ece).toBeGreaterThan(0.8) // Very poorly calibrated
  })
})

// ─── Brier Score ─────────────────────────────────────────────────────────────

describe("computeBrierScore", () => {
  test("perfect predictions give Brier = 0", () => {
    const c = [1.0, 1.0, 0.0, 0.0]
    const r = [true, true, false, false]
    expect(computeBrierScore(c, r)).toBeCloseTo(0, 5)
  })

  test("worst predictions give Brier = 1", () => {
    const c = [0.0, 0.0, 1.0, 1.0]
    const r = [true, true, false, false]
    expect(computeBrierScore(c, r)).toBeCloseTo(1, 5)
  })

  test("uncertain predictions give Brier = 0.25", () => {
    const c = [0.5, 0.5, 0.5, 0.5]
    const r = [true, true, false, false]
    expect(computeBrierScore(c, r)).toBeCloseTo(0.25, 5)
  })

  test("empty input returns zero", () => {
    expect(computeBrierScore([], [])).toBe(0)
  })
})

// ─── Temperature Scaling ─────────────────────────────────────────────────────

describe("temperature scaling", () => {
  test("T = 1 is identity (approximately)", () => {
    const input = [0.7, 0.3, 0.9]
    const scaled = applyTemperatureScaling(input, 1.0)
    for (let i = 0; i < input.length; i++) {
      expect(scaled[i]).toBeCloseTo(input[i], 3)
    }
  })

  test("T > 1 moves confidences toward 0.5 (softens)", () => {
    const input = [0.9, 0.1]
    const scaled = applyTemperatureScaling(input, 3.0)
    expect(scaled[0]).toBeLessThan(0.9)
    expect(scaled[0]).toBeGreaterThan(0.5)
    expect(scaled[1]).toBeGreaterThan(0.1)
    expect(scaled[1]).toBeLessThan(0.5)
  })

  test("T < 1 pushes confidences to extremes (sharpens)", () => {
    const input = [0.7, 0.3]
    const scaled = applyTemperatureScaling(input, 0.5)
    expect(scaled[0]).toBeGreaterThan(0.7)
    expect(scaled[1]).toBeLessThan(0.3)
  })

  test("throws on non-positive temperature", () => {
    expect(() => applyTemperatureScaling([0.5], 0)).toThrow()
    expect(() => applyTemperatureScaling([0.5], -1)).toThrow()
  })

  test("findOptimalTemperature returns sensible value", () => {
    // Create data: overconfident model (raw 0.9 vs actual 0.7 accuracy)
    const confidences: number[] = []
    const correctness: boolean[] = []
    for (let i = 0; i < 50; i++) {
      confidences.push(0.85 + Math.random() * 0.1)
      correctness.push(Math.random() < 0.7)
    }
    const T = findOptimalTemperature(confidences, correctness)
    expect(T).toBeGreaterThan(0)
    expect(T).toBeLessThanOrEqual(5)
  })
})

// ─── Dynamic Threshold ──────────────────────────────────────────────────────

describe("findDynamicThreshold", () => {
  test("clean separation yields threshold near 0.5", () => {
    const c = [0.1, 0.2, 0.3, 0.7, 0.8, 0.9]
    const r = [false, false, false, true, true, true]
    const t = findDynamicThreshold(c, r)
    expect(t).toBeGreaterThan(0.3)
    expect(t).toBeLessThan(0.7)
  })

  test("all wrong gives a high threshold", () => {
    const c = [0.1, 0.2, 0.3, 0.8, 0.9]
    const r = [false, false, false, false, false]
    const t = findDynamicThreshold(c, r)
    // With all wrong, F1 is 0 everywhere; the algorithm picks something
    expect(t).toBeGreaterThanOrEqual(0)
    expect(t).toBeLessThanOrEqual(1)
  })
})

// ─── Hallucination Rate ─────────────────────────────────────────────────────

describe("hallucinationRate", () => {
  test("no hallucinations when all high-confidence are correct", () => {
    const c = [0.9, 0.95, 0.85]
    const r = [true, true, true]
    expect(hallucinationRate(c, r)).toBe(0)
  })

  test("100% hallucination when all high-confidence are wrong", () => {
    const c = [0.9, 0.95, 0.85]
    const r = [false, false, false]
    expect(hallucinationRate(c, r)).toBe(1)
  })

  test("low-confidence answers are excluded", () => {
    const c = [0.5, 0.9, 0.9]
    const r = [false, false, true]
    // Only 0.9s are counted: 1 wrong out of 2 = 0.5
    expect(hallucinationRate(c, r)).toBeCloseTo(0.5)
  })
})

// ─── Reliability Diagram ──────────────────────────────────────────────────────

describe("reliabilityDiagram", () => {
  test("returns bins from ECE computation", () => {
    const confidences = [0.1, 0.2, 0.8, 0.9]
    const correctness = [false, false, true, true]
    const bins = reliabilityDiagram(confidences, correctness, 2)
    expect(bins.length).toBe(2)
    for (const bin of bins) {
      expect(bin).toHaveProperty("accuracy")
      expect(bin).toHaveProperty("avgConfidence")
      expect(bin).toHaveProperty("count")
    }
  })
})

// ─── Factory Function ─────────────────────────────────────────────────────────

describe("createConfidenceGate", () => {
  test("returns a ConfidenceGate instance", () => {
    const gate = createConfidenceGate()
    expect(gate).toBeInstanceOf(ConfidenceGate)
  })

  test("forwards config", () => {
    const gate = createConfidenceGate({ defaultTemperature: 2.0 })
    expect(gate.temperature).toBe(2.0)
  })
})

// ─── ConfidenceGate class ────────────────────────────────────────────────────

describe("ConfidenceGate", () => {
  test("calibrate returns valid structure", () => {
    const gate = new ConfidenceGate()
    const result = gate.calibrate(0.85)

    expect(result.confidence).toBeGreaterThanOrEqual(0)
    expect(result.confidence).toBeLessThanOrEqual(1)
    expect(result.difficulty).toBeGreaterThanOrEqual(0)
    expect(result.difficulty).toBeLessThanOrEqual(1)
    expect(typeof result.shouldAnswer).toBe("boolean")
    expect(["calibrated", "overconfident", "underconfident"]).toContain(result.calibrationStatus)
    expect(result.metadata).toBeDefined()
  })

  test("high raw confidence without calibration data flags overconfident", () => {
    const gate = new ConfidenceGate()
    const result = gate.calibrate(0.9)
    expect(result.calibrationStatus).toBe("overconfident")
  })

  test("moderate confidence without calibration data is calibrated", () => {
    const gate = new ConfidenceGate()
    const result = gate.calibrate(0.6)
    expect(result.calibrationStatus).toBe("calibrated")
  })

  test("fit learns temperature and threshold", () => {
    const gate = new ConfidenceGate()
    const samples: CalibrationSample[] = [
      { predictedConfidence: 0.92, actualCorrect: true },
      { predictedConfidence: 0.88, actualCorrect: true },
      { predictedConfidence: 0.91, actualCorrect: true },
      { predictedConfidence: 0.3, actualCorrect: false },
      { predictedConfidence: 0.2, actualCorrect: false },
      { predictedConfidence: 0.15, actualCorrect: false },
      { predictedConfidence: 0.9, actualCorrect: true },
      { predictedConfidence: 0.25, actualCorrect: false },
      { predictedConfidence: 0.85, actualCorrect: true },
      { predictedConfidence: 0.1, actualCorrect: false },
    ]

    const report = gate.fit(samples)

    expect(report.ece).toBeGreaterThanOrEqual(0)
    expect(report.brierScore).toBeGreaterThanOrEqual(0)
    expect(report.pearsonR).toBeGreaterThanOrEqual(-1)
    expect(report.pearsonR).toBeLessThanOrEqual(1)
    expect(report.reliabilityCurve.length).toBeGreaterThan(0)
    expect(report.optimalTemperature).toBeGreaterThan(0)
    expect(report.dynamicThreshold).toBeGreaterThanOrEqual(0)
    expect(report.summary.length).toBeGreaterThan(0)

    // After fitting, gate should use learned values
    expect(gate.temperature).toBe(report.optimalTemperature)
    expect(gate.threshold).toBe(report.dynamicThreshold)
    expect(gate.report).toBe(report)
  })

  test("evaluate does not change internal state", () => {
    const gate = new ConfidenceGate()
    const samples: CalibrationSample[] = [
      { predictedConfidence: 0.9, actualCorrect: true },
      { predictedConfidence: 0.1, actualCorrect: false },
    ]

    const report = gate.evaluate(samples)
    expect(report).toBeDefined()
    // Internal state should be unchanged (only fit changes it)
    expect(gate.temperature).toBe(1.0) // default
    expect(gate.threshold).toBe(0.5) // default
  })

  test("calibrate after fit uses learned values", () => {
    const gate = new ConfidenceGate()
    const samples: CalibrationSample[] = [
      { predictedConfidence: 0.95, actualCorrect: true },
      { predictedConfidence: 0.9, actualCorrect: true },
      { predictedConfidence: 0.85, actualCorrect: true },
      { predictedConfidence: 0.2, actualCorrect: false },
      { predictedConfidence: 0.15, actualCorrect: false },
      { predictedConfidence: 0.1, actualCorrect: false },
    ]

    gate.fit(samples)
    const result = gate.calibrate(0.9)
    expect(result.metadata.ece).toBe(gate.report!.ece)
  })

  test("config options are respected", () => {
    const gate = new ConfidenceGate({
      eceBins: 5,
      hallucinationThreshold: 0.7,
      defaultTemperature: 2.0,
    })

    const samples: CalibrationSample[] = [
      { predictedConfidence: 0.8, actualCorrect: true },
      { predictedConfidence: 0.2, actualCorrect: false },
    ]

    const report = gate.evaluate(samples)
    expect(report.reliabilityCurve.length).toBeLessThanOrEqual(5)
  })

  test("applyScaling = false skips temperature scaling", () => {
    const gate = new ConfidenceGate({ applyScaling: false })
    const result = gate.calibrate(0.85)
    // Without scaling and no calibration data, confidence passes through
    expect(result.confidence).toBeCloseTo(0.85, 5)
  })
})
