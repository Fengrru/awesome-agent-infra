import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Model } from "../src/model/model.js"
import type { TokenUsage } from "../src/model/openai.js"
import { contentHash } from "../src/schema/knowledge.js"
import { PROTOCOL } from "./config.js"
import { toolCallCount } from "./systems/base.js"
import { instanceSessions } from "./types.js"
import type { BenchmarkSystem, SessionResult, SystemFactory, SystemRunOutcome, Task, TaskInstance } from "./types.js"

// Everything needed to answer "was this run fair and reproducible?".
export interface ProtocolSnapshot {
  maxSteps: number
  memoryTokenBudget: number
  temperature: number
  retrieveTopK: number
  testPhases: number
  model: string
  gitCommit: string
  systemPromptHash: string
  timestamp: string
}

export interface RunRecord {
  experiment: string
  system: string
  task_id: string
  task_category: string
  seed: number
  success: boolean
  stopped: "done" | "max_steps" | "error"
  steps: number
  teach_stopped: string
  teach_steps: number
  input_tokens: number
  output_tokens: number
  total_tokens: number
  tokens_reported_by_provider: boolean
  tool_calls: number
  duration_ms: number
  teach_duration_ms: number
  test_duration_ms: number
  memory_tokens_injected_estimate: number
  injected_memory_names: string[]
  answer: string
  vars: Record<string, string>
  task_hash: string
  protocol: ProtocolSnapshot
  // Per-session breakdown; present for multi-session timelines. Absent (not
  // empty) for legacy two-session runs so their files stay byte-compatible.
  session_results?: SessionResult[]
}

// Provider errors that never self-heal mid-run. Burning the rest of the
// matrix on them is how 19 runs of E1 v1 got written as 402 tombstones.
// 404/"does not exist" covers free-tier models being retired mid-matrix.
const FATAL_PROVIDER_ERROR =
  /model error: 40[1234]|model error: 429|Insufficient Balance|Invalid Authentication|model not found|does not exist|invalid model/i

export class FatalProviderError extends Error {}

// A scored session that ends at zero steps with a canned safety refusal is a
// provider-side filter misfire, not a behavior of the memory system under
// test. Empirically ~2/7 on glm-4-flash-250414 for one benign task. Such runs
// are re-run instead of being scored.
const REFUSAL_SIGNATURE =
  /i(?:'m| am) sorry,? (?:but )?i (?:can'?t|cannot|am unable|won'?t)|i (?:can'?t|cannot|am unable to) (?:assist|help|fulfill|complete|provide)|i must decline|against my (?:policy|guidelines)/i

function isRefusal(r: RunRecord): boolean {
  return r.steps === 0 && REFUSAL_SIGNATURE.test(r.answer)
}

const MAX_REFUSAL_RETRIES = 2

export interface RunExperimentOptions {
  experiment: string
  factories: SystemFactory[]
  tasks: Task[]
  seeds: number[]
  resultsDir: string
  snapshot: ProtocolSnapshot
  createModel: () => Model
  // True = rerun everything even if a valid result file exists.
  force?: boolean
  onProgress?: (line: string) => void
}

function resultPath(o: RunExperimentOptions, systemName: string, task: Task, seed: number): string {
  const safeId = task.id.replace(/[/\\]/g, "__")
  return join(o.resultsDir, o.experiment, `${systemName}__${safeId}__seed${seed}.json`)
}

// A stored result is reusable only if it was produced by the same protocol,
// the same task instance, and did not die in flight. Anything else gets rerun.
// Exported for offline auditing of what a rerun would resume.
export function loadResumable(file: string, snapshot: ProtocolSnapshot, taskHash: string): RunRecord | null {
  if (!existsSync(file)) return null
  let r: RunRecord
  try {
    r = JSON.parse(readFileSync(file, "utf8")) as RunRecord
  } catch {
    return null
  }
  if (r.stopped === "error" || r.teach_stopped === "error") return null
  if (r.task_hash !== taskHash) return null
  const p = r.protocol
  if (
    !p ||
    p.model !== snapshot.model ||
    p.systemPromptHash !== snapshot.systemPromptHash ||
    p.maxSteps !== snapshot.maxSteps ||
    p.memoryTokenBudget !== snapshot.memoryTokenBudget ||
    p.temperature !== snapshot.temperature ||
    p.retrieveTopK !== snapshot.retrieveTopK ||
    p.testPhases !== snapshot.testPhases
  ) {
    return null
  }
  return r
}

