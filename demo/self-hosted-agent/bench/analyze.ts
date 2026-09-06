// Offline analysis of a completed experiment directory. Usage:
//   bun run bench/analyze.ts [experiment]   (default: e1-glm)
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import type { RunRecord } from "./runner.js"

const experiment = process.argv[2] ?? "e1-glm"
const dir = join(import.meta.dirname, "results", experiment)

const records: RunRecord[] = readdirSync(dir)
  .filter((f) => f.endsWith(".json") && f !== "summary.json")
  .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as RunRecord)
  .sort((a, b) => a.system.localeCompare(b.system) || a.task_id.localeCompare(b.task_id) || a.seed - b.seed)

if (records.length === 0) {
  console.error(`no records found in ${dir}`)
  process.exit(1)
}

const systems = [...new Set(records.map((r) => r.system))]
const avg = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length)

console.log(`# ${experiment}: ${records.length} runs, model=${records[0]!.protocol.model}\n`)

// --- overall ---
console.log("## Overall")
console.log("| system | runs | success | avgSteps | avgTokens | avgMs | errors |")
console.log("|---|---|---|---|---|---|---|")
for (const s of systems) {
  const rs = records.filter((r) => r.system === s)
  const errors = rs.filter((r) => r.stopped === "error" || r.teach_stopped === "error").length
  console.log(
    `| ${s} | ${rs.length} | ${((rs.filter((r) => r.success).length / rs.length) * 100).toFixed(0)}% | ` +
      `${avg(rs.map((r) => r.steps)).toFixed(1)} | ${Math.round(avg(rs.map((r) => r.total_tokens)))} | ` +
      `${Math.round(avg(rs.map((r) => r.duration_ms)))} | ${errors} |`,
  )
}

// --- by task group ---
const groups = [...new Set(records.map((r) => r.task_id.split("/")[0]!))]
console.log("\n## Success by task group (passed/total)")
console.log(`| group | ${systems.join(" | ")} |`)
console.log(`|---|${systems.map(() => "---").join("|")}|`)
for (const g of groups) {
  const cells = systems.map((s) => {
    const rs = records.filter((r) => r.system === s && r.task_id.startsWith(`${g}/`))
    return `${rs.filter((r) => r.success).length}/${rs.length}`
  })
  console.log(`| ${g} | ${cells.join(" | ")} |`)
}

// --- per-task head-to-head ---
console.log("\n## Per-task results (per seed) ")
const tasks = [...new Set(records.map((r) => r.task_id))]
console.log(`| task | ${systems.join(" | ")} |`)
console.log(`|---|${systems.map(() => "---").join("|")}|`)
for (const t of tasks) {
  const cells = systems.map((s) => {
    const rs = records.filter((r) => r.system === s && r.task_id === t).sort((a, b) => a.seed - b.seed)
    return rs.map((r) => (r.success ? "P" : r.stopped === "error" ? "E" : "F")).join("")
  })
  console.log(`| ${t} | ${cells.join(" | ")} |`)
}

// --- seed vs rag differentiation ---
console.log("\n## seed vs rag disagreements (tasks where the systems diverge)")
let disagreements = 0
for (const t of tasks) {
  const sp = records.filter((r) => r.system === "seed" && r.task_id === t && r.success).length
  const rp = records.filter((r) => r.system === "rag" && r.task_id === t && r.success).length
  if (sp !== rp) {
    disagreements++
    console.log(`- ${t}: seed ${sp} vs rag ${rp} (${sp > rp ? "seed wins" : "rag wins"})`)
  }
}
if (disagreements === 0) console.log("- none: seed and rag never diverged")

// --- data quality ---
const errors = records.filter((r) => r.stopped === "error" || r.teach_stopped === "error")
const noTokens = records.filter((r) => !r.tokens_reported_by_provider)
const maxSteps = records.filter((r) => r.stopped === "max_steps")
console.log("\n## Data quality")
console.log(
  `- error stops: ${errors.length}${errors.length > 0 ? ` (${errors.map((r) => `${r.system}/${r.task_id}/s${r.seed}`).join(", ")})` : ""}`,
)
console.log(`- runs missing provider token usage: ${noTokens.length}`)
console.log(`- runs hitting max_steps: ${maxSteps.length}`)
