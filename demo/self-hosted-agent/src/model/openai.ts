import { z } from "zod"
import { fetchWithTimeout } from "../util/fetch.js"
import { toJsonSchema } from "../util/json-schema.js"
import {
  type DecideInput,
  type HarvestOutput,
  type HistoryItem,
  type Model,
  ModelCallError,
  type Step,
} from "./model.js"

export interface OpenAIConfig {
  baseUrl: string
  apiKey: string
  model: string
  timeoutMs?: number
  harvestTimeoutMs?: number
  judgeTimeoutMs?: number
  compactTimeoutMs?: number
  // Sampling temperature sent with decide/harvest calls. Benchmarks freeze
  // this per experiment and record it with the results.
  temperature?: number
  // Total request attempts for transient failures (network errors and
  // retryable HTTP statuses). Default 1 = fail fast, surfacing the raw
  // response or error unchanged. Long-running harnesses raise this to ride
  // out free-tier throttling.
  maxAttempts?: number
  // Base delay for exponential backoff between retry attempts.
  retryBaseDelayMs?: number
}

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  decideCalls: number
  harvestCalls: number
  judgeCalls: number
  compactCalls: number
}

// Model plus a usage accumulator, so harnesses can attribute inference cost
// per run. Providers that omit usage report zeros; callers fall back to
// estimation in that case.
export interface OpenAIModelWithUsage extends Model {
  usage(): TokenUsage
}

const FinishSchema = z.object({ answer: z.string() })

const HarvestSchema = z.object({
  memories: z.array(z.object({ key: z.string(), content: z.unknown() })),
  skills: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      steps: z.string(),
      verification: z.string().optional(),
    }),
  ),
})

const HARVEST_PROMPT = `You are distilling a completed work session into durable knowledge.
Given the transcript below, extract two kinds of things worth persisting:
1. memories: durable facts, user preferences, or decisions the agent should remember.
2. skills: reusable procedures that generalize beyond this one task (only include these if they clearly generalize; a skill may include a shell command to verify its result).

Respond ONLY with a JSON object matching this shape:
{"memories":[{"key":"...","content":{...}}],"skills":[{"name":"...","description":"...","steps":"...","verification":"..."}]}
If nothing is worth saving, return empty arrays.`

// Exported so benchmark harnesses can hash the exact system prompt into
// their protocol snapshots.
export const SYSTEM_PROMPT = `You are an agent completing a goal by taking steps.
You are given a set of tools and a history of previous steps. Decide the next single step.
- If the goal is already achieved or nothing useful can be done, call the finish tool with your final answer.
- Otherwise, choose exactly one available tool with the required arguments.
- Do not repeat a tool call that already succeeded; check the history first.`

type Message =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant"
      content: string | null
      tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>
    }
  | { role: "tool"; tool_call_id: string; content: string }

// Tool results are untrusted input; cap how much of the conversation is sent
// back so one oversized result cannot exhaust the context window or price the
// rest of the session out of the prompt.
const MAX_HISTORY_CHARS = 60_000

function historyToMessages(history: HistoryItem[]): Message[] {
  const all = history.flatMap((item): Message[] => {
    switch (item.role) {
      case "user":
        return [{ role: "user", content: item.content }]
      case "assistant-text":
        return [{ role: "assistant", content: item.content }]
      case "assistant-tool":
        return [
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: item.toolCallId,
                type: "function",
                function: { name: item.tool, arguments: JSON.stringify(item.args) },
              },
            ],
          },
        ]
      case "tool":
        return [{ role: "tool", tool_call_id: item.toolCallId, content: JSON.stringify(item.result) }]
    }
  })

  let budget = MAX_HISTORY_CHARS
  const kept: Message[] = []
  let omitted = 0
  for (let i = all.length - 1; i >= 0; i--) {
    const msg = all[i]
    if (!msg) break
    const size = JSON.stringify(msg).length
    if (size > budget && kept.length > 0) {
      omitted = i + 1
      break
    }
    budget -= size
    kept.unshift(msg)
  }
  if (omitted > 0) {
    // The kept suffix is contiguous, so a cut that lands between an assistant
    // tool_calls message and its result leaves orphaned tool messages at the
    // front — a shape OpenAI-compatible APIs reject. Drop them too.
    while (kept[0]?.role === "tool") {
      kept.shift()
      omitted += 1
    }
    kept.unshift({ role: "user", content: `[${omitted} earlier message(s) omitted due to context budget]` })
  }
  return kept
}

const EMPTY_HARVEST: HarvestOutput = { memories: [], skills: [] }

const JUDGE_PROMPT = `You are evaluating whether an agent achieved a goal.
Given the goal, the agent's final answer, and a transcript of its actions, decide whether the goal was actually achieved.
Answer ONLY with the single word "yes" or "no".`

