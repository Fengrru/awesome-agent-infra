import { execFileSync } from "node:child_process"
import { join } from "node:path"
import type { DecideInput, Model, Step } from "../src/model/model.js"
import { contentHash } from "../src/schema/knowledge.js"
import { DEFAULT_SEEDS, PROTOCOL, defaultBaseUrl, defaultModelName } from "./config.js"
import { FatalProviderError, type ProtocolSnapshot, runExperiment } from "./runner.js"
import { createNoMemSystem } from "./systems/no-mem.js"
import { createRagSystem } from "./systems/rag.js"
import { createSelfHostedSystem } from "./systems/self-hosted.js"
import { TASKS, tasksByIds } from "./tasks.js"
import type { SystemFactory } from "./types.js"

// ---------------------------------------------------------------------------
// Scripted smoke model: satisfies the smoke suite offline. It tracks the
// newest codeword it was taught; during a test it only writes the file when
// the injected context carries the current codeword and no superseded one,
// so smoke/codeword validates retrieval and smoke/update validates that a
// superseded version never reaches context (self-hosted latest() passes, plain
// append-only stores fail).
// ---------------------------------------------------------------------------
const SUPERSEDED_CODEWORDS = ["SMOKEOLD", "SMOKECODE"]

// Newest codeword a goal can teach, in supersession order.
const CODEWORD_PRIORITY = ["SMOKEBNEW", "SMOKECODE", "SMOKEOLD"]

function codewordIn(text: string): string | null {
  for (const c of CODEWORD_PRIORITY) if (text.includes(c)) return c
  return null
}

function createSmokeModel(): Model {
  let current: string | null = null
  return {
    async decide(input: DecideInput): Promise<Step[]> {
      const lastUser = [...input.history].reverse().find((h) => h.role === "user")
      const goal = lastUser?.role === "user" ? lastUser.content : ""
      const wrote = input.history.some((h) => h.role === "assistant-tool")
      const taught = codewordIn(goal)
      if (taught !== null) current = taught
      if (goal.toLowerCase().includes("remember")) {
        return [{ type: "done", answer: "noted" }]
      }
      if (goal.includes("CODEWORD")) {
        if (wrote) return [{ type: "done", answer: "wrote codeword file" }]
        if (current === null) return [{ type: "done", answer: "codeword unknown" }]
        const poisoned = SUPERSEDED_CODEWORDS.some((c) => c !== current && input.context.includes(c))
        if (!input.context.includes(current) || poisoned) {
          return [{ type: "done", answer: "codeword context is stale or missing" }]
        }
        return [{ type: "tool", tool: "fs_write", args: { path: "CODEWORD.txt", content: current } }]
      }
      return [{ type: "done", answer: "ok" }]
    },
    async harvest(transcript: string) {
      const codeword = codewordIn(transcript)
      if (codeword === null) return { memories: [], skills: [] }
      return {
        memories: [{ key: "release-codeword", content: { note: `release codeword is ${codeword}` } }],
        skills: [],
      }
    },
  }
}

function gitCommit(repoDir: string): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir, encoding: "utf8" }).trim()
  } catch {
    return "unknown"
  }
}

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : undefined
}

const args = process.argv.slice(2)
const repoDir = join(import.meta.dirname, "..")

const useFake = args.includes("--fake")
const force = args.includes("--force")
const experiment = argValue(args, "--exp") ?? (useFake ? "smoke" : "e1")
const seedList = (argValue(args, "--seeds") ?? DEFAULT_SEEDS.join(","))
  .split(",")
  .map((s) => Number.parseInt(s.trim(), 10))
  .filter((n) => Number.isFinite(n))

const allFactories: SystemFactory[] = [
  { name: "no-mem", create: createNoMemSystem },
  { name: "rag", create: createRagSystem },
  { name: "self-hosted", create: createSelfHostedSystem },
]
const systemFilter = argValue(args, "--systems")
  ?.split(",")
  .map((s) => s.trim())
