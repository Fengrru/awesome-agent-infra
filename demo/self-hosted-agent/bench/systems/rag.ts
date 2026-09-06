import { assembleContext } from "../../src/kernel/working-set.js"
import { TfidfVectorizer, cosine } from "../../src/memory/embedding.js"
import type { Model } from "../../src/model/model.js"
import type { Event } from "../../src/schema/event.js"
import { type KnowledgeObject, contentHash, stableStringify } from "../../src/schema/knowledge.js"
import { renderTranscript } from "../../src/session/history.js"
import { PROTOCOL } from "../config.js"
import type { BenchmarkSystem, RunContext, SystemRunOutcome } from "../types.js"
import { runKernelSession } from "./base.js"

interface RagEntry {
  name: string
  content: unknown
}

// Same distiller, no governance: harvested memories/skills are appended as
// plain text, retrieved by TF-IDF similarity, injected under the same token
// budget and rendering as Seed. No lifecycle, no verification, no
// invalidation, no usage feedback.
export function createRagSystem(model: Model): BenchmarkSystem {
  let entries: RagEntry[] = []
  let lastEvents: Event[] = []

  function pseudoKnowledge(e: RagEntry): KnowledgeObject {
    return {
      id: contentHash({ name: e.name, kind: "memory", content: e.content }),
      name: e.name,
      kind: "memory",
      version: 1,
      parentId: null,
      content: e.content,
      provenance: { source: "trajectory", refs: [], created: 0 },
      evidence: [],
      verification: { status: "unverified", check: null, lastVerifiedAt: null },
      ttl: null,
      state: "active",
      metrics: { uses: 0, successes: 0, lastUsedAt: null },
    }
  }

  function retrieve(goal: string): KnowledgeObject[] {
    if (entries.length === 0) return []
    const docs = entries.map((e) => stableStringify(e.content))
    const tfidf = new TfidfVectorizer(docs)
    const qvec = tfidf.vectorize(goal)
    return entries
      .map((e, i) => ({ e, sim: cosine(qvec, tfidf.vectorize(docs[i]!)) }))
      .filter((x) => x.sim > 0)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, PROTOCOL.retrieveTopK)
      .map((x) => pseudoKnowledge(x.e))
  }

  return {
    name: "rag",
    async reset() {
      entries = []
      lastEvents = []
    },
    async run(goal: string, ctx: RunContext): Promise<SystemRunOutcome> {
      const retrieved = retrieve(goal)
      const { context } = assembleContext(retrieved, PROTOCOL.memoryTokenBudget)
      const outcome = await runKernelSession({
        model,
        goal,
        context,
        workspace: ctx.workspace,
        sessionSeq: ctx.sessionSeq,
      })
      lastEvents = outcome.events
      return { ...outcome, includedMemoryNames: retrieved.map((e) => e.name) }
    },
    async learn(_success: boolean) {
      if (lastEvents.length === 0 || !model.harvest) return
      let output: Awaited<ReturnType<NonNullable<Model["harvest"]>>>
      try {
        output = await model.harvest(renderTranscript(lastEvents))
      } catch {
        return
      }
      const seen = new Set(entries.map((e) => contentHash({ name: e.name, kind: "memory", content: e.content })))
      for (const m of output.memories) {
        const entry = { name: m.key, content: m.content }
        const id = contentHash({ name: entry.name, kind: "memory", content: entry.content })
        if (seen.has(id)) continue
        seen.add(id)
        entries.push(entry)
      }
      for (const s of output.skills) {
        const entry = { name: s.name, content: { description: s.description, steps: s.steps } }
        const id = contentHash({ name: entry.name, kind: "memory", content: entry.content })
        if (seen.has(id)) continue
        seen.add(id)
        entries.push(entry)
      }
    },
    async dispose() {},
  }
}
