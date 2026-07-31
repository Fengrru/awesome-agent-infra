/**
 * guardrail — entropy-based runtime safety gating.
 *
 * Run: bun run guardrail.ts
 */
import { createEntropyController } from "../packages/guardrail/src/index.ts"

const controller = createEntropyController()

// healthy run: high pass rate, low divergence
const healthy = controller.evaluate({
  totalSteps: 100,
  retryCount: 3,
  consecutiveFailures: 0,
  cumulativeTokens: 12_000,
  executionTimeMs: 60_000,
  validationPassRate: 0.96,
  resultDivergence: 0.1,
})
console.log(`healthy -> action=${healthy}`)

// unstable run: many retries, low pass rate, high divergence
const unstable = controller.evaluate({
  totalSteps: 40,
  retryCount: 25,
  consecutiveFailures: 6,
  cumulativeTokens: 50_000,
  executionTimeMs: 300_000,
  validationPassRate: 0.4,
  resultDivergence: 0.7,
})
console.log(`unstable -> action=${unstable}`)
console.log(
  "action history:",
  controller
    .getActionHistory()
    .map((a) => a.action)
    .join(" -> "),
)
