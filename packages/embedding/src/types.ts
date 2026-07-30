export interface TFIDFConfig {
  ngramMin: number
  ngramMax: number
  normalizeTokens: boolean
  idfSmooth: boolean
}

export const DEFAULT_TFIDF_CONFIG: TFIDFConfig = {
  ngramMin: 2,
  ngramMax: 4,
  normalizeTokens: true,
  idfSmooth: true,
}

export interface TFIDFDocument {
  id: string
  tokens: string[]
  content: string
}

export interface TFIDFResult {
  docId: string
  score: number
  content: string
}

export interface EmbeddingModel {
  embed(text: string): Promise<number[]>
  dimension: number
}

export interface VectorStore {
  upsert(id: string, vector: number[], metadata?: Record<string, unknown>): Promise<void>
  query(vector: number[], topK: number): Promise<VectorEntry[]>
  delete(id: string): Promise<void>
}

export interface VectorEntry {
  id: string
  vector: number[]
  score?: number
  metadata?: Record<string, unknown>
}

export interface SearchResult {
  id: string
  score: number
  content?: string
  metadata?: Record<string, unknown>
}

export interface CodeEmbeddingItem {
  id: string
  content: string
  type: "function" | "class" | "variable" | "file" | "comment" | "other"
  filePath: string
  startLine: number
  endLine: number
}

export interface HybridSearchOptions {
  query: string
  topK: number
  weights?: {
    vector: number
    graph: number
    text: number
  }
  minScore?: number
}

export const DEFAULT_HYBRID_WEIGHTS = {
  vector: 0.4,
  graph: 0.3,
  text: 0.3,
}

export interface HybridSearchResult {
  id: string
  content: string
  vectorScore: number
  graphScore: number
  textScore: number
  compositeScore: number
  metadata?: Record<string, unknown>
}

export interface CodeGraph {
  searchNeighbors(
    itemId: string,
    options: { maxDepth: number; maxNeighbors: number },
  ): Promise<Array<{ id: string; score: number }>>
  getNodeCentrality(itemId: string): number
}
