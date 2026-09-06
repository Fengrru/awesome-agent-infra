import type { Event } from "../src/schema/event.js"

// Every system sees the same interface. The runner knows nothing about what
// is inside a system — no arm gets a special path.
export interface RunContext {
  phase: "teach" | "test"
  workspace: string
  sessionSeq: number
}

export interface SystemRunOutcome {
  answer: string
  steps: number
  stopped: "done" | "max_steps" | "error"
  events: Event[]
  // Diagnostics for the memory arms: what was injected and how large it was.
  includedMemoryNames: string[]
  contextChars: number
}

export interface BenchmarkSystem {
  readonly name: string
  // Fresh state: new stores, nothing carried over from a previous run.
  reset(): Promise<void>
  run(goal: string, ctx: RunContext): Promise<SystemRunOutcome>
  // Ground-truth outcome of the just-finished session, from the benchmark's
  // workspace verifier (not an LLM judge). Systems with a feedback loop
  // (Seed) consume it; the others must ignore it.
  learn(success: boolean): Promise<void>
  dispose(): Promise<void>
}

export interface SystemFactory {
  readonly name: string
  create(model: import("../src/model/model.js").Model): BenchmarkSystem
}

export type TaskCategory = "rules" | "skills" | "facts"

// One agent session in a task's timeline. All systems run the same timeline;
// the timeline is task design, not protocol.
export interface Session {
  goal: string
  phase: "teach" | "test"
}

export interface TaskInstance {
  // Legacy two-session shape (one teach + one test). Instances serialized
  // this way keep their content hash stable across runner upgrades.
  teach?: string
  test?: string
  // Multi-session timeline; when present it overrides teach/test.
  sessions?: Session[]
  // Deterministic material derived from the seed (codewords, ports, …).
  // Recorded with every result so a run is reproducible down to the byte.
  vars: Record<string, string>
}

// Sessions run in order; every "test" session is scored against a fresh
// workspace, every "teach" session feeds learn() with its own outcome.
export function instanceSessions(instance: TaskInstance): Session[] {
  if (instance.sessions && instance.sessions.length > 0) return instance.sessions
  if (instance.teach === undefined || instance.test === undefined) {
    throw new Error("task instance must define sessions or teach+test")
  }
  return [
    { goal: instance.teach, phase: "teach" },
    { goal: instance.test, phase: "test" },
  ]
}

export interface SessionResult {
  seq: number
  phase: "teach" | "test"
  steps: number
  stopped: "done" | "max_steps" | "error"
  // Null for teach sessions (no ground-truth verifier there).
  passed: boolean | null
}

export interface TaskVerifyContext {
  workspace: string
  events: Event[]
  answer: string
  instance: TaskInstance
}

export interface Task {
  id: string
  category: TaskCategory
  description: string
  generate(seed: number): TaskInstance
  // Verification judges what actually happened in the workspace, never the
  // final answer text alone.
  verify(ctx: TaskVerifyContext): boolean | Promise<boolean>
}