const COMPACT_PROMPT = `You are compressing completed turns of an agent session into a compact summary for future context.
Preserve: each turn's goal, the key decisions, what was done (tool use, in brief), errors encountered, and the final outcome.
Respond ONLY with a concise plain-text summary of at most 800 characters, no markdown headers.`

// Model-written summaries replace one folded round at a time; capping the
// transcript keeps the call cheap no matter how large the round was.
const MAX_COMPACT_TRANSCRIPT_CHARS = 30_000

// Free-tier pools throttle under load (Zhipu 1305 "访问量过大" is a 429). A
// multi-hour benchmark matrix must ride out transient congestion instead of
// aborting or writing tombstones; permanent errors (401/402/403/404) are never
// retried and surface immediately to the caller. Retrying is opt-in via
// config.maxAttempts; the default single attempt keeps the adapter fail-fast.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

interface RetryPolicy {
  maxAttempts: number
  baseDelayMs: number
}

async function postJson(
  url: string,
  apiKey: string,
  body: string,
  timeoutMs: number,
  retry: RetryPolicy,
): Promise<Response> {
  let lastFailure = "unknown failure"
  for (let attempt = 1; attempt <= retry.maxAttempts; attempt++) {
    let res: Response | null = null
    try {
      res = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body,
        },
        timeoutMs,
      )
    } catch (e) {
      if (retry.maxAttempts <= 1) throw e
      lastFailure = e instanceof Error ? e.message : String(e)
    }
    if (res !== null) {
      if (res.ok || retry.maxAttempts <= 1 || !RETRYABLE_STATUS.has(res.status)) return res
      lastFailure = `${res.status} ${(await res.text()).slice(0, 300)}`
    }
    if (attempt < retry.maxAttempts) await sleep(Math.min(retry.baseDelayMs * 2 ** (attempt - 1), 60_000))
  }
  throw new Error(`model error: ${lastFailure} (gave up after ${retry.maxAttempts} attempts)`)
}

