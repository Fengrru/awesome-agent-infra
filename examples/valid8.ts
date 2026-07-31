/**
 * valid8 — 4-layer output validation network.
 *
 * Run: bun run valid8.ts
 */
import { createValidationNetwork } from "../packages/valid8/src/index.ts"

const network = createValidationNetwork()

const goodCode = "export function add(a: number, b: number) {\n  return a + b\n}\n"
const badCode = "export function broken( {\n  return a +\n"

// layer 1: syntax validation (TypeScript AST)
const syntax = await network.runSyntaxValidation(goodCode, "add.ts")
console.log("syntax (good):", syntax.score, "-", syntax.report)
const syntaxBad = await network.runSyntaxValidation(badCode, "broken.ts")
console.log("syntax (bad):", syntaxBad.score, "-", syntaxBad.report.slice(0, 80))

// layer 4: security validation
const security = await network.runSecurityValidation(goodCode)
console.log("security:", security.score, "-", security.report)

// combined confidence across layers
const confidence = network.calculateConfidence([syntax, security])
console.log(
  `overall confidence: ${confidence.toFixed(2)} (threshold ${network.getThreshold()}, retries left ${network.getMaxRetries()})`,
)
