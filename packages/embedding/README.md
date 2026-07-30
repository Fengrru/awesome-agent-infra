# @fengru/embedding

TF-IDF vector indexing and hybrid search for code intelligence.

## Quick Start

```ts
import { EnhancedTFIDF, CodeEmbeddingIndexer, HybridSearch } from "@fengru/embedding"

// TF-IDF search with n-gram expansion
const tfidf = new EnhancedTFIDF({ ngramMin: 2, ngramMax: 4 })
tfidf.addDocument("func1", "function parseUserInput(input: string): User { ... }")
tfidf.addDocument("func2", "function validateForm(data: FormData): boolean { ... }")

const results = tfidf.search("parse user input", 5)
```

## Features

- **EnhancedTFIDF** — n-gram expansion, CamelCase/snake_case splitting, subword tokens, cosine similarity search
- **CodeEmbeddingIndexer** — wraps EnhancedTFIDF with optional external embedding model and vector store
- **HybridSearch** — fuses vector + graph + text signals with configurable weights (default: 0.4/0.3/0.3); CodeGraph integration is optional

## API

### `EnhancedTFIDF`

```ts
const tfidf = new EnhancedTFIDF({ ngramMin: 2, ngramMax: 4 })
tfidf.addDocument("id", "content")
tfidf.addDocuments([{ id: "a", content: "..." }])
tfidf.removeDocument("id")
tfidf.search("query", topK: 10) // → TFIDFResult[]
tfidf.getVector("id")            // → Map<string, number> | null
tfidf.clear()
```

### `CodeEmbeddingIndexer`

```ts
const indexer = new CodeEmbeddingIndexer({
  tfidfConfig: { ngramMin: 2 },
  embeddingModel: myModel,  // optional EmbeddingModel
  vectorStore: myStore,     // optional VectorStore
})
await indexer.addItem({ id, content, type, filePath, startLine, endLine })
await indexer.addItems([...])
await indexer.removeItem("id")
indexer.searchText("query", 10)           // → SearchResult[]
await indexer.searchVector("query", 10)   // → SearchResult[]
```

### `HybridSearch`

```ts
const hybrid = new HybridSearch(tfidf)        // CodeGraph is optional
hybrid.setCodeGraph(myGraph)                  // add later if needed

const results = await hybrid.search({
  query: "user authentication",
  topK: 10,
  weights: { vector: 0.4, graph: 0.3, text: 0.3 },
  minScore: 0.1,
})
// → HybridSearchResult[] with vectorScore, graphScore, textScore, compositeScore
```

Zero external dependencies. All types are defined locally.
