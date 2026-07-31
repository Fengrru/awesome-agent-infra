/**
 * agent-memory — 4-tier memory with Ebbinghaus forgetting curve.
 *
 * Run: bun run agent-memory.ts
 */
import { createMemorySystem } from "../packages/agent-memory/src/index.ts"

const mem = createMemorySystem()

mem.addWorkingMemory({ id: "wm-1", content: "user prefers TypeScript", token_count: 20, priority: 2 })
mem.addLongTermMemory({
  memory_id: "ltm-1",
  content: "project uses zero-dependency policy",
  token_count: 30,
  importance: 0.9,
  access_count: 3,
  created_at: Date.now() - 86_400_000,
  last_accessed: Date.now() - 3_600_000,
  retention_score: 0.7,
  tags: ["policy"],
})

// composite retrieval score + context assembly for a current goal
const context = mem.assembleContext("refactor config module", null)
console.log(
  `assembled context: ${context.l2.length} working + ${context.l3.length} long-term + ${context.l4.length} rules (${context.totalTokens} tokens)`,
)

mem.markSuccessful("ltm-1")
console.log("working memory:", JSON.stringify(mem.getWorkingMemories()[0]))
console.log(
  "long-term memory:",
  JSON.stringify({
    content: mem.getLongTermMemories()[0]?.content,
    importance: mem.getLongTermMemories()[0]?.importance,
    tags: mem.getLongTermMemories()[0]?.tags,
  }),
)
