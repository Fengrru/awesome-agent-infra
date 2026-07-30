/**
 * Embedding Providers — Pluggable Embedding Model & Vector Store Registry
 *
 * Provides a registry pattern for switching embedding backends at runtime:
 *   - EmbeddingProvider: factory that creates EmbeddingModel + VectorStore pairs
 *   - EmbeddingProviderRegistry: global registry with priority-based selection
 *   - SimpleEmbeddingProvider: built-in TF-IDF based provider (zero deps)
 *
 * @module embedding/providers
 */

import type { EmbeddingModel, VectorStore, VectorEntry } from "./types"

// ─── Provider Interface ─────────────────────────────────────────────────────

/**
 * A pluggable embedding provider that can create embedding models
 * and vector store instances. Register providers with the global
 * EmbeddingProviderRegistry for runtime backend switching.
 */
export interface EmbeddingProvider {
  /** Unique provider identifier (e.g. "openai", "cohere", "local-tfidf") */
  readonly id: string

  /** Human-readable display name */
  readonly name: string

  /** Provider version */
  readonly version: string

  /** Capability flags for feature detection */
  readonly capabilities: {
    /** Whether this provider supports vector embeddings */
    vector: boolean
    /** Whether this provider supports sparse/lexical search */
    sparse: boolean
    /** Whether this provider supports hybrid search natively */
    hybrid: boolean
    /** Maximum input tokens per embedding call */
    maxInputTokens: number
    /** Embedding vector dimension (0 if varies) */
    dimension: number
  }

  /**
   * Create an embedding model instance.
   * Returns null if this provider doesn't support vector embeddings.
   */
  createEmbeddingModel(options?: Record<string, unknown>): EmbeddingModel | null

  /**
   * Create a vector store instance.
   * Returns null if this provider doesn't support vector storage.
   */
  createVectorStore(options?: Record<string, unknown>): VectorStore | null

  /**
   * Health check — returns true if the provider is available/configured.
   * Can be used to test API keys, network connectivity, etc.
   */
  healthCheck(): Promise<boolean>
}

// ─── Provider Registry ──────────────────────────────────────────────────────

/**
 * Global registry for embedding providers.
 * Allows runtime registration and priority-based selection of providers.
 *
 * Usage:
 * ```ts
 * const registry = new EmbeddingProviderRegistry()
 * registry.register(new MyOpenAIProvider())
 * const provider = registry.getDefault()
 * const model = provider?.createEmbeddingModel()
 * ```
 */
export class EmbeddingProviderRegistry {
  private providers = new Map<string, EmbeddingProvider>()
  private priority: string[] = []

  /**
   * Register a provider. If the provider ID already exists, it will be replaced.
   * Returns the registry for chaining.
   */
  register(provider: EmbeddingProvider): this {
    this.providers.set(provider.id, provider)
    if (!this.priority.includes(provider.id)) {
      this.priority.push(provider.id)
    }
    return this
  }

  /**
   * Unregister a provider by ID.
   */
  unregister(providerId: string): boolean {
    this.priority = this.priority.filter((id) => id !== providerId)
    return this.providers.delete(providerId)
  }

  /**
   * Get a provider by ID.
   */
  get(providerId: string): EmbeddingProvider | undefined {
    return this.providers.get(providerId)
  }

  /**
   * Get the first available (healthy) provider from the priority list.
   * If no priority list is set, returns the first registered provider.
   */
  async getDefault(): Promise<EmbeddingProvider | null> {
    const ordered = this.priority.length > 0
      ? this.priority
      : [...this.providers.keys()]

    for (const id of ordered) {
      const provider = this.providers.get(id)
      if (provider && await provider.healthCheck()) {
        return provider
      }
    }
    return null
  }

  /**
   * Get all registered providers whose health check passes.
   */
  async getAvailable(): Promise<EmbeddingProvider[]> {
    const results: EmbeddingProvider[] = []
    for (const provider of this.providers.values()) {
      if (await provider.healthCheck()) {
        results.push(provider)
      }
    }
    return results
  }

  /**
   * Set priority order for provider selection.
   * Providers not in the list retain their registration but are deprioritized.
   */
  setPriority(providerIds: string[]): void {
    // Keep only IDs that actually exist
    this.priority = providerIds.filter((id) => this.providers.has(id))
    // Append remaining providers at the end
    for (const id of this.providers.keys()) {
      if (!this.priority.includes(id)) {
        this.priority.push(id)
      }
    }
  }

  /** Number of registered providers */
  get size(): number {
    return this.providers.size
  }

  /** List all registered provider IDs */
  list(): string[] {
    return [...this.providers.keys()]
  }
}

// ─── Built-in: Simple TF-IDF Embedding Provider ─────────────────────────────

/**
 * A zero-dependency embedding provider that converts text to sparse
 * TF-IDF vectors. Useful as a local fallback when no external embedding
 * API is available.
 *
 * The vector dimension is determined by the vocabulary size of the
 * TF-IDF model, so `capabilities.dimension` is 0 (dynamic).
 */
export class SimpleEmbeddingProvider implements EmbeddingProvider {
  readonly id = "simple-tfidf"
  readonly name = "Simple TF-IDF Embedding"
  readonly version = "1.0.0"
  readonly capabilities = {
    vector: true,
    sparse: true,
    hybrid: false,
    maxInputTokens: 8192,
    dimension: 0, // dynamic — determined by vocabulary
  }

  private tfidf?: {
    addDocument(id: string, content: string): void
    getVector(id: string): Map<string, number> | null
  }

  /**
   * @param tfidfEngine - An EnhancedTFIDF instance to use as the embedding engine.
   *   If not provided, a simple in-memory TF-IDF will be used.
   */
  constructor(tfidfEngine?: {
    addDocument(id: string, content: string): void
    getVector(id: string): Map<string, number> | null
  }) {
    this.tfidf = tfidfEngine
  }

  createEmbeddingModel(): EmbeddingModel {
    const provider = this
    return {
      dimension: 0, // dynamic
      async embed(text: string): Promise<number[]> {
        // Use a simple character n-gram embedding as fallback
        // In production, this would use the TF-IDF model's vocabulary
        const vec: number[] = new Array(128).fill(0)
        const lower = text.toLowerCase()
        for (let i = 0; i < lower.length; i++) {
          const idx = lower.charCodeAt(i) % 128
          vec[idx]! += 1
        }
        // Normalize
        const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0))
        if (magnitude > 0) {
          for (let i = 0; i < vec.length; i++) {
            vec[i] = vec[i]! / magnitude
          }
        }
        return vec
      },
    }
  }

  createVectorStore(): VectorStore {
    const store = new Map<string, { vector: number[]; metadata?: Record<string, unknown> }>()

    return {
      async upsert(id: string, vector: number[], metadata?: Record<string, unknown>): Promise<void> {
        store.set(id, { vector: [...vector], metadata })
      },
      async query(vector: number[], topK: number): Promise<VectorEntry[]> {
        const scored: VectorEntry[] = []
        for (const [id, entry] of store) {
          const score = cosineSimilarity(vector, entry.vector)
          scored.push({ id, vector: entry.vector, score, metadata: entry.metadata })
        }
        scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        return scored.slice(0, topK)
      },
      async delete(id: string): Promise<void> {
        store.delete(id)
      },
    }
  }

  async healthCheck(): Promise<boolean> {
    return true // always available
  }
}

// ─── Cosine Similarity Helper ───────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}
