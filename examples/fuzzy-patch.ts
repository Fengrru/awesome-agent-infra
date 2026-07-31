/**
 * fuzzy-patch — 8-strategy fuzzy file patching.
 *
 * Run: bun run fuzzy-patch.ts
 */
import { availableStrategies, canPatch, fuzzyFindAndReplace } from "../packages/fuzzy-patch/src/index.ts"

const source = `const config = {
  port:   3000,
  host:  "localhost",
}`

console.log("available strategies:", availableStrategies(source, "port: 3000").join(", "))
console.log("can patch:", canPatch(source, "port: 3000"))

// exact match on the original text (including original spacing)
const result = fuzzyFindAndReplace(source, "port:   3000", "port:   8080")
console.log(`\npatched (strategy: ${result.strategy}, count: ${result.matchCount}):`)
console.log(result.newContent)

// fuzzy matching tolerates whitespace drift in the old text
const drifted = fuzzyFindAndReplace(source, 'host: "localhost"', 'host: "0.0.0.0"')
console.log(`drifted match (strategy: ${drifted.strategy}, count: ${drifted.matchCount}):`)
console.log(drifted.newContent)
