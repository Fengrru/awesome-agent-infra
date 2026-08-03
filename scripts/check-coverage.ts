/**
 * Coverage gate for core packages.
 *
 * Runs `bun test --coverage` per package (lcov reporter) and aggregates
 * line coverage over `src/` files only (tests, dist, and generated files are
 * excluded). Fails with exit code 1 when any gated package is below its
 * threshold.
 *
 * Usage:
 *   bun run scripts/check-coverage.ts            # check thresholds
 *   bun run scripts/check-coverage.ts --report   # print coverage, no gate
 */
import { spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

interface LcovRecord {
  file: string
  linesFound: number
  linesHit: number
}

/** package name -> minimum line coverage (%) */
const THRESHOLDS: Record<string, number> = {
  "agent-checkpoint": 100,
  "agent-memory": 100,
  "agent-metacog": 100,
  "agentic-search": 100,
  archiver: 100,
  branch: 100,
  "checkpoint-writer": 100,
  "code-sandbox": 100,
  codegraph: 100,
  "confidence-gate": 100,
  "cycle-controller": 100,
  dreamdistill: 100,
  "dynamic-workflow": 100,
  embedding: 100,
  "engine-db": 100,
  "event-bus": 100,
  "fuzzy-patch": 100,
  "goal-verifier": 100,
  guardrail: 100,
  "hallucination-detector": 100,
  healix: 100,
  "internal-tfidf": 100,
  "learning-nudge": 100,
  "lifecycle-manager": 100,
  "llm-dag-generator": 100,
  "max-mode-sampler": 100,
  "memory-engine-v2": 100,
  "memory-graph": 100,
  "notes-manager": 100,
  "pomdp-planner": 100,
  "process-reward": 100,
  "project-memory": 100,
  "reasoning-search": 100,
  replay: 100,
  "skill-curator": 100,
  skillforge: 100,
  "state-machine": 100,
  taskdag: 100,
  tracing: 100,
  "txn-fs": 100,
  valid8: 100,
  worker: 100,
}

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..")
const PKG_DIR = join(ROOT, "packages")
const REPORT_ONLY = process.argv.includes("--report")

function runTest(pkg: string): Promise<{ ok: boolean; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      "bun",
      ["test", "__tests__", "--coverage", "--coverage-reporter=lcov", "--coverage-dir=.coverage"],
      { cwd: join(PKG_DIR, pkg), windowsHide: true },
    )
    let stderr = ""
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on("close", (code) => {
      resolve({ ok: code === 0, stderr })
    })
  })
}

function isSrcFile(record: LcovRecord): boolean {
  const p = record.file.replace(/\\/g, "/")
  if (p.includes("__tests__")) return false
  if (p.includes("/dist/") || p.startsWith("dist/")) return false
  if (p.startsWith(".") || p.includes("/.")) return false
  if (p.includes("node_modules")) return false
  return p.startsWith("src/") || p.includes("/src/")
}

function parseLcov(content: string): LcovRecord[] {
  const records: LcovRecord[] = []
  let current: LcovRecord | null = null
  for (const line of content.split("\n")) {
    if (line.startsWith("SF:")) {
      current = { file: line.slice(3).trim(), linesFound: 0, linesHit: 0 }
      records.push(current)
    } else if (current && line.startsWith("LF:")) {
      current.linesFound = Number(line.slice(3))
    } else if (current && line.startsWith("LH:")) {
      current.linesHit = Number(line.slice(3))
    }
  }
  return records
}

async function runWithLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items]
  const workers = Array.from({ length: limit }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()!
      await fn(item)
    }
  })
  await Promise.all(workers)
}

async function main(): Promise<void> {
  const names = Object.keys(THRESHOLDS)
  const results: Array<{ pkg: string; covered: number; total: number; percent: number; failed: boolean }> = []

  // Run packages with a concurrency limit to avoid resource contention
  await runWithLimit(names, 4, async (pkg) => {
    const { ok } = await runTest(pkg)
    if (!ok) {
      results.push({ pkg, covered: 0, total: 0, percent: 0, failed: true })
      return
    }
    const lcovPath = join(PKG_DIR, pkg, ".coverage", "lcov.info")
    if (!existsSync(lcovPath)) {
      results.push({ pkg, covered: 0, total: 0, percent: 0, failed: true })
      return
    }
    const records = parseLcov(readFileSync(lcovPath, "utf-8")).filter(isSrcFile)
    const covered = records.reduce((s, r) => s + r.linesHit, 0)
    const total = records.reduce((s, r) => s + r.linesFound, 0)
    const percent = total > 0 ? (covered / total) * 100 : 0
    results.push({
      pkg,
      covered,
      total,
      percent,
      failed: false,
    })
  })

  results.sort((a, b) => a.percent - b.percent)
  const width = Math.max(...results.map((r) => r.pkg.length), 16)
  console.log(`${"package".padEnd(width)}  covered/total    %      threshold`)
  for (const r of results) {
    const threshold = THRESHOLDS[r.pkg] ?? 0
    const flag = r.failed ? "  FAILED" : r.percent < threshold ? "  BELOW" : ""
    console.log(
      `${r.pkg.padEnd(width)}  ${String(r.covered).padStart(7)}/${String(r.total).padEnd(5)}  ${r.percent.toFixed(1).padStart(5)}%    ${threshold}%${flag}`,
    )
  }

  const below = results.filter((r) => r.failed || r.percent < (THRESHOLDS[r.pkg] ?? 0))
  if (REPORT_ONLY) {
    console.log(`\n${below.length} package(s) below threshold (report mode — not gating)`)
    return
  }
  if (below.length > 0) {
    console.error(`\nFAIL: ${below.map((b) => b.pkg).join(", ")} below coverage threshold`)
    process.exit(1)
  }
  console.log("\nOK: all gated packages meet coverage thresholds")
}

main()
