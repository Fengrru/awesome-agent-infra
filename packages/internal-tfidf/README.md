# @fengrru/internal-tfidf

> **Internal package** — not published to npm.

Shared TF-IDF utilities — tokenization, IDF computation, vectorization, and cosine similarity.

> **Internal package** — marked `"private": true` and never published to npm. It is consumed via
> `workspace:*` by [`@fengrru/embedding`](../embedding), [`@fengrru/memory-engine-v2`](../memory-engine-v2),
> and [`@fengrru/hallucination-detector`](../hallucination-detector) to avoid duplicating TF-IDF logic.

## API

### Map-based (sparse) representation

| Function | Description |
| --- | --- |
| `tokenize(text)` | Lowercase, strip non-alphanumerics, split on whitespace, drop 1-char tokens |
| `computeIDF(documents)` | Smoothed IDF (`log((N+1)/(df+1)) + 1`) over tokenized documents |
| `computeTFIDFVector(tokens, idf)` | Sparse TF-IDF vector as `Map<term, weight>` |
| `cosineSimilarity(a, b)` | Cosine similarity between two sparse vectors |

### Array-based (dense) representation

| Function | Description |
| --- | --- |
| `buildTFIDFVectors(docs)` | Build dense TF-IDF vectors and the shared term vocabulary for a corpus |
| `computeCosineSimilarity(a, b)` | Cosine similarity between two dense vectors |

## Usage

```ts
import { tokenize, computeIDF, computeTFIDFVector, cosineSimilarity } from "@fengrru/internal-tfidf"

const docs = ["agents remember things", "agents forget things"]
const tokenized = docs.map(tokenize)
const idf = computeIDF(tokenized)

const a = computeTFIDFVector(tokenized[0], idf)
const b = computeTFIDFVector(tokenized[1], idf)
console.log(cosineSimilarity(a, b))
```

## Development

```bash
bun test          # run __tests__/
bun run typecheck # tsc --noEmit
bun run build     # tsc
```
