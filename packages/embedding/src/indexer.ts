import { EnhancedTFIDF } from "./tfidf"
import type { CodeEmbeddingItem, EmbeddingModel, SearchResult, TFIDFConfig, VectorStore } from "./types"

export class CodeEmbeddingIndexer {
  private tfidf: EnhancedTFIDF
  private items = new Map<string, CodeEmbeddingItem>()
  private embeddingModel: EmbeddingModel | null
  private vectorStore: VectorStore | null

  constructor(
    options: {
      tfidfConfig?: Partial<TFIDFConfig>
      embeddingModel?: EmbeddingModel
      vectorStore?: VectorStore
    } = {},
  ) {
    this.tfidf = new EnhancedTFIDF(options.tfidfConfig)
    this.embeddingModel = options.embeddingModel ?? null
    this.vectorStore = options.vectorStore ?? null
  }

  get indexSize(): number {
    return this.items.size
  }

  async addItem(item: CodeEmbeddingItem): Promise<void> {
    this.tfidf.addDocument(item.id, item.content)
    this.items.set(item.id, item)

    if (this.embeddingModel && this.vectorStore) {
      const vector = await this.embeddingModel.embed(item.content)
      await this.vectorStore.upsert(item.id, vector, {
        type: item.type,
        filePath: item.filePath,
        startLine: item.startLine,
        endLine: item.endLine,
      })
    }
  }

  async addItems(items: CodeEmbeddingItem[]): Promise<void> {
    for (const item of items) {
      await this.addItem(item)
    }
  }

  async removeItem(id: string): Promise<void> {
    this.tfidf.removeDocument(id)
    this.items.delete(id)
    if (this.vectorStore) {
      await this.vectorStore.delete(id)
    }
  }

  searchText(query: string, topK = 10): SearchResult[] {
    return this.tfidf.search(query, topK).map((r) => ({
      id: r.docId,
      score: r.score,
      content: r.content,
    }))
  }

  async searchVector(query: string, topK = 10): Promise<SearchResult[]> {
    if (!this.embeddingModel || !this.vectorStore) return []
    const queryVec = await this.embeddingModel.embed(query)
    const entries = await this.vectorStore.query(queryVec, topK)
    return entries.map((e) => ({
      id: e.id,
      score: e.score ?? 0,
      metadata: e.metadata,
    }))
  }

  getItem(id: string): CodeEmbeddingItem | undefined {
    return this.items.get(id)
  }

  getTextVector(id: string): Map<string, number> | null {
    return this.tfidf.getVector(id)
  }
}

/**
 * Create a {@link CodeEmbeddingIndexer} instance.
 *
 * @param args - Constructor arguments forwarded to {@link CodeEmbeddingIndexer}.
 * @returns A new {@link CodeEmbeddingIndexer}.
 */
export function createCodeEmbeddingIndexer(
  ...args: ConstructorParameters<typeof CodeEmbeddingIndexer>
): CodeEmbeddingIndexer {
  return new CodeEmbeddingIndexer(...args)
}
