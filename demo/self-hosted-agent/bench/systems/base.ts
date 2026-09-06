import { Database } from "bun:sqlite"
import { createBashConnection, createReadConnection, createWriteConnection } from "../../src/connection/builtin.js"
import { run } from "../../src/kernel/loop.js"
import type { Model } from "../../src/model/model.js"
import type { Connection } from "../../src/schema/connection.js"
import type { Event } from "../../src/schema/event.js"
import { SqliteLog } from "../../src/store/log.js"
import { PROTOCOL } from "../config.js"
import type { SystemRunOutcome } from "../types.js"

// Identical toolset for every arm. Memory governance is the only variable
// under test, so no system gets extra tools (no memory/skill/task/delegate
// tools anywhere in the benchmark).
export function baseConnections(dir: string): Map<string, Connection> {
  const m = new Map<string, Connection>()
  const read = createReadConnection(dir)
  const write = createWriteConnection(dir)
  const bash = createBashConnection(dir)
  m.set(read.id, read)
  m.set(write.id, write)
  m.set(bash.id, bash)
  return m
}

export interface SessionRunOptions {
  model: Model
  goal: string
  context: string
  workspace: string
  sessionSeq: number
}

// One kernel-loop session over a fresh in-memory event log. All arms run the
// exact same loop with the exact same protocol limits.
export async function runKernelSession(opts: SessionRunOptions): Promise<SystemRunOutcome> {
  const db = new Database(":memory:")
  const log = new SqliteLog(db)
  const sessionId = `bench-${opts.sessionSeq}`
  try {
    const result = await run({
      sessionId,
      goal: opts.goal,
      context: opts.context,
      model: opts.model,
      connections: baseConnections(opts.workspace),
      log,
      maxSteps: PROTOCOL.maxSteps,
    })
    const events = log.replaySession(sessionId)
    return {
      answer: result.answer,
      steps: result.steps,
      stopped: result.stopped,
      events,
      includedMemoryNames: [],
      contextChars: opts.context.length,
    }
  } finally {
    db.close()
  }
}

export function toolCallCount(events: Event[]): number {
  return events.filter((e) => e.type === "step").length
}
