import { createConfidenceGate } from "../packages/confidence-gate/src/index.ts"
/**
 * confidence-gate — calibration fitting + per-output gating throughput.
 *
 * Run: bun bench confidence-gate.bench.ts
 */
import { bench, run } from "./bench-utils.ts"

const gate = createConfidenceGate()

const SAMPLES = Array.from({ length: 500 }, (_, i) => ({
  predictedConfidence: 0.2 + ((i * 37) % 80) / 100,
  actualCorrect: (i * 7) % 10 < 6,
}))

bench("fit calibration (500 samples)", () => {
  gate.fit(SAMPLES)
})

bench("calibrate single output", () => {
  gate.calibrate(0.83)
})

bench("evaluate batch (500 samples)", () => {
  gate.evaluate(SAMPLES)
})

await run()
