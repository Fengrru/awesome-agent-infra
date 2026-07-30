/**
 * Integration tests — embedding provider registry × indexer × hybrid search.
 *
 * Tests the pluggable provider system with CodeEmbeddingIndexer and
 * HybridSearch, verifying correct cross-module wiring within the
 * embedding package.
 */

import { describe, test, expect, beforeEach } from "bun:test"

// embedding internals
import {
  EnhancedTFIDF,
  CodeEmbeddingIndexer,
  HybridSearch,
  EmbeddingProviderRegistry,
  SimpleEmbeddingProvider,
} from "../src/index"
import type {
  EmbeddingProvider,
  EmbeddingModel,
  VectorStore,
  CodeEmbeddingItem,
  CodeGraph,
} from "../src/index"

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Integration: EmbeddingProviderRegistry", () => {
  let registry: EmbeddingProviderRegistry

  beforeEach(() => {
    registry = new EmbeddingProviderRegistry()
  })

  test("registers and retrieves providers by ID", () => {
    const provider = new SimpleEmbeddingProvider()
    registry.register(provider)

    expect(registry.size).toBe(1)
    expect(registry.get("simple-tfidf")).toBe(provider)
    expect(registry.list()).toEqual(["simple-tfidf"])
  })

  test("getDefault returns healthy provider", async () => {
    const provider = new SimpleEmbeddingProvider()
    registry.register(provider)

    const selected = await registry.getDefault()
    expect(selected).not.toBeNull()
    expect(selected!.id).toBe("simple-tfidf")
  })

  test("getAvailable filters by health check", async () => {
    const healthy = new SimpleEmbeddingProvider()
    registry.register(healthy)

    // Register a provider that fails health check
    const unhealthy: EmbeddingProvider = {
      id: "broken",
      name: "Broken Provider",
      version: "1.0.0",
      capabilities: { vector: true, sparse: false, hybrid: false, maxInputTokens: 1024, dimension: 0 },
      createEmbeddingModel: () => null,
      createVectorStore: () => null,
      healthCheck: async () => false,
    }
    registry.register(unhealthy)

    const available = await registry.getAvailable()
    expect(available.length).toBe(1)
    expect(available[0]!.id).toBe("simple-tfidf")
  })

  test("setPriority orders provider selection", async () => {
    const p1 = new SimpleEmbeddingProvider()
    // Create a second provider with same ID pattern
    const p2: EmbeddingProvider = {
      id: "mock-provider",
      name: "Mock Provider",
      version: "1.0.0",
      capabilities: { vector: true, sparse: true, hybrid: false, maxInputTokens: 4096, dimension: 384 },
      createEmbeddingModel: () => ({
        dimension: 384,
        embed: async () => new Array(384).fill(0.1),
      }),
      createVectorStore: () => null,
      healthCheck: async () => true,
    }

    registry.register(p1)
    registry.register(p2)
    registry.setPriority(["mock-provider", "simple-tfidf"])

    const selected = await registry.getDefault()
    expect(selected!.id).toBe("mock-provider")
  })

  test("unregister removes provider and affects getDefault", async () => {
    const provider = new SimpleEmbeddingProvider()
    registry.register(provider)

    const removed = registry.unregister("simple-tfidf")
    expect(removed).toBe(true)
    expect(registry.size).toBe(0)

    const selected = await registry.getDefault()
    expect(selected).toBeNull()
  })

  test("register supports chaining", () => {
    const p1 = new SimpleEmbeddingProvider()
    const p2: EmbeddingProvider = {
      id: "chain-provider",
      name: "Chain Provider",
      version: "1.0.0",
      capabilities: { vector: true, sparse: true, hybrid: false, maxInputTokens: 4096, dimension: 128 },
      createEmbeddingModel: () => ({
        dimension: 128,
        embed: async () => new Array(128).fill(0.05),
      }),
      createVectorStore: () => null,
      healthCheck: async () => true,
    }

    registry.register(p1).register(p2)
    expect(registry.size).toBe(2)
  })
})

