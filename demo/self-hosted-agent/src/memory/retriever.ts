import { type KnowledgeObject, stableStringify } from "@fengrru/knowledge-vault"
import { injectable, isExpired, usageFactor } from "@fengrru/retrieval-feedback"
import { TfidfVectorizer, cosine, tokenize } from "./embedding.js"

export { tokenize }

export interface Retriever {
  retrieve(query: string, limit: number): Promise<KnowledgeObject[]>
}

export function createRetriever(
  store: { latestTrusted(): KnowledgeObject[] },
  now: () => number = Date.now,
): Retriever {
  return {
    async retrieve(query, limit) {
      const candidates = store.latestTrusted().filter((o) => injectable(o) && !isExpired(o, now()))

      if (candidates.length === 0) return []

      const docs = candidates.map((o) => stableStringify(o.content))
      const tfidf = new TfidfVectorizer(docs)
      const qvec = tfidf.vectorize(query)
      const qTokens = tokenize(query)

      return candidates
        .map((o, i) => {
          const sim = cosine(qvec, tfidf.vectorize(docs[i]!))
          const nameTokens = tokenize(o.name)
          let score = sim * 3
          if (qTokens.some((t) => nameTokens.includes(t))) score += 5
          if (o.kind === "memory") score += 0.5
          return { o, score: score * usageFactor(o) }
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.max(0, limit))
        .map((x) => x.o)
    },
  }
}