export function createOpenAIModel(config: OpenAIConfig): OpenAIModelWithUsage {
  const timeoutMs = config.timeoutMs ?? 120_000
  const harvestTimeoutMs = config.harvestTimeoutMs ?? 60_000
  const judgeTimeoutMs = config.judgeTimeoutMs ?? 30_000
  const compactTimeoutMs = config.compactTimeoutMs ?? 60_000
  const retry: RetryPolicy = {
    maxAttempts: Math.max(1, config.maxAttempts ?? 1),
    baseDelayMs: config.retryBaseDelayMs ?? 5_000,
  }
  const totals: TokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    decideCalls: 0,
    harvestCalls: 0,
    judgeCalls: 0,
    compactCalls: 0,
  }

  function account(
    data: { usage?: { prompt_tokens?: number; completion_tokens?: number } },
    kind: "decideCalls" | "harvestCalls" | "judgeCalls" | "compactCalls",
  ): void {
    totals[kind] += 1
    totals.promptTokens += data.usage?.prompt_tokens ?? 0
    totals.completionTokens += data.usage?.completion_tokens ?? 0
  }

  // Shared request fields: the frozen benchmark protocol pins sampling
  // parameters, and every arm must see the same ones.
  const sampling = config.temperature === undefined ? {} : { temperature: config.temperature }

  const model: OpenAIModelWithUsage = {
    async decide(input: DecideInput): Promise<Step[]> {
      const tools = input.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.jsonSchema ?? toJsonSchema(t.inputSchema),
        },
      }))
      tools.push({
        type: "function",
        function: {
          name: "finish",
          description: "Signal that the goal is complete and provide the final answer.",
          parameters: toJsonSchema(FinishSchema),
        },
      })

      const platformHint = `(You are running on ${process.platform}. Use the correct shell commands for this platform.)`
      const contextHint = input.context ? `\n\nRelevant knowledge from memory:\n${input.context}` : ""
      const system = `${SYSTEM_PROMPT}\n\n${platformHint}${contextHint}`

      const messages: Message[] = [{ role: "system", content: system }, ...historyToMessages(input.history)]

      const res = await postJson(
        `${config.baseUrl}/chat/completions`,
        config.apiKey,
        JSON.stringify({
          model: config.model,
          messages,
          tools,
          tool_choice: "auto",
          ...sampling,
        }),
        timeoutMs,
        retry,
      )

      if (!res.ok) throw new Error(`model error: ${res.status} ${await res.text()}`)
      const data = (await res.json()) as {
        choices: Array<{
          finish_reason?: string
          message: { content?: string; tool_calls?: Array<{ function: { name: string; arguments: string } }> }
        }>
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }
      account(data, "decideCalls")

      // Length-stop protection (pi's design): when the provider truncated the
      // output, any tool arguments are possibly incomplete. Never salvage them
      // by parsing — the kernel retries once, then fails the run.
      if (data.choices[0]?.finish_reason === "length") {
        throw new ModelCallError("model output was truncated (length limit reached)")
      }

      const calls = data.choices[0]?.message?.tool_calls ?? []
      if (calls.length === 0) {
        return [{ type: "done", answer: data.choices[0]?.message?.content ?? "" }]
      }

      // Every tool call from the response becomes a step; none are dropped.
      return calls.map((call) => {
        const name = call.function.name
        let args: unknown
        try {
          args = JSON.parse(call.function.arguments)
        } catch (e) {
          throw new ModelCallError(
            `model returned malformed tool arguments: ${e instanceof Error ? e.message : String(e)}`,
          )
        }
        if (name === "finish") {
          const parsed = FinishSchema.safeParse(args)
          if (!parsed.success) throw new ModelCallError(`finish tool has invalid arguments: ${parsed.error.message}`)
          return { type: "done", answer: parsed.data.answer } as const
        }
        return { type: "tool", tool: name, args } as const
      })
    },
    async harvest(transcript: string): Promise<HarvestOutput> {
      let res: Response
      try {
        res = await postJson(
          `${config.baseUrl}/chat/completions`,
          config.apiKey,
          JSON.stringify({
            model: config.model,
            messages: [
              { role: "system", content: HARVEST_PROMPT },
              { role: "user", content: transcript },
            ],
            response_format: { type: "json_object" },
            ...sampling,
          }),
          harvestTimeoutMs,
          retry,
        )
      } catch {
        return EMPTY_HARVEST
      }
      if (!res.ok) {
        try {
          throw new Error(`harvest error: ${res.status} ${await res.text()}`)
        } catch {
          return EMPTY_HARVEST
        }
      }
      // Harvest is best-effort: a failed distillation must never take down
      // (or invalidate) a run that already produced an answer.
      try {
        const data = (await res.json()) as {
          choices: Array<{ message: { content: string } }>
          usage?: { prompt_tokens?: number; completion_tokens?: number }
        }
        account(data, "harvestCalls")
        const content = data.choices[0]?.message?.content ?? ""
        const parsed = HarvestSchema.parse(JSON.parse(content))
        return {
          memories: parsed.memories.map((m) => ({ key: m.key, content: m.content ?? null })),
          skills: parsed.skills.map((s) => ({
            name: s.name,
            description: s.description,
            steps: s.steps,
            ...(s.verification === undefined ? {} : { verification: s.verification }),
          })),
        }
      } catch {
        return EMPTY_HARVEST
      }
    },
    async judge(goal: string, answer: string, transcript: string): Promise<boolean> {
      const res = await postJson(
        `${config.baseUrl}/chat/completions`,
        config.apiKey,
        JSON.stringify({
          model: config.model,
          messages: [
            { role: "system", content: JUDGE_PROMPT },
            { role: "user", content: `Goal: ${goal}\n\nFinal answer:\n${answer}\n\nTranscript:\n${transcript}` },
          ],
          max_tokens: 16,
        }),
        judgeTimeoutMs,
        retry,
      )
      if (!res.ok) throw new Error(`judge error: ${res.status} ${await res.text()}`)
      const data = (await res.json()) as {
        choices: Array<{ message: { content: string } }>
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }
      account(data, "judgeCalls")
      const verdict = (data.choices[0]?.message?.content ?? "").trim().toLowerCase()
      if (verdict.startsWith("yes")) return true
      if (verdict.startsWith("no")) return false
      throw new Error(`unparseable judge verdict: ${JSON.stringify(verdict)}`)
    },
    async summarizeRounds(transcript: string): Promise<string> {
      const res = await postJson(
        `${config.baseUrl}/chat/completions`,
        config.apiKey,
        JSON.stringify({
          model: config.model,
          messages: [
            { role: "system", content: COMPACT_PROMPT },
            { role: "user", content: transcript.slice(-MAX_COMPACT_TRANSCRIPT_CHARS) },
          ],
          max_tokens: 400,
        }),
        compactTimeoutMs,
        retry,
      )
      if (!res.ok) throw new Error(`compact error: ${res.status} ${await res.text()}`)
      const data = (await res.json()) as {
        choices: Array<{ message: { content: string } }>
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }
      account(data, "compactCalls")
      return (data.choices[0]?.message?.content ?? "").trim()
    },
    usage(): TokenUsage {
      return { ...totals }
    },
  }
  return model
}
