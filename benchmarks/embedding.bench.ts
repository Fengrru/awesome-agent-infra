import { createEnhancedTFIDF } from "../packages/embedding/src/index.ts"
/**
 * embedding — EnhancedTFIDF indexing + retrieval throughput.
 *
 * Run: bun bench embedding.bench.ts
 */
import { bench, run } from "./bench-utils.ts"

const DOCS: Array<{ id: string; content: string }> = []
for (let i = 0; i < 300; i++) {
  DOCS.push({
    id: `doc-${i}`,
    content: `function handleTask${i}() {
  const result = processItem(items[${i}])
  if (result.error) logError(result.error, ${i})
  cacheResult(task_${i}, result)
  return result
}`,
  })
}

const index = createEnhancedTFIDF()
index.addDocuments(DOCS)
const v1 = index.getVector("doc-0")
const v2 = index.getVector("doc-1")

bench("add + remove document", () => {
  index.addDocument("bench-new", DOCS[0]!.content)
  index.removeDocument("bench-new")
})

bench("search top-10", () => {
  index.search("process item error handling", 10)
})

bench("cosine similarity (300-dim)", () => {
  if (v1 && v2) index.cosineSimilarity(v1, v2)
})

await run()
