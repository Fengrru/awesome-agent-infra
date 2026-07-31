/**
 * Shared TF-IDF utilities — text vectorization and similarity.
 * Used internally by embedding, memory-engine-v2, and hallucination-detector.
 * @module internal-tfidf
 */

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1)
}

export function computeIDF(documents: string[][]): Map<string, number> {
  const df = new Map<string, number>()
  const N = documents.length
  for (const doc of documents) {
    const seen = new Set(doc)
    for (const term of seen) {
      df.set(term, (df.get(term) ?? 0) + 1)
    }
  }
  const idf = new Map<string, number>()
  for (const [term, count] of df) {
    idf.set(term, Math.log((N + 1) / (count + 1)) + 1)
  }
  return idf
}

export function computeTFIDFVector(tokens: string[], idf: Map<string, number>): Map<string, number> {
  const tf = new Map<string, number>()
  for (const token of tokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1)
  }
  const vec = new Map<string, number>()
  for (const [term, count] of tf) {
    vec.set(term, (count / tokens.length) * (idf.get(term) ?? 0))
  }
  return vec
}

export function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dotProduct = 0
  let normA = 0
  let normB = 0
  for (const [term, value] of a) {
    dotProduct += value * (b.get(term) ?? 0)
    normA += value * value
  }
  for (const value of b.values()) {
    normB += value * value
  }
  if (normA === 0 || normB === 0) return 0
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

export function buildTFIDFVectors(docs: string[]): { vectors: number[][]; terms: string[] } {
  const tokenizedDocs = docs.map(tokenize)
  const termSet = new Set<string>()
  for (const tokens of tokenizedDocs) {
    for (const token of tokens) {
      termSet.add(token)
    }
  }
  const terms = [...termSet]

  if (terms.length === 0) {
    return { vectors: docs.map(() => []), terms: [] }
  }

  const N = docs.length
  const dtMatrix: number[][] = tokenizedDocs.map((tokens) => {
    const tf: Record<string, number> = {}
    for (const token of tokens) {
      tf[token] = (tf[token] || 0) + 1
    }
    return terms.map((term) => (tokens.length > 0 ? (tf[term] || 0) / tokens.length : 0))
  })

  const idf: number[] = terms.map((term) => {
    const docFreq = tokenizedDocs.filter((tokens) => tokens.includes(term)).length
    return Math.log((1 + N) / (1 + docFreq)) + 1
  })

  const vectors = dtMatrix.map((row) => row.map((tf, i) => tf * idf[i]))

  return { vectors, terms }
}

export function computeCosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0
  let dotProduct = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB)
  if (magnitude === 0) return 0
  return dotProduct / magnitude
}