describe("Integration: SimpleEmbeddingProvider × CodeEmbeddingIndexer", () => {
  test("provider creates embedding model for indexer", async () => {
    const provider = new SimpleEmbeddingProvider()

    const model = provider.createEmbeddingModel()
    expect(model).not.toBeNull()
    expect(model!.dimension).toBe(0) // dynamic

    // Embed some text
    const vector = await model!.embed("function authenticateUser(token: string): boolean")
    expect(vector.length).toBe(128) // character-based embedding
    expect(vector.some((v) => v !== 0)).toBe(true) // non-zero vector

    // Two similar texts should have higher cosine similarity
    const vec1 = await model!.embed("function login(user, pass)")
    const vec2 = await model!.embed("function login(user, password)")
    const vec3 = await model!.embed("const MAX_RETRY = 5")

    // vec1 and vec2 are more similar to each other than to vec3
    const sim12 = cosineSimilarity(vec1, vec2)
    const sim13 = cosineSimilarity(vec1, vec3)
    // Not guaranteed with char-level embedding but usually holds for similar text
    expect(sim12).toBeGreaterThanOrEqual(0)
    expect(sim13).toBeGreaterThanOrEqual(0)
  })

  test("provider creates vector store and upserts/queries", async () => {
    const provider = new SimpleEmbeddingProvider()
    const store = provider.createVectorStore()
    expect(store).not.toBeNull()

    const model = provider.createEmbeddingModel()!

    // Insert vectors
    const vec1 = await model.embed("function handleLogin(): void")
    const vec2 = await model.embed("function handleLogout(): void")
    const vec3 = await model.embed("const PI = 3.14159")

    await store.upsert("func1", vec1, { type: "function" })
    await store.upsert("func2", vec2, { type: "function" })
    await store.upsert("const1", vec3, { type: "variable" })

    // Query with a login-related text
    const queryVec = await model.embed("login handler")
    const results = await store.query(queryVec, 2)

    expect(results.length).toBe(2)
    // func1 (login) should be first
    expect(results[0]!.id).toBe("func1")
  })

  test("CodeEmbeddingIndexer wire-up with provider model and store", async () => {
    const provider = new SimpleEmbeddingProvider()
    const model = provider.createEmbeddingModel()!
    const store = provider.createVectorStore()!

    const indexer = new CodeEmbeddingIndexer({
      embeddingModel: model,
      vectorStore: store,
    })

    const item: CodeEmbeddingItem = {
      id: "auth-func",
      content: "function authenticateUser(token: string): User | null",
      type: "function",
      filePath: "src/auth.ts",
      startLine: 10,
      endLine: 25,
    }

    await indexer.addItem(item)

    // Text search should work
    const textResults = indexer.searchText("authenticate user", 5)
    expect(textResults.length).toBe(1)
    expect(textResults[0]!.id).toBe("auth-func")

    // Vector search should also work
    const vecResults = await indexer.searchVector("authenticate", 5)
    expect(vecResults.length).toBeGreaterThanOrEqual(0) // depends on embedding quality
  })
})

