/**
 * confidence-gate — LLM output confidence calibration and gating.
 *
 * Run: bun run confidence-gate.ts
 */
import { createConfidenceGate } from "../packages/confidence-gate/src/index.ts"

const gate = createConfidenceGate()

// fit temperature scaling on labeled calibration samples
gate.fit([
  { predictedConfidence: 0.9, actualCorrect: true },
  { predictedConfidence: 0.8, actualCorrect: true },
  { predictedConfidence: 0.7, actualCorrect: false },
  { predictedConfidence: 0.6, actualCorrect: true },
  { predictedConfidence: 0.5, actualCorrect: false },
  { predictedConfidence: 0.4, actualCorrect: false },
  { predictedConfidence: 0.3, actualCorrect: false },
  { predictedConfidence: 0.2, actualCorrect: true },
])

const report = gate.evaluate([
  { predictedConfidence: 0.85, actualCorrect: true },
  { predictedConfidence: 0.55, actualCorrect: false },
  { predictedConfidence: 0.45, actualCorrect: true },
])
console.log(`calibrated temperature: ${gate.temperature.toFixed(3)}`)
console.log(`ECE: ${report.ece.toFixed(3)}, Brier: ${report.brierScore.toFixed(3)}`)

// gate a live output
const decision = gate.calibrate(0.72)
console.log(
  `live output confidence 0.72 -> calibrated ${decision.confidence.toFixed(3)}, shouldAnswer: ${decision.shouldAnswer}`,
)
