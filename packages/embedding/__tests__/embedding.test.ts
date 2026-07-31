import { beforeEach, describe, expect, it } from "bun:test"
import { CodeEmbeddingIndexer, EnhancedTFIDF, HybridSearch } from "../src/index"
import type { CodeEmbeddingItem, CodeGraph } from "../src/types"

describe("EnhancedTFIDF", () => {
  let tfidf: EnhancedTFIDF

  beforeEach(() => {
    tfidf = new EnhancedTFIDF()
  })

  it("starts with zero documents", () => {
    expect(tfidf.documentCount).toBe(0)
    expect(tfidf.vocabularySize).toBe(0)
  })

  it("adds documents and returns search results", () => {
    tfidf.addDocument("doc1", "function parseUserInput(input: string): User")
    tfidf.addDocument("doc2", "function validateForm(data: FormData): boolean")
    tfidf.addDocument("doc3", "class UserManager manages user sessions")

    expect(tfidf.documentCount).toBe(3)
    expect(tfidf.vocabularySize).toBeGreaterThan(0)

    const results = tfidf.search("parse user input", 5)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].docId).toBe("doc1")
  })

  it("handles CamelCase token splitting", () => {
    tfidf.addDocument("doc1", "function getUserPreferences(): Preferences")
    tfidf.addDocument("doc2", "function setAdminMode(): void")

    // "getUserPreferences" should split into get/user/preferences
    const results = tfidf.search("admin", 5)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].docId).toBe("doc2")
  })

  it("handles snake_case token splitting", () => {
    tfidf.addDocument("doc1", "const MAX_RETRY_COUNT = 5")
    tfidf.addDocument("doc2", "const MIN_CONNECT_TIMEOUT = 1000")

    const results = tfidf.search("retry count", 5)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].docId).toBe("doc1")
  })

  it("supports n-gram expansion", () => {
    const ngramTfidf = new EnhancedTFIDF({ ngramMin: 2, ngramMax: 3 })
    ngramTfidf.addDocument("doc1", "function initializeDatabase(): void")
    ngramTfidf.addDocument("doc2", "function cleanupConnections(): void")

    // "initialize" has substrings that may match
    const results = ngramTfidf.search("init", 5)
    expect(results.length).toBeGreaterThan(0)
  })

  it("removes documents correctly", () => {
    tfidf.addDocument("doc1", "function hello(): void")
    tfidf.addDocument("doc2", "function world(): void")
    expect(tfidf.documentCount).toBe(2)

    tfidf.removeDocument("doc1")
    expect(tfidf.documentCount).toBe(1)
    expect(tfidf.search("hello", 5)).toEqual([])
  })

  it("handles empty search query", () => {
    tfidf.addDocument("doc1", "some content here")
    const results = tfidf.search("", 5)
    expect(results).toEqual([])
  })

  it("addDocuments batch adds correctly", () => {
    tfidf.addDocuments([
      { id: "a", content: "function foo() {}" },
      { id: "b", content: "function bar() {}" },
      { id: "c", content: "function baz() {}" },
    ])
    expect(tfidf.documentCount).toBe(3)
  })

  it("cosine similarity returns 0 for identical vectors with 0 magnitude", () => {
    const emptyResults = tfidf.search("xyznonexistenttoken", 5)
    expect(emptyResults).toEqual([])
  })

  it("cosineSimilarity between unrelated documents is low", () => {
    tfidf.addDocument("d1", "function processPayment(amount: number)")
    tfidf.addDocument("d2", "function renderUI(element: HTMLElement)")
    const results = tfidf.search("payment", 5)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].docId).toBe("d1")
  })

  it("clear resets all state", () => {
    tfidf.addDocument("doc1", "some content")
    tfidf.clear()
    expect(tfidf.documentCount).toBe(0)
    expect(tfidf.vocabularySize).toBe(0)
    expect(tfidf.search("content", 5)).toEqual([])
  })
})

