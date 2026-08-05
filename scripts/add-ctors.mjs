import fs from "node:fs"

const targets = [
  ["packages/agent-memory/src/index.ts", "MemorySystem", false],
  ["packages/agent-metacog/src/baselines.ts", "CalibrationBaselines", false],
  ["packages/agent-metacog/src/health.ts", "SleepConsolidator", false],
  ["packages/agentic-search/src/index.ts", "SearchToolRegistry", false],
  ["packages/code-sandbox/src/index.ts", "LogicVerifier", false],
  ["packages/codegraph/src/callsite.ts", "CallSiteStore", false],
  ["packages/codegraph/src/graph.ts", "CodeGraph", false],
  ["packages/embedding/src/providers.ts", "EmbeddingProviderRegistry", false],
  ["packages/hallucination-detector/src/index.ts", "SpectralHallucinationDetector", true],
  ["packages/healix/src/index.ts", "ErrorClassifier", false],
  ["packages/healix/src/index.ts", "RepairMemoryEngine", false],
  ["packages/llm-dag-generator/src/index.ts", "LLMDAGGenerator", true],
  ["packages/memory-engine-v2/src/stores.ts", "LongTermMemory", false],
  ["packages/memory-engine-v2/src/stores.ts", "EpisodicMemory", false],
  ["packages/memory-engine-v2/src/stores.ts", "SemanticMemory", false],
  ["packages/pomdp-planner/src/index.ts", "StateHasher", false],
  ["packages/process-reward/src/inference.ts", "StepSegmenter", false],
  ["packages/process-reward/src/inference.ts", "VerifierPool", false],
  ["packages/reasoning-search/src/metrics.ts", "MetricCalculator", false],
  ["packages/skillforge/src/index.ts", "SkillSystem", false],
  ["packages/tracing/src/index.ts", "NoOpSpan", false],
  ["packages/tracing/src/index.ts", "NoOpTracer", false],
  ["packages/txn-fs/src/index.ts", "GitTransactionManager", false],
]

function findClassBody(code, name) {
  const re = new RegExp(`(?:export\\s+)?(?:abstract\\s+)?class\\s+${name}[^{]*\\{`)
  const m = re.exec(code)
  if (!m) return null
  const bodyStart = m.index + m[0].length - 1
  let depth = 1
  let i = bodyStart + 1
  while (i < code.length && depth > 0) {
    if (code[i] === "{") depth++
    else if (code[i] === "}") depth--
    i++
  }
  return { bodyStart, bodyEnd: i, brace: bodyStart }
}

for (const [file, clsName, needsSuper] of targets) {
  const code = fs.readFileSync(file, "utf8")
  const loc = findClassBody(code, clsName)
  if (!loc) {
    console.log(`NOT FOUND: ${file} :: ${clsName}`)
    continue
  }
  // Check whether a constructor already exists
  const body = code.slice(loc.bodyStart, loc.bodyEnd)
  if (/\bconstructor\s*\(/.test(body)) {
    console.log(`SKIP (has ctor): ${file} :: ${clsName}`)
    continue
  }
  const ctor = needsSuper ? "constructor() {\n    super()\n  }" : "constructor() {}"
  const indent = code.slice(loc.bodyStart + 1, loc.bodyStart + 3) === "\n  " ? "  " : "  "
  const insert = `\n${indent}${ctor}\n`
  const updated = code.slice(0, loc.brace + 1) + insert + code.slice(loc.brace + 1)
  fs.writeFileSync(file, updated)
  console.log(`PATCHED: ${file} :: ${clsName}`)
}
console.log("done")