interface OneRun {
  record: RunRecord
  file: string
}

async function runOne(opts: {
  factory: SystemFactory
  task: Task
  seed: number
  instance: TaskInstance
  taskHash: string
  file: string
  o: RunExperimentOptions
}): Promise<OneRun> {
  const { factory, task, instance, taskHash, file, o } = opts
  const model = o.createModel()
  const system: BenchmarkSystem = factory.create(model)
  const sessions = instanceSessions(instance)
  const dirs: string[] = []
  const start = Date.now()

  try {
    await system.reset()

    let teachSteps = 0
    let teachStopped: "done" | "max_steps" | "error" = "done"
    let contextChars = 0
    let toolCalls = 0
    let teachDuration = 0
    let testDuration = 0
    const sessionResults: SessionResult[] = []
    const injectedNames = new Set<string>()
    let lastScored: { outcome: SystemRunOutcome; passed: boolean } | null = null

    for (let i = 0; i < sessions.length; i++) {
      const session = sessions[i]!
      const dir = mkdtempSync(join(tmpdir(), "seed-bench-"))
      dirs.push(dir)
      const sessionStart = Date.now()
      const outcome = await system.run(session.goal, {
        phase: session.phase,
        workspace: dir,
        sessionSeq: i + 1,
      })
      const duration = Date.now() - sessionStart
      contextChars += outcome.contextChars
      toolCalls += toolCallCount(outcome.events)
      for (const name of outcome.includedMemoryNames) injectedNames.add(name)

      let passed: boolean | null = null
      if (session.phase === "teach") {
        teachSteps += outcome.steps
        if (outcome.stopped !== "done") teachStopped = outcome.stopped
        teachDuration += duration
        // Teach has no ground-truth verifier; "ran to done" is the proxy used
        // to gate harvest source quality, mirroring the production agent.
        await system.learn(outcome.stopped === "done")
      } else {
        testDuration += duration
        passed = await task.verify({ workspace: dir, events: outcome.events, answer: outcome.answer, instance })
        // Feedback after each scored session mirrors production, where every
        // run feeds the loop. It cannot influence this session's own score.
        await system.learn(passed)
        lastScored = { outcome, passed }
      }
      sessionResults.push({ seq: i + 1, phase: session.phase, steps: outcome.steps, stopped: outcome.stopped, passed })
    }

    const usage: TokenUsage | null = "usage" in model && typeof model.usage === "function" ? model.usage() : null
    const record: RunRecord = {
      experiment: o.experiment,
      system: factory.name,
      task_id: task.id,
      task_category: task.category,
      seed: opts.seed,
      success: lastScored !== null && sessionResults.every((s) => s.passed !== false),
      stopped: lastScored?.outcome.stopped ?? "error",
      steps: lastScored?.outcome.steps ?? 0,
      teach_stopped: teachStopped,
      teach_steps: teachSteps,
      input_tokens: usage?.promptTokens ?? 0,
      output_tokens: usage?.completionTokens ?? 0,
      total_tokens: (usage?.promptTokens ?? 0) + (usage?.completionTokens ?? 0),
      tokens_reported_by_provider: usage !== null && (usage.promptTokens > 0 || usage.completionTokens > 0),
      tool_calls: toolCalls,
      duration_ms: Date.now() - start,
      teach_duration_ms: teachDuration,
      test_duration_ms: testDuration,
      memory_tokens_injected_estimate: Math.ceil(contextChars / 4),
      injected_memory_names: [...injectedNames],
      answer: (lastScored?.outcome.answer ?? "(no scored session)").slice(0, 500),
      vars: instance.vars,
      task_hash: taskHash,
      protocol: o.snapshot,
      ...(sessions.length > 2 ? { session_results: sessionResults } : {}),
    }

    mkdirSync(join(o.resultsDir, o.experiment), { recursive: true })
    writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`)
    return { record, file }
  } finally {
    await system.dispose().catch(() => {})
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  }
}

export interface ExperimentSummary {
  experiment: string
  protocol: ProtocolSnapshot
  runs: number
  perSystem: Array<{
    system: string
    runs: number
    successRate: number
    avgSteps: number
    avgTotalTokens: number
    avgDurationMs: number
  }>
}

export async function runExperiment(o: RunExperimentOptions): Promise<ExperimentSummary> {
  const records: RunRecord[] = []
  let resumed = 0
  for (const factory of o.factories) {
    for (const task of o.tasks) {
      for (const seed of o.seeds) {
        const instance = task.generate(seed)
        const taskHash = contentHash({ task: task.id, instance })
        const file = resultPath(o, factory.name, task, seed)

        if (!o.force) {
          const stored = loadResumable(file, o.snapshot, taskHash)
          if (stored !== null) {
            records.push(stored)
            resumed++
            o.onProgress?.(`SKIP ${factory.name.padEnd(7)} ${task.id.padEnd(22)} seed=${seed} (valid result on disk)`)
            continue
          }
        }

        let one = await runOne({ factory, task, seed, instance, taskHash, file, o })
        let refusalRetries = 0
        while (isRefusal(one.record) && refusalRetries < MAX_REFUSAL_RETRIES) {
          refusalRetries++
          o.onProgress?.(
            `RETRY ${factory.name.padEnd(7)} ${task.id.padEnd(22)} seed=${seed} (provider refusal, attempt ${refusalRetries + 1})`,
          )
          one = await runOne({ factory, task, seed, instance, taskHash, file, o })
        }
        const { record } = one
        records.push(record)
        o.onProgress?.(
          `${record.success ? "PASS" : "FAIL"} ${factory.name.padEnd(7)} ${task.id.padEnd(22)} seed=${seed} ` +
            `steps=${record.steps} tokens=${record.total_tokens} -> ${file}`,
        )

        // A dead key or empty balance fails every remaining run the same way;
        // stop spending (and writing tombstones) the moment it is visible.
        if (
          (record.stopped === "error" || record.teach_stopped === "error") &&
          FATAL_PROVIDER_ERROR.test(record.answer)
        ) {
          throw new FatalProviderError(
            `provider rejected the request and will not recover mid-run: ${record.answer.slice(0, 200)}`,
          )
        }
      }
    }
  }
  if (resumed > 0) o.onProgress?.(`resumed ${resumed} existing valid result(s)`)

  // Summary must describe the whole experiment directory, not just the runs
  // produced by this invocation. Merge freshly produced records with every
  // result file already on disk so partial reruns (e.g. only one system or a
  // single retried task) leave the aggregate summary intact.
  const freshByKey = new Map(records.map((r) => [`${r.system}__${r.task_id}__seed${r.seed}`, r]))
  const merged: RunRecord[] = []
  const expDir = join(o.resultsDir, o.experiment)
  if (existsSync(expDir)) {
    for (const entry of readdirSync(expDir)) {
      if (!entry.endsWith(".json") || entry === "summary.json") continue
      const file = join(expDir, entry)
      let r: RunRecord
      try {
        r = JSON.parse(readFileSync(file, "utf8")) as RunRecord
      } catch {
        continue
      }
      const key = `${r.system}__${r.task_id}__seed${r.seed}`
      merged.push(freshByKey.get(key) ?? r)
    }
  }
  // If the directory did not exist yet, use only the freshly produced records.
  if (merged.length === 0) merged.push(...records)

  const perSystem = ["no-mem", "rag", "seed"].map((name) => {
    const rs = merged.filter((r) => r.system === name)
    const avg = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length)
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
    experiment: o.experiment,
    protocol: o.snapshot,
    runs: merged.length,
    perSystem,
  }
  const summaryFile = join(expDir, "summary.json")
  mkdirSync(expDir, { recursive: true })
  writeFileSync(summaryFile, `${JSON.stringify(summary, null, 2)}\n`)
  o.onProgress?.(`summary -> ${summaryFile}`)
  return summary
}

export const frozenProtocol = PROTOCOL