const factories = systemFilter ? allFactories.filter((f) => systemFilter.includes(f.name)) : allFactories
if (factories.length === 0) {
  console.error(`no systems match filter: ${systemFilter?.join(",")}`)
  process.exit(1)
}

const tasks = useFake
  ? TASKS.filter((t) => t.id.startsWith("smoke/"))
  : argValue(args, "--tasks")
    ? tasksByIds(
        argValue(args, "--tasks")!
          .split(",")
          .map((s) => s.trim()),
      )
    : TASKS.filter((t) => !t.id.startsWith("smoke/"))

const modelName = useFake ? "fake-smoke" : defaultModelName()

if (!useFake && !process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY is required (or pass --fake for the offline smoke run).")
  process.exit(1)
}

let createRealModel: () => Model = () => {
  throw new Error("unreachable")
}
if (!useFake) {
  const { createOpenAIModel } = await import("../src/model/openai.js")
  createRealModel = () =>
    createOpenAIModel({
      baseUrl: defaultBaseUrl(),
      apiKey: process.env.OPENAI_API_KEY ?? "",
      model: modelName,
      ...(PROTOCOL.temperature === undefined ? {} : { temperature: PROTOCOL.temperature }),
      // Free-tier providers throttle hard under load; the matrix must survive
      // transient 429/5xx storms rather than tombstoning runs.
      maxAttempts: 6,
    })

  // Preflight: one throwaway request before the matrix spends anything. The
  // v1 E1 run burned its whole tail on a 402 that this check would have
  // caught for the price of a single token.
  const check = await fetch(`${defaultBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: modelName, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
  }).catch((e) => e)
  if (check instanceof Error) {
    console.error(`preflight failed (network): ${check.message}`)
    process.exit(1)
  }
  if (!check.ok) {
    console.error(`preflight failed: provider returned ${check.status} ${await check.text()}`)
    console.error("fix the key/balance before running the benchmark; nothing was spent on the matrix.")
    process.exit(1)
  }
}

// Snapshot the frozen protocol + provenance of the code under test.
const { SYSTEM_PROMPT } = await import("../src/model/openai.js")
const snapshot: ProtocolSnapshot = {
  maxSteps: PROTOCOL.maxSteps,
  memoryTokenBudget: PROTOCOL.memoryTokenBudget,
  temperature: PROTOCOL.temperature,
  retrieveTopK: PROTOCOL.retrieveTopK,
  testPhases: PROTOCOL.testPhases,
  model: modelName,
  gitCommit: gitCommit(repoDir),
  systemPromptHash: useFake ? "fake" : contentHash(SYSTEM_PROMPT),
  timestamp: new Date().toISOString(),
}

console.log(
  `bench ${experiment}: ${factories.map((f) => f.name).join(", ")} × ${tasks.length} tasks × seeds [${seedList.join(",")}] model=${modelName}${force ? " (force: rerun everything)" : " (resume: valid results on disk are kept)"}`,
)

try {
  const summary = await runExperiment({
    experiment,
    factories,
    tasks,
    seeds: seedList,
    resultsDir: join(repoDir, "bench", "results"),
    snapshot,
    createModel: useFake ? createSmokeModel : createRealModel,
    force,
    onProgress: (line) => console.log(line),
  })

  console.log("\n=== summary ===")
  for (const s of summary.perSystem) {
    console.log(
      `${s.system.padEnd(8)} success=${(s.successRate * 100).toFixed(0).padStart(3)}%  ` +
        `avgSteps=${s.avgSteps.toFixed(1)}  avgTokens=${Math.round(s.avgTotalTokens)}  avgMs=${Math.round(s.avgDurationMs)}`,
    )
  }
} catch (e) {
  if (e instanceof FatalProviderError) {
    console.error(`\naborted: ${e.message}`)
    console.error("valid results already written are kept; rerun with the same command once the provider is usable.")
    process.exit(1)
  }
  throw e
}
