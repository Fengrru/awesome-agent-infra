import { createMemorySystem } from "../packages/agent-memory/src/index.ts"
/**
 * agent-memory — 4-tier memory ingestion + context assembly throughput.
 *
 * Run: bun bench agent-memory.bench.ts
 */
import { bench, run } from "./bench-utils.ts"

const sys = createMemorySystem()
for (let i = 0; i < 300; i++) {
  sys.addLongTermMemory({
    memory_id: `m${i}`,
    content: `The agent learned that task ${i} requires retry with exponential backoff when the API returns 429`,
    token_count: 20,
    importance: 0.5 + (i % 5) / 10,
    access_count: i % 7,
    created_at: Date.now() - i * 1000,
    last_accessed: Date.now(),
    retention_score: 0.6,
    tags: ["retry", `topic-${i % 10}`],
  })
}
for (let i = 0; i < 10; i++) {
  sys.addWorkingMemory({ id: `w${i}`, content: "draft plan for task", token_count: 10, priority: 1 })
}

const upsertMemory = {
  memory_id: "bench-upsert",
  content: "Benchmark memory entry used for upsert timing",
  token_count: 8,
  importance: 0.4,
  access_count: 0,
  created_at: Date.now(),
  last_accessed: Date.now(),
  retention_score: 0.5,
}

let goalCounter = 0

// Vary the goal each iteration so the 5s context cache never hits
bench("assemble context (300 L3 memories)", () => {
  goalCounter++
  sys.assembleContext(`goal number ${goalCounter}`)
})

bench("upsert long-term memory", () => {
  sys.addLongTermMemory(upsertMemory)
})

bench("composite retrieval score", () => {
  sys.compositeRetrievalScore(upsertMemory, null, "benchmark goal")
})

await run()
