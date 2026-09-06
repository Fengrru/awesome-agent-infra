// Rebuild summary.json for an experiment directory from all result files,
// excluding stale records whose task_hash no longer matches the current task
// definition (e.g. after a task verifier has been tightened mid-experiment).
// Usage: bun run bench/rebuild-summary.ts [experiment]

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { contentHash } from "../src/schema/knowledge.js"
import type { ExperimentSummary, ProtocolSnapshot, RunRecord } from "./runner.js"
import { TASKS } from "./tasks.js"

const experiment = process.argv[2] ?? "e1-glm"
const dir = join(import.meta.dirname, "results", experiment)

const expectedHashes = new Map<string, string>()
for (const task of TASKS) {
  for (const seed of [1, 2, 3]) {
    const instance = task.generate(seed)
    expectedHashes.set(`${task.id}__seed${seed}`, contentHash({ task: task.id, instance }))
  }
}

const records: RunRecord[] = []
let protocol: ProtocolSnapshot | null = null

for (const entry of readdirSync(dir)) {
  if (!entry.endsWith(".json") || entry === "summary.json") continue
  const file = join(dir, entry)
  let r: RunRecord
  try {
    r = JSON.parse(readFileSync(file, "utf8")) as RunRecord
  } catch {
    continue
  }
  const expected = expectedHashes.get(`${r.task_id}__seed${r.seed}`)
  if (expected === undefined || r.task_hash !== expected) {
    console.log(`stale/skipped: ${entry}`)
    continue
  }
  records.push(r)
  if (protocol === null) protocol = r.protocol
}

if (records.length === 0) {
  console.error(`no valid records in ${dir}`)
  process.exit(1)
}

const systems = ["no-mem", "rag", "seed"]
const avg = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length)

const perSystem = systems.map((name) => {
  const rs = records.filter((r) => r.system === name)
  return {
    system: name,
    runs: rs.length,
    successRate: rs.length === 0 ? 0 : rs.filter((r) => r.success).length / rs.length,
    avgSteps: avg(rs.map((r) => r.steps)),
    avgTotalTokens: avg(rs.map((r) => r.total_tokens)),
    avgDurationMs: avg(rs.map((r) => r.duration_ms)),
  }
})

const summary: ExperimentSummary = {
  experiment,
  protocol: protocol!,
  runs: records.length,
  perSystem,
}

mkdirSync(dir, { recursive: true })
const summaryFile = join(dir, "summary.json")
writeFileSync(summaryFile, `${JSON.stringify(summary, null, 2)}\n`)
console.log(`rebuilt summary -> ${summaryFile} (${records.length} valid records)`)
console.log("per system:")
for (const s of perSystem) {
  console.log(
    `  ${s.system.padEnd(7)} runs=${s.runs} success=${(s.successRate * 100).toFixed(0)}% ` +
      `avgSteps=${s.avgSteps.toFixed(1)} avgTokens=${Math.round(s.avgTotalTokens)}`,
  )
}
