import { Database } from "bun:sqlite"
import { harvestInto } from "../../src/kernel/harvest.js"
import { run } from "../../src/kernel/loop.js"
import { GUIDANCE_WINDOW_EVENTS, buildGuidance } from "../../src/kernel/meta.js"
import { type IncludedEntry, assembleContext } from "../../src/kernel/working-set.js"
import { createRetriever } from "../../src/memory/retriever.js"
import type { Model } from "../../src/model/model.js"
import type { Event } from "../../src/schema/event.js"
import { renderTranscript } from "../../src/session/history.js"
import { SqliteLog, validEvidenceIds } from "../../src/store/log.js"
import { SqliteSelfStore } from "../../src/store/self.js"
import { PROTOCOL } from "../config.js"
import type { BenchmarkSystem, RunContext, SystemRunOutcome } from "../types.js"
import { baseConnections } from "./base.js"

// Faithful kernel-level self-hosted agent: content-hashed event log, versioned
// knowledge store, evidence-verified harvest with a source-quality gate, TF-IDF
// retrieval with the usage factor, and usage feedback driven by the benchmark's
// ground-truth verdict. Deliberately excluded in v1 (sessions are too short for
// them to ever fire): history compaction, consolidation, metacognition,
// embeddings.
export function createSelfHostedSystem(model: Model): BenchmarkSystem {
  let db: Database | null = null
  let log: SqliteLog | null = null
  let self: SqliteSelfStore | null = null
  let last: { events: Event[]; included: IncludedEntry[]; sessionId: string } | null = null

  function ensure(): { log: SqliteLog; self: SqliteSelfStore } {
    if (db === null || log === null || self === null) {
      db = new Database(":memory:")
      log = new SqliteLog(db)
      self = new SqliteSelfStore(db)
    }
    return { log, self }
  }

  return {
    name: "self-hosted",
    async reset() {
      if (db !== null) db.close()
      db = null
      log = null
      self = null
      last = null
    },
    async run(goal: string, ctx: RunContext): Promise<SystemRunOutcome> {
      const store = ensure()
      const entries = await createRetriever(store.self).retrieve(goal, PROTOCOL.retrieveTopK)
      const { context, included } = assembleContext(entries, PROTOCOL.memoryTokenBudget)
      const guidance = buildGuidance(store.log.replayRecent(GUIDANCE_WINDOW_EVENTS))
      const fullContext = guidance ? `${guidance}\n\n${context}` : context

      const sessionId = `bench-${ctx.sessionSeq}`
      const result = await run({
        sessionId,
        goal,
        context: fullContext,
        model,
        connections: baseConnections(ctx.workspace),
        log: store.log,
        maxSteps: PROTOCOL.maxSteps,
      })
      const events = store.log.replaySession(sessionId)
      last = { events, included, sessionId }
      return {
        answer: result.answer,
        steps: result.steps,
        stopped: result.stopped,
        events,
        includedMemoryNames: included.map((i) => i.name),
        contextChars: fullContext.length,
      }
    },
    async learn(success: boolean) {
      if (last === null || !model.harvest) return
      const store = ensure()
      // Shell tools report a failed command as ok:true with a nonzero
      // exitCode, so ok===false alone would never flag a failed session.
      const failedCount = last.events.filter((e) => {
        if (e.type !== "result") return false
        const r = e.result as { ok?: boolean; value?: { exitCode?: number } } | null
        if (r === null || typeof r !== "object") return false
        if (r.ok === false) return true
        return typeof r.value?.exitCode === "number" && r.value.exitCode !== 0
      }).length
      try {
        const output = await model.harvest(renderTranscript(last.events))
        harvestInto(store.self, output, {
          sessionId: last.sessionId,
          evidenceIds: validEvidenceIds(store.log, last.events.map((e) => e.id).slice(-50)),
          sourceQuality: success && failedCount === 0 ? "good" : "poor",
        })
      } catch {
        // Harvest is best-effort, same as the production agent.
      }
      // Usage feedback with the benchmark's ground-truth verdict instead of
      // the LLM judge: stricter and cheaper.
      for (const { kind, name } of last.included) store.self.recordOutcome(kind, name, success)
    },
    async dispose() {
      if (db !== null) db.close()
      db = null
      log = null
      self = null
      last = null
    },
  }
}
