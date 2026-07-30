import {
  TFIDFConfig,
  TFIDFDocument,
  TFIDFResult,
  DEFAULT_TFIDF_CONFIG,
} from "./types"

function splitCamelCase(word: string): string[] {
  const parts: string[] = []
  let current = ""
  for (const ch of word) {
    if (ch >= "A" && ch <= "Z" && current.length > 0) {
      parts.push(current.toLowerCase())
      current = ch
    } else {
      current += ch
    }
  }
  if (current) parts.push(current.toLowerCase())
  return parts.filter((p) => p.length > 0)
}

function splitSnakeCase(word: string): string[] {
  return word.toLowerCase().split("_").filter((p) => p.length > 0)
}

function generateNGrams(token: string, minN: number, maxN: number): string[] {
  const ngrams: string[] = []
  const lower = token.toLowerCase()
  for (let n = minN; n <= maxN; n++) {
    for (let i = 0; i <= lower.length - n; i++) {
      ngrams.push(lower.slice(i, i + n))
    }
  }
  return ngrams
}

function tokenize(content: string, config: TFIDFConfig): string[] {
  const words = content
    .replace(/[^a-zA-Z0-9_]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1)

  const tokens: string[] = []
  for (const word of words) {
    const subwords: string[] = []
    if (word.includes("_")) {
      subwords.push(...splitSnakeCase(word))
    }
    const camelParts = splitCamelCase(word)
    for (const part of camelParts) {
      if (!subwords.includes(part)) {
        subwords.push(part)
      }
    }
    if (subwords.length === 0) {
      subwords.push(word.toLowerCase())
    }
    tokens.push(...subwords)

    if (config.normalizeTokens) {
      tokens.push(word.toLowerCase())
    }
  }

  const ngrams: string[] = []
  const seen = new Set<string>()
  for (const token of tokens) {
    const grams = generateNGrams(token, config.ngramMin, config.ngramMax)
    for (const gram of grams) {
      if (!seen.has(gram)) {
        seen.add(gram)
        ngrams.push(gram)
      }
    }
  }

  return ngrams
}

export class EnhancedTFIDF {
  private config: TFIDFConfig
  private documents = new Map<string, TFIDFDocument>()
  private df = new Map<string, number>()
  private idf = new Map<string, number>()
  private tfidfVectors = new Map<string, Map<string, number>>()
  private docCount = 0

  constructor(config: Partial<TFIDFConfig> = {}) {
    this.config = { ...DEFAULT_TFIDF_CONFIG, ...config }
  }

  get documentCount(): number {
    return this.docCount
  }

  get vocabularySize(): number {
    return this.df.size
  }

  addDocument(id: string, content: string): void {
    const tokens = tokenize(content, this.config)
    const doc: TFIDFDocument = { id, tokens, content }
    this.documents.set(id, doc)
    this.docCount++

    const termFreq = new Map<string, number>()
    for (const token of tokens) {
      termFreq.set(token, (termFreq.get(token) ?? 0) + 1)
      this.df.set(token, (this.df.get(token) ?? 0) + 1)
    }

    this.idf.clear()
    this.tfidfVectors.set(id, termFreq)
  }

  addDocuments(items: Array<{ id: string; content: string }>): void {
    for (const item of items) {
      this.addDocument(item.id, item.content)
    }
  }

  removeDocument(id: string): void {
    const doc = this.documents.get(id)
    if (!doc) return
    const tf = this.tfidfVectors.get(id)
    if (tf) {
      for (const token of tf.keys()) {
        const count = this.df.get(token) ?? 0
        if (count <= 1) {
          this.df.delete(token)
        } else {
          this.df.set(token, count - 1)
        }
      }
    }
    this.documents.delete(id)
    this.tfidfVectors.delete(id)
    this.docCount--
    this.idf.clear()
  }

  getIdf(term: string): number {
    if (this.idf.has(term)) return this.idf.get(term)!
    const df = this.df.get(term) ?? 0
    if (df === 0) {
      this.idf.set(term, 0)
      return 0
    }
    const smooth = this.config.idfSmooth ? 1 : 0
    const value = Math.log((this.docCount + smooth) / (df + smooth)) + 1
    this.idf.set(term, value)
    return value
  }

  getVector(id: string): Map<string, number> | null {
    return this.tfidfVectors.get(id) ?? null
  }

  cosineSimilarity(vec1: Map<string, number>, vec2: Map<string, number>): number {
    let dot = 0
    let mag1 = 0
    let mag2 = 0

    for (const [term, tf1] of vec1) {
      const tf2 = vec2.get(term) ?? 0
      const w1 = tf1 * this.getIdf(term)
      const w2 = tf2 * this.getIdf(term)
      dot += w1 * w2
      mag1 += w1 * w1
    }

    for (const [term, tf2] of vec2) {
      const w2 = tf2 * this.getIdf(term)
      mag2 += w2 * w2
    }

    if (mag1 === 0 || mag2 === 0) return 0
    return dot / (Math.sqrt(mag1) * Math.sqrt(mag2))
  }

  search(query: string, topK: number = 10): TFIDFResult[] {
    const queryTokens = tokenize(query, this.config)
    const queryVec = new Map<string, number>()
    for (const token of queryTokens) {
      queryVec.set(token, (queryVec.get(token) ?? 0) + 1)
    }

    const results: TFIDFResult[] = []
    for (const [docId, docVec] of this.tfidfVectors) {
      const sim = this.cosineSimilarity(queryVec, docVec)
      if (sim > 0) {
        results.push({
          docId,
          score: sim,
          content: this.documents.get(docId)?.content ?? "",
        })
      }
    }

    results.sort((a, b) => b.score - a.score)
    return results.slice(0, topK)
  }

  clear(): void {
    this.documents.clear()
    this.df.clear()
    this.idf.clear()
    this.tfidfVectors.clear()
    this.docCount = 0
  }
}