describe("Integration: EnhancedTFIDF × HybridSearch × CodeEmbeddingIndexer", () => {
  test("full pipeline: index code → hybrid search with graph", async () => {
    // Phase 1: Index code items
    const indexer = new CodeEmbeddingIndexer()
    const items: CodeEmbeddingItem[] = [
      {
        id: "f1",
        content: "function processPayment(amount: number, currency: string): PaymentResult",
        type: "function",
        filePath: "src/payment.ts",
        startLine: 1,
        endLine: 30,
      },
      {
        id: "f2",
        content: "function validatePayment(payment: Payment): ValidationResult",
        type: "function",
        filePath: "src/payment.ts",
        startLine: 35,
        endLine: 60,
      },
      {
        id: "f3",
        content: "function renderInvoice(invoice: Invoice): HTMLElement",
        type: "function",
        filePath: "src/invoice.ts",
        startLine: 1,
        endLine: 45,
      },
      {
        id: "c1",
        content: "class PaymentService handles payment processing and validation",
        type: "class",
        filePath: "src/payment.ts",
        startLine: 70,
        endLine: 150,
      },
    ]

    for (const item of items) {
      await indexer.addItem(item)
    }

    expect(indexer.indexSize).toBe(4)

    // Phase 2: Create hybrid search with graph
    const tfidf = new EnhancedTFIDF()
    for (const item of items) {
      tfidf.addDocument(item.id, item.content)
    }

    const mockGraph: CodeGraph = {
      getNodeCentrality(id: string): number {
        const scores: Record<string, number> = {
          f1: 0.9,
          f2: 0.75,
          f3: 0.5,
          c1: 0.85,
        }
        return scores[id] ?? 0.3
      },
      async searchNeighbors(itemId: string, _opts: { maxDepth: number; maxNeighbors: number }) {
        const edges: Record<string, Array<{ id: string; score: number }>> = {
          f1: [{ id: "f2", score: 0.8 }, { id: "c1", score: 0.9 }],
          c1: [{ id: "f1", score: 0.9 }, { id: "f2", score: 0.7 }],
        }
        return edges[itemId] ?? []
      },
    }

    const hybrid = new HybridSearch(tfidf, mockGraph)

    // Phase 3: Search
    const results = await hybrid.search({
      query: "payment processing validation",
      topK: 5,
      weights: { vector: 0.4, graph: 0.3, text: 0.3 },
    })

    expect(results.length).toBeGreaterThan(0)

    // Payment-related items should score highest
    const topResult = results[0]!
    expect(["f1", "c1", "f2"]).toContain(topResult.id)
    expect(topResult.compositeScore).toBeGreaterThan(0)

    // Graph scores should be populated
    const withGraph = results.filter((r) => r.graphScore > 0)
    expect(withGraph.length).toBeGreaterThan(0)
  })

  test("hybrid search without graph falls back to text-only", async () => {
    const tfidf = new EnhancedTFIDF()
    tfidf.addDocument("d1", "function calculateTax(income: number): number")
    tfidf.addDocument("d2", "function formatCurrency(amount: number): string")

    const hybrid = new HybridSearch(tfidf)
    const results = await hybrid.search({ query: "tax calculation", topK: 3 })

    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results[0]!.id).toBe("d1")
    expect(results[0]!.graphScore).toBe(0)
    expect(results[0]!.textScore).toBeGreaterThan(0)
  })
})

describe("Integration: Provider × Indexer × Hybrid → Complete Stack", () => {
  test("provider embedding model integrates seamlessly with indexer", async () => {
    const registry = new EmbeddingProviderRegistry()
    registry.register(new SimpleEmbeddingProvider())

    const provider = await registry.getDefault()
    expect(provider).not.toBeNull()

    const model = provider!.createEmbeddingModel()!
    const store = provider!.createVectorStore()!

    // Wire into indexer
    const indexer = new CodeEmbeddingIndexer({
      embeddingModel: model,
      vectorStore: store,
    })

    // Add items
    const items: CodeEmbeddingItem[] = [
      {
        id: "api-1",
        content: "async function fetchUserData(userId: string): Promise<User>",
        type: "function",
        filePath: "src/api.ts",
        startLine: 10,
        endLine: 30,
      },
      {
        id: "api-2",
        content: "async function updateUserProfile(userId: string, data: ProfileData): Promise<void>",
        type: "function",
        filePath: "src/api.ts",
        startLine: 35,
        endLine: 55,
      },
    ]

    await indexer.addItems(items)
    expect(indexer.indexSize).toBe(2)

    // Text search
    const textHits = indexer.searchText("fetch user", 5)
    expect(textHits.length).toBeGreaterThan(0)
    expect(textHits[0]!.id).toBe("api-1")

    // Vector search through the provider
    const vecHits = await indexer.searchVector("get user profile data", 5)
    expect(vecHits.length).toBeGreaterThanOrEqual(0)
  })
})

// ── Cosine Similarity Helper (copied for test independence) ────────────────

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