describe("CodeEmbeddingIndexer", () => {
  it("adds and searches code items", () => {
    const indexer = new CodeEmbeddingIndexer()
    const item: CodeEmbeddingItem = {
      id: "func1",
      content: "function authenticateUser(token: string): boolean",
      type: "function",
      filePath: "src/auth.ts",
      startLine: 10,
      endLine: 20,
    }
    indexer.addItem(item)

    expect(indexer.indexSize).toBe(1)
    const results = indexer.searchText("authenticate user", 5)
    expect(results.length).toBe(1)
    expect(results[0].id).toBe("func1")
  })

  it("addItems batches multiple items", async () => {
    const indexer = new CodeEmbeddingIndexer()
    const items: CodeEmbeddingItem[] = [
      {
        id: "c1",
        content: "class UserRepository",
        type: "class",
        filePath: "src/user.ts",
        startLine: 1,
        endLine: 50,
      },
      {
        id: "c2",
        content: "class OrderService",
        type: "class",
        filePath: "src/order.ts",
        startLine: 1,
        endLine: 80,
      },
    ]
    await indexer.addItems(items)
    expect(indexer.indexSize).toBe(2)
  })

  it("removes items", () => {
    const indexer = new CodeEmbeddingIndexer()
    indexer.addItem({
      id: "f1",
      content: "function test() {}",
      type: "function",
      filePath: "test.ts",
      startLine: 1,
      endLine: 3,
    })
    indexer.removeItem("f1")
    expect(indexer.indexSize).toBe(0)
    expect(indexer.getItem("f1")).toBeUndefined()
  })

  it("searchVector returns empty without embedding model", async () => {
    const indexer = new CodeEmbeddingIndexer()
    const results = await indexer.searchVector("query", 5)
    expect(results).toEqual([])
  })

  it("getItem returns undefined for unknown id", () => {
    const indexer = new CodeEmbeddingIndexer()
    expect(indexer.getItem("unknown")).toBeUndefined()
  })
})

describe("HybridSearch", () => {
  it("performs hybrid search with text-only scoring", async () => {
    const tfidf = new EnhancedTFIDF()
    tfidf.addDocument("doc1", "function handleLoginRequest(req: Request): Response")
    tfidf.addDocument("doc2", "function handleLogoutRequest(req: Request): void")
    tfidf.addDocument("doc3", "function validateToken(tok: string): boolean")

    const hybrid = new HybridSearch(tfidf)
    const results = await hybrid.search({
      query: "login token",
      topK: 5,
    })

    expect(results.length).toBeGreaterThan(0)
    for (const r of results) {
      expect(r.compositeScore).toBeGreaterThanOrEqual(0)
      expect(r.graphScore).toBe(0)
    }
  })

  it("returns empty for non-matching query", async () => {
    const tfidf = new EnhancedTFIDF({ ngramMin: 3, ngramMax: 4 })
    tfidf.addDocument("doc1", "function foo(): void")
    const hybrid = new HybridSearch(tfidf)
    const results = await hybrid.search({
      query: "qqqqwwwwxxxxyyyy",
      topK: 5,
    })
    expect(results).toEqual([])
  })

  it("respects topK limit", async () => {
    const tfidf = new EnhancedTFIDF()
    for (let i = 0; i < 20; i++) {
      tfidf.addDocument(`doc${i}`, `function process_${i}(data: any): void`)
    }
    const hybrid = new HybridSearch(tfidf)
    const results = await hybrid.search({
      query: "process",
      topK: 3,
    })
    expect(results.length).toBeLessThanOrEqual(3)
  })

  it("respects minScore filter", async () => {
    const tfidf = new EnhancedTFIDF()
    tfidf.addDocument("doc1", "function login(): void { return authenticate() }")
    tfidf.addDocument("doc2", "const PI = 3.14")
    const hybrid = new HybridSearch(tfidf)
    const results = await hybrid.search({
      query: "login",
      topK: 10,
      minScore: 0.9,
    })
    expect(results.length).toBeLessThanOrEqual(1)
  })

  it("integrates CodeGraph for graph scoring when provided", async () => {
    const tfidf = new EnhancedTFIDF()
    tfidf.addDocument("node1", "function initApp(): void { setup() }")
    tfidf.addDocument("node2", "function setup(): void { configure() }")

    const mockGraph: CodeGraph = {
      getNodeCentrality(id: string): number {
        return id === "node1" ? 0.8 : 0.2
      },
      async searchNeighbors(itemId: string, _opts: { maxDepth: number; maxNeighbors: number }) {
        if (itemId === "node1") {
          return [{ id: "node2", score: 0.7 }]
        }
        return []
      },
    }

    const hybrid = new HybridSearch(tfidf, mockGraph)
    const results = await hybrid.search({
      query: "init setup",
      topK: 5,
    })

    expect(results.length).toBeGreaterThan(0)
    const node1 = results.find((r) => r.id === "node1")
    expect(node1).toBeDefined()
    expect(node1!.graphScore).toBe(0.8)
  })
})
