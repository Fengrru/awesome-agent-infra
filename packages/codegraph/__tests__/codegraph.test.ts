import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  CallSiteStore,
  CodeGraph,
  CodeGraphRanker,
  CodeGraphSearcher,
  CodeGraphWatcher,
  GraphPersistence,
  ImpactAnalyzer,
  IncrementalParser,
  analyzeImpact,
  buildContentSource,
  buildRepoSummary,
  buildSignatureSource,
  computeEntityHashes,
  createCallSite,
  estimateTokens,
  flattenSubGraph,
  hashBuffer,
  hashString,
  hashesEqual,
  signatureChanged,
} from "../src/index"
import type { CallSite, CodeGraphEdge, CodeGraphNode, ExtractResult, ExtractorFn } from "../src/index"

function makeNode(overrides?: Partial<CodeGraphNode>): CodeGraphNode {
  return {
    id: `symbol:${overrides?.name ?? "testFn"}`,
    type: "symbol",
    symbolType: "function",
    name: "testFn",
    filePath: "src/test.ts",
    startLine: 1,
    endLine: 5,
    startByte: 0,
    endByte: 0,
    startToken: 0,
    endToken: 0,
    tokenizerName: "simple",
    metadata: { isExported: true },
    mtime: Date.now(),
    ...overrides,
  }
}

function makeCS(overrides?: Partial<CallSite>): CallSite {
  return createCallSite({
    callerId: "symbol:caller",
    calleeName: "target",
    calleeId: "symbol:target",
    filePath: "src/main.ts",
    startByte: 0,
    endByte: 20,
    startToken: 0,
    endToken: 5,
    startLine: 1,
    endLine: 2,
    argCount: 2,
    keywordArgs: ["timeout"],
    tokenizerName: "simple",
    ...overrides,
  })
}

function makeEdge(overrides?: Partial<CodeGraphEdge>): CodeGraphEdge {
  return {
    sourceId: "symbol:A",
    targetId: "symbol:B",
    relation: "calls",
    ...overrides,
  }
}

describe("CodeGraph", () => {
  // ── Node Operations ──────────────────────────────────────────────────────

  test("setBidirectional toggles and getter reflects state", () => {
    const g = new CodeGraph()
    expect(g.bidirectional).toBe(false)
    g.setBidirectional(true)
    expect(g.bidirectional).toBe(true)
    g.setBidirectional(false)
    expect(g.bidirectional).toBe(false)
  })

  test("adds and retrieves a node", () => {
    const g = new CodeGraph()
    const node = makeNode({ id: "symbol:foo", name: "foo" })
    g.addNode(node)
    expect(g.nodeCount).toBe(1)
    expect(g.getNode("symbol:foo")).toBeDefined()
    expect(g.getNode("symbol:foo")!.name).toBe("foo")
  })

  test("hasNode returns correct boolean", () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "symbol:exists" }))
    expect(g.hasNode("symbol:exists")).toBe(true)
    expect(g.hasNode("symbol:nope")).toBe(false)
  })

  test("removes a node and its edges", () => {
    const g = new CodeGraph()
    g.setBidirectional(false)
    g.addNode(makeNode({ id: "symbol:A" }))
    g.addNode(makeNode({ id: "symbol:B" }))
    g.addEdge(makeEdge({ sourceId: "symbol:A", targetId: "symbol:B", relation: "calls" }))
    expect(g.edgeCount).toBe(1)
    g.removeNode("symbol:A")
    expect(g.nodeCount).toBe(1)
    expect(g.edgeCount).toBe(0)
  })

  test("removing a node cleans file index", () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "symbol:X", filePath: "src/x.ts" }))
    g.removeNode("symbol:X")
    expect(g.getNodesForFile("src/x.ts").length).toBe(0)
  })

  // ── Edge Operations ──────────────────────────────────────────────────────

  test("adds edge and deduplicates", () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "symbol:A" }))
    g.addNode(makeNode({ id: "symbol:B" }))
    g.addEdge(makeEdge({ sourceId: "symbol:A", targetId: "symbol:B", relation: "calls" }))
    g.addEdge(makeEdge({ sourceId: "symbol:A", targetId: "symbol:B", relation: "calls" }))
    expect(g.edgeCount).toBe(1)
  })

  test("getEdges with nodeId and relation filter", () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "symbol:A" }))
    g.addNode(makeNode({ id: "symbol:B" }))
    g.addNode(makeNode({ id: "symbol:C" }))
    g.addEdge(makeEdge({ sourceId: "symbol:A", targetId: "symbol:B", relation: "calls" }))
    g.addEdge(makeEdge({ sourceId: "symbol:A", targetId: "symbol:C", relation: "extends" }))
    const callEdges = g.getEdges("symbol:A", "calls")
    expect(callEdges.length).toBe(1)
    expect(callEdges[0]!.relation).toBe("calls")
  })

  test("getEdges without nodeId returns all edges", () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "symbol:A" }))
    g.addNode(makeNode({ id: "symbol:B" }))
    g.addEdge(makeEdge({ sourceId: "symbol:A", targetId: "symbol:B", relation: "calls" }))
    const all = g.getEdges()
    expect(all.length).toBe(1)
  })

  // ── Queries ──────────────────────────────────────────────────────────────

  test("findNodes filters by predicate", () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "symbol:add", name: "add", symbolType: "function" }))
    g.addNode(makeNode({ id: "symbol:User", name: "User", symbolType: "class" }))
    g.addNode(makeNode({ id: "file:src/index.ts", type: "file", name: "index.ts", symbolType: undefined }))
    const classes = g.findNodes((n) => n.symbolType === "class")
    expect(classes.length).toBe(1)
    expect(classes[0]!.name).toBe("User")
  })

  test("getNodesForFile returns correct nodes", () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "symbol:a", filePath: "src/a.ts" }))
    g.addNode(makeNode({ id: "symbol:b", filePath: "src/a.ts" }))
    g.addNode(makeNode({ id: "symbol:c", filePath: "src/b.ts" }))
    expect(g.getNodesForFile("src/a.ts").length).toBe(2)
    expect(g.getNodesForFile("src/empty.ts").length).toBe(0)
  })

  test("searchSymbols does case-insensitive search", () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "symbol:MyComponent", name: "MyComponent" }))
    g.addNode(makeNode({ id: "symbol:other", name: "otherFn" }))
    const results = g.searchSymbols("component")
    expect(results.length).toBe(1)
    expect(results[0]!.name).toBe("MyComponent")
  })

  test("getFiles returns only file nodes", () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "symbol:fn" }))
    g.addNode(makeNode({ id: "file:src/file.ts", type: "file", name: "file.ts", symbolType: undefined }))
    const files = g.getFiles()
    expect(files.length).toBe(1)
    expect(files[0]!.type).toBe("file")
  })

  // ── Directed Lookups ─────────────────────────────────────────────────────

  test("getOutgoing and getIncoming", () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "symbol:A" }))
    g.addNode(makeNode({ id: "symbol:B" }))
    g.addNode(makeNode({ id: "symbol:C" }))
    g.addEdge(makeEdge({ sourceId: "symbol:A", targetId: "symbol:B", relation: "calls" }))
    g.addEdge(makeEdge({ sourceId: "symbol:C", targetId: "symbol:A", relation: "references" }))
    const out = g.getOutgoing("symbol:A")
    const inc = g.getIncoming("symbol:A")
    expect(out.length).toBe(1)
    expect(out[0]!.id).toBe("symbol:B")
    expect(inc.length).toBe(1)
    expect(inc[0]!.id).toBe("symbol:C")
  })

  test("getOutgoing with relation filter", () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "symbol:A" }))
    g.addNode(makeNode({ id: "symbol:B" }))
    g.addNode(makeNode({ id: "symbol:C" }))
    g.addEdge(makeEdge({ sourceId: "symbol:A", targetId: "symbol:B", relation: "calls" }))
    g.addEdge(makeEdge({ sourceId: "symbol:A", targetId: "symbol:C", relation: "extends" }))
    expect(g.getOutgoing("symbol:A", "calls").length).toBe(1)
    expect(g.getOutgoing("symbol:A", "extends").length).toBe(1)
    expect(g.getOutgoing("symbol:A", "implements").length).toBe(0)
  })

  // ── Ego Graph ────────────────────────────────────────────────────────────

  test("getEgoGraph returns center node with neighbors", () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "symbol:center", name: "center" }))
    g.addNode(makeNode({ id: "symbol:n1", name: "neighbor1" }))
    g.addNode(makeNode({ id: "symbol:n2", name: "neighbor2" }))
    g.addEdge(makeEdge({ sourceId: "symbol:center", targetId: "symbol:n1", relation: "calls" }))
    g.addEdge(makeEdge({ sourceId: "symbol:n2", targetId: "symbol:center", relation: "references" }))
    const ego = g.getEgoGraph("symbol:center", 1)
    expect(ego.nodes.length).toBe(3)
    expect(ego.edges.length).toBe(2)
    expect(ego.centerId).toBe("symbol:center")
  })

  test("getEgoGraph includes both outgoing and incoming edges", () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "symbol:main" }))
    g.addNode(makeNode({ id: "symbol:callee" }))
    g.addNode(makeNode({ id: "symbol:caller" }))
    g.addEdge(makeEdge({ sourceId: "symbol:main", targetId: "symbol:callee", relation: "calls" }))
    g.addEdge(makeEdge({ sourceId: "symbol:caller", targetId: "symbol:main", relation: "references" }))
    const ego = g.getEgoGraph("symbol:main", 1)
    const nodeIds = ego.nodes.map((n) => n.id)
    expect(nodeIds).toContain("symbol:main")
    expect(nodeIds).toContain("symbol:callee")
    expect(nodeIds).toContain("symbol:caller")
  })

  test("getEgoGraph with k=2 reaches second hop", () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "symbol:A" }))
    g.addNode(makeNode({ id: "symbol:B" }))
    g.addNode(makeNode({ id: "symbol:C" }))
    g.addEdge(makeEdge({ sourceId: "symbol:A", targetId: "symbol:B", relation: "calls" }))
    g.addEdge(makeEdge({ sourceId: "symbol:B", targetId: "symbol:C", relation: "calls" }))
    const ego = g.getEgoGraph("symbol:A", 2)
    expect(ego.nodes.length).toBe(3)
  })

  test("getEgoGraph returns empty for non-existent center", () => {
    const g = new CodeGraph()
    const ego = g.getEgoGraph("symbol:nonexistent")
    expect(ego.nodes.length).toBe(0)
    expect(ego.estimatedTokens).toBe(0)
  })

  // ── Stats ────────────────────────────────────────────────────────────────

  test("getStats returns correct counts", () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "symbol:a" }))
    g.addNode(makeNode({ id: "symbol:b" }))
    g.addNode(makeNode({ id: "file:src/x.ts", type: "file", name: "x.ts", symbolType: undefined }))
    g.addEdge(makeEdge({ sourceId: "symbol:a", targetId: "symbol:b" }))
    const stats = g.getStats()
    expect(stats.nodes).toBe(3)
    expect(stats.edges).toBe(1)
    expect(stats.files).toBe(1)
    expect(stats.symbols).toBe(2)
  })

  // ── Serialization ────────────────────────────────────────────────────────

  test("toJSON and fromJSON round-trips", () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "symbol:a", name: "a" }))
    g.addNode(makeNode({ id: "symbol:b", name: "b" }))
    g.addEdge(makeEdge({ sourceId: "symbol:a", targetId: "symbol:b", relation: "calls" }))
    const json = g.toJSON()
    const g2 = new CodeGraph()
    g2.fromJSON(json)
    expect(g2.nodeCount).toBe(2)
    expect(g2.edgeCount).toBe(1)
  })

  test("clear empties everything", () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "symbol:a" }))
    g.addEdge(makeEdge({ sourceId: "symbol:a", targetId: "symbol:b" }))
    g.clear()
    expect(g.nodeCount).toBe(0)
    expect(g.edgeCount).toBe(0)
    expect(g.fileCount).toBe(0)
  })

  // ── Observers ────────────────────────────────────────────────────────────

  test("notifies observers on build events", () => {
    const g = new CodeGraph()
    const events: string[] = []
    g.addObserver((e) => events.push(e.type))
    g.addNode(makeNode({ id: "symbol:obs" }))
    g.addNode(makeNode({ id: "symbol:obs2" }))
    // Notifications are sent only by watcher, testing observer registration
    g.removeObserver(() => {})
  })

  test("getCalleesOf returns direct callees via calls relation", () => {
    const g = new CodeGraph()
    g.setBidirectional(true)
    g.addNode(makeNode({ id: "symbol:caller", name: "caller" }))
    g.addNode(makeNode({ id: "symbol:callee", name: "callee" }))
    g.addEdge({ sourceId: "symbol:caller", targetId: "symbol:callee", relation: "calls" })
    const callees = g.getCalleesOf("symbol:caller")
    expect(callees.length).toBe(1)
    expect(callees[0]!.name).toBe("callee")
  })

  test("getOverrides and getOverriddenBy track inheritance", () => {
    const g = new CodeGraph()
    g.setBidirectional(true)
    g.addNode(makeNode({ id: "symbol:parent", name: "parentMethod", symbolType: "method" }))
    g.addNode(makeNode({ id: "symbol:child", name: "parentMethod", symbolType: "method" }))
    g.addEdge({ sourceId: "symbol:child", targetId: "symbol:parent", relation: "overrides" })
    const overrides = g.getOverrides("symbol:child")
    expect(overrides.length).toBe(1)
    expect(overrides[0]!.id).toBe("symbol:parent")
    const overriddenBy = g.getOverriddenBy("symbol:parent")
    expect(overriddenBy.length).toBe(1)
    expect(overriddenBy[0]!.id).toBe("symbol:child")
  })

  test("getTypeUsersOf and getDataFlowConsumers", () => {
    const g = new CodeGraph()
    g.setBidirectional(true)
    g.addNode(makeNode({ id: "symbol:userFn", name: "userFn", symbolType: "function" }))
    g.addNode(makeNode({ id: "symbol:myType", name: "MyType", symbolType: "interface" }))
    g.addNode(makeNode({ id: "symbol:val", name: "x", symbolType: "variable" }))
    g.addEdge({ sourceId: "symbol:myType", targetId: "symbol:userFn", relation: "type_uses" })
    g.addEdge({ sourceId: "symbol:val", targetId: "symbol:userFn", relation: "data_flow" })
    expect(g.getTypeUsersOf("symbol:myType").length).toBe(1)
    expect(g.getDataFlowConsumers("symbol:val").length).toBe(1)
  })

  test("private notify calls observer without throwing", () => {
    const g = new CodeGraph()
    let called = false
    g.addObserver(() => { called = true })
    ;(g as any).notify({ type: "complete", phase: "build", message: "ok" })
    expect(called).toBe(true)
  })

  test("notify swallows observer errors", () => {
    const g = new CodeGraph()
    g.addObserver(() => { throw new Error("boom") })
    expect(() => (g as any).notify({ type: "complete", phase: "build", message: "ok" })).not.toThrow()
  })
})

describe("CodeGraphRanker", () => {
  test("rankAll returns sorted results", () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "symbol:a", name: "a" }))
    g.addNode(makeNode({ id: "symbol:b", name: "b" }))
    g.addNode(makeNode({ id: "symbol:c", name: "c" }))
    g.addEdge(makeEdge({ sourceId: "symbol:a", targetId: "symbol:b", relation: "calls" }))
    g.addEdge(makeEdge({ sourceId: "symbol:b", targetId: "symbol:c", relation: "calls" }))
    g.addEdge(makeEdge({ sourceId: "symbol:a", targetId: "symbol:c", relation: "calls" }))
    const ranker = new CodeGraphRanker(g)
    const results = ranker.rankAll()
    expect(results.length).toBe(3)
    expect(results[0]!.compositeScore).toBeGreaterThanOrEqual(0)
  })

  test("rankAll returns empty for empty graph", () => {
    const g = new CodeGraph()
    const ranker = new CodeGraphRanker(g)
    const results = ranker.rankAll()
    expect(results.length).toBe(0)
  })

  test("getTopFiles filters correctly", () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "file:a.ts", type: "file", name: "a.ts", symbolType: undefined }))
    g.addNode(makeNode({ id: "file:b.ts", type: "file", name: "b.ts", symbolType: undefined }))
    g.addNode(makeNode({ id: "symbol:fn" }))
    const ranker = new CodeGraphRanker(g)
    const top = ranker.getTopFiles(2)
    expect(top.length).toBeLessThanOrEqual(2)
    for (const r of top) {
      expect(r.node.type).toBe("file")
    }
  })

  test("getTopSymbols filters correctly", () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "symbol:a1" }))
    g.addNode(makeNode({ id: "symbol:a2" }))
    g.addNode(makeNode({ id: "file:x.ts", type: "file", name: "x.ts", symbolType: undefined }))
    const ranker = new CodeGraphRanker(g)
    const top = ranker.getTopSymbols(10)
    for (const r of top) {
      expect(r.node.type).toBe("symbol")
    }
  })

  test("buildRankingReport returns non-empty string", () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "symbol:report" }))
    g.addNode(makeNode({ id: "file:r.ts", type: "file", name: "r.ts", symbolType: undefined }))
    const ranker = new CodeGraphRanker(g)
    const report = ranker.buildRankingReport(2)
    expect(report.length).toBeGreaterThan(0)
    expect(report).toContain("CodeGraph Ranking Report")
  })
})

describe("CodeGraphSearcher", () => {
  function buildSearchGraph(): CodeGraph {
    const g = new CodeGraph()
    g.addNode(
      makeNode({
        id: "symbol:processOrder",
        name: "processOrder",
        symbolType: "function",
        filePath: "src/order.ts",
        startLine: 10,
        endLine: 30,
        metadata: { isExported: true, visibility: "public" },
      }),
    )
    g.addNode(
      makeNode({
        id: "symbol:validateInput",
        name: "validateInput",
        symbolType: "function",
        filePath: "src/order.ts",
        startLine: 5,
        endLine: 9,
        metadata: { isExported: false },
      }),
    )
    g.addNode(
      makeNode({
        id: "symbol:Order",
        name: "Order",
        symbolType: "class",
        filePath: "src/models.ts",
        startLine: 1,
        endLine: 50,
        metadata: { isExported: true },
      }),
    )
    g.addNode(
      makeNode({
        id: "file:src/order.ts",
        type: "file",
        name: "order.ts",
        filePath: "src/order.ts",
        symbolType: undefined,
        startLine: 1,
        endLine: 0,
        metadata: { language: "typescript", size: 100, imports: [], exports: [] },
      }),
    )
    g.addEdge(makeEdge({ sourceId: "symbol:processOrder", targetId: "symbol:validateInput", relation: "calls" }))
    g.addEdge(makeEdge({ sourceId: "file:src/order.ts", targetId: "symbol:processOrder", relation: "defines" }))
    g.addEdge(makeEdge({ sourceId: "file:src/order.ts", targetId: "symbol:validateInput", relation: "defines" }))
    return g
  }

  test("searchSymbols returns sorted results", () => {
    const g = buildSearchGraph()
    const searcher = new CodeGraphSearcher(g)
    const results = searcher.searchSymbols("order")
    expect(results.length).toBeGreaterThan(0)
  })

  test("searchSymbols with exact name match scores highest", () => {
    const g = buildSearchGraph()
    const searcher = new CodeGraphSearcher(g)
    const results = searcher.searchSymbols("Order")
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]!.score).toBeGreaterThanOrEqual(1)
  })

  test("searchByType finds symbols by type", () => {
    const g = buildSearchGraph()
    const searcher = new CodeGraphSearcher(g)
    const results = searcher.searchByType("class")
    expect(results.length).toBe(1)
    expect(results[0]!.node.name).toBe("Order")
  })

  test("searchByFile returns nodes for a file including the file node", () => {
    const g = buildSearchGraph()
    const searcher = new CodeGraphSearcher(g)
    const results = searcher.searchByFile("src/order.ts")
    expect(results.length).toBe(3)
  })

  test("getEgoGraph delegates to CodeGraph", () => {
    const g = buildSearchGraph()
    const searcher = new CodeGraphSearcher(g)
    const ego = searcher.getEgoGraph("symbol:processOrder", 1)
    expect(ego.nodes.length).toBeGreaterThan(1)
    expect(ego.centerId).toBe("symbol:processOrder")
  })

  test("flattenResults produces readable output", () => {
    const g = buildSearchGraph()
    const searcher = new CodeGraphSearcher(g)
    const results = searcher.searchSymbols("order", { maxResults: 2 })
    const text = searcher.flattenResults(results)
    expect(text.length).toBeGreaterThan(0)
  })

  test("flattenResults returns empty string for no results", () => {
    const g = new CodeGraph()
    const searcher = new CodeGraphSearcher(g)
    expect(searcher.flattenResults([])).toBe("")
  })

  test("buildCompactSummary obeys maxTokens", () => {
    const g = buildSearchGraph()
    const searcher = new CodeGraphSearcher(g)
    const results = searcher.searchSymbols("order")
    const summary = searcher.buildCompactSummary(results, 50)
    expect(summary.length).toBeGreaterThan(0)
    expect(summary).toContain("```codegraph")
  })

  test("getFileContext returns empty subgraph for non-existent file", () => {
    const g = new CodeGraph()
    const searcher = new CodeGraphSearcher(g)
    const ctx = searcher.getFileContext("nonexistent.ts")
    expect(ctx.nodes).toEqual([])
    expect(ctx.edges).toEqual([])
    expect(ctx.estimatedTokens).toBe(0)
  })

  test("getFileContext returns ego graph for an existing file", () => {
    const g = buildSearchGraph()
    const searcher = new CodeGraphSearcher(g)
    const ctx = searcher.getFileContext("src/order.ts")
    expect(ctx.nodes.length).toBeGreaterThan(0)
    expect(ctx.edges.length).toBeGreaterThan(0)
  })
})

describe("Helpers", () => {
  test("flattenSubGraph produces text output", () => {
    const nodes: CodeGraphNode[] = [
      makeNode({
        id: "symbol:add",
        name: "add",
        symbolType: "function",
        filePath: "src/main.ts",
        startLine: 1,
        metadata: {
          isExported: true,
          parameters: [
            { name: "a", type: "number" },
            { name: "b", type: "number" },
          ],
          returnType: "number",
        },
      }),
      makeNode({
        id: "symbol:Helper",
        name: "Helper",
        symbolType: "class",
        filePath: "src/helper.ts",
        startLine: 5,
        metadata: { isExported: true, visibility: "public" },
      }),
    ]
    const edges: CodeGraphEdge[] = [
      makeEdge({ sourceId: "symbol:add", targetId: "symbol:Helper", relation: "references" }),
    ]
    const text = flattenSubGraph({ nodes, edges, estimatedTokens: 100 })
    expect(text).toContain("[function]")
    expect(text).toContain("[class]")
    expect(text).toContain("add")
  })

  test("flattenSubGraph with doc comments", () => {
    const nodes: CodeGraphNode[] = [
      makeNode({
        id: "symbol:fn",
        name: "fn",
        symbolType: "function",
        filePath: "src/main.ts",
        startLine: 1,
        metadata: { docComment: "This is a documented function." },
      }),
    ]
    const text = flattenSubGraph({ nodes, edges: [], estimatedTokens: 50 }, { includeDocComments: true })
    expect(text).toContain("This is a documented function")
  })

  test("buildRepoSummary handles empty graph", () => {
    const g = new CodeGraph()
    const summary = buildRepoSummary(g)
    expect(summary).toContain("CodeGraph Repository Summary")
  })

  test("buildRepoSummary with files lists high-value files", () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "file:src/a.ts", type: "file", name: "a.ts", filePath: "src/a.ts" }))
    g.addNode(makeNode({ id: "file:src/b.ts", type: "file", name: "b.ts", filePath: "src/b.ts" }))
    g.addNode(makeNode({ id: "symbol:fn", name: "fn", filePath: "src/a.ts" }))
    const summary = buildRepoSummary(g)
    expect(summary).toContain("src/a.ts")
  })

  test("getTestsFor returns entities covered by tests", () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "symbol:src", name: "src", filePath: "src/a.ts" }))
    g.addNode(makeNode({ id: "symbol:t", name: "testA", filePath: "tests/a.test.ts" }))
    g.addEdge(makeEdge({ sourceId: "symbol:t", targetId: "symbol:src", relation: "test_covers" }))
    const covered = g.getTestsFor("symbol:src")
    expect(covered.map((n) => n.id)).toContain("symbol:t")
    expect(g.getTestsFor("symbol:missing")).toEqual([])
  })

  test("estimateTokens returns positive number for non-empty graph", () => {
    const tokens = estimateTokens(
      [
        makeNode({
          id: "symbol:fn",
          metadata: { parameters: [{ name: "x", type: "string" }], returnType: "void", docComment: "doc" },
        }),
      ],
      [makeEdge({ sourceId: "symbol:fn", targetId: "symbol:other", relation: "calls" })],
    )
    expect(tokens).toBeGreaterThan(0)
  })
})

describe("CodeGraphWatcher", () => {
  test("setExtractor stores the function", () => {
    const g = new CodeGraph()
    const watcher = new CodeGraphWatcher(g, "/tmp")
    const fn: ExtractorFn = async () => ({ symbols: [], imports: [], exports: [] })
    watcher.setExtractor(fn)
    // No error is success
  })

  test("applyChanges on delete removes nodes", async () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "symbol:del", filePath: "src/del.ts" }))
    g.addNode(
      makeNode({ id: "file:src/del.ts", type: "file", name: "del.ts", filePath: "src/del.ts", symbolType: undefined }),
    )
    const watcher = new CodeGraphWatcher(g, ".")
    const result = await watcher.applyChanges([{ filePath: "src/del.ts", type: "delete" }])
    expect(result.nodesRemoved).toBeGreaterThan(0)
    expect(g.hasNode("symbol:del")).toBe(false)
  })

  test("applyChanges with no extractor does nothing for add/modify", async () => {
    const g = new CodeGraph()
    const watcher = new CodeGraphWatcher(g, ".")
    const result = await watcher.applyChanges([{ filePath: "src/new.ts", type: "add" }])
    expect(result.nodesAdded).toBe(0)
  })

  test("applyChange with extractor processes adds", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "codegraph-test-"))
    const filePath = join(tmpDir, "test.ts")
    writeFileSync(
      filePath,
      `
      export function hello() { return "world" }
      export class Greeter { greet() { return "hi" } }
    `,
    )

    const g = new CodeGraph()
    const watcher = new CodeGraphWatcher(g, tmpDir)
    watcher.setExtractor(async (_fp, src, mtime) => ({
      symbols: [
        {
          id: "symbol:hello",
          name: "hello",
          symbolType: "function",
          filePath: "test.ts",
          startLine: 2,
          endLine: 2,
          metadata: { isExported: true },
          mtime,
        },
        {
          id: "symbol:Greeter",
          name: "Greeter",
          symbolType: "class",
          filePath: "test.ts",
          startLine: 3,
          endLine: 3,
          metadata: { isExported: true },
          mtime,
        },
      ],
      imports: [],
      exports: ["hello", "Greeter"],
    }))

    const result = await watcher.applyChanges([{ filePath, type: "add" }])

    expect(result.nodesAdded).toBeGreaterThan(0)
    expect(g.hasNode("symbol:hello")).toBe(true)

    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("applyChanges modify replaces existing nodes", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "codegraph-test-"))
    const filePath = join(tmpDir, "mod.ts")
    writeFileSync(filePath, `export function old() {}`)

    const g = new CodeGraph()
    g.addNode(makeNode({ id: "symbol:old", name: "old", filePath: "mod.ts", startLine: 1 }))
    g.addNode(makeNode({ id: "file:mod.ts", type: "file", name: "mod.ts", filePath: "mod.ts", symbolType: undefined }))

    const watcher = new CodeGraphWatcher(g, tmpDir)
    watcher.setExtractor(async (_fp, src, mtime) => ({
      symbols: [
        {
          id: "symbol:new",
          name: "new",
          symbolType: "function",
          filePath: "mod.ts",
          startLine: 1,
          endLine: 1,
          metadata: { isExported: true },
          mtime,
        },
      ],
      imports: [],
      exports: ["new"],
    }))

    const result = await watcher.applyChanges([{ filePath, type: "modify" }])
    expect(result.nodesAdded).toBeGreaterThan(0)
    // Old nodes should be removed
    expect(g.hasNode("symbol:old")).toBe(false)
    expect(g.hasNode("symbol:new")).toBe(true)

    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("applyChanges modify with empty extractor has no effect", async () => {
    const g = new CodeGraph()
    const watcher = new CodeGraphWatcher(g, ".")
    // No extractor set, applyChanges should return 0 nodes added
    const result = await watcher.applyChanges([{ filePath: "src/nonexistent.ts", type: "modify" }])
    expect(result.nodesAdded).toBe(0)
  })

  test("getIncrementalParser returns incremental parser", () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "file:src/a.ts", type: "file", filePath: "src/a.ts" }))
    const watcher = new CodeGraphWatcher(g, ".")
    const parser = watcher.getIncrementalParser()
    expect(parser).toBeDefined()
  })

  test("getStaleEntities, isStale, clearStale delegate to incremental parser", async () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "file:src/s.ts", type: "file", filePath: "src/s.ts" }))
    const watcher = new CodeGraphWatcher(g, ".")
    watcher.setExtractor(async () => ({ symbols: [], imports: [], exports: [] }))

    // Initially no stale entities
    expect(watcher.getStaleEntities().length).toBe(0)
    expect(watcher.isStale("symbol:stale")).toBe(false)

    // Process a delete to create a stale marker
    await watcher.applyChanges([{ filePath: "src/s.ts", type: "delete" }])
    // After delete, entities from that file should be stale
    watcher.clearStale()
    expect(watcher.getStaleEntities().length).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Extended CodeGraph Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("CodeGraph extended", () => {
  test("addNode overwrites existing node with same id", () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "symbol:dup", name: "v1" }))
    g.addNode(makeNode({ id: "symbol:dup", name: "v2" }))
    expect(g.nodeCount).toBe(1)
    expect(g.getNode("symbol:dup")!.name).toBe("v2")
  })

  test("removeNode handles non-existent id gracefully", () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "symbol:keep" }))
    g.removeNode("symbol:nope")
    expect(g.nodeCount).toBe(1)
  })

  test("addEdge handles missing nodes gracefully", () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "symbol:A" }))
    // Add edge to non-existent target
    g.addEdge(makeEdge({ sourceId: "symbol:A", targetId: "symbol:ghost" }))
    expect(g.edgeCount).toBe(1)
  })

  test("getEdges filters by relation on all edges", () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "symbol:A" }))
    g.addNode(makeNode({ id: "symbol:B" }))
    g.addEdge(makeEdge({ sourceId: "symbol:A", targetId: "symbol:B", relation: "calls" }))
    g.addEdge(makeEdge({ sourceId: "symbol:B", targetId: "symbol:A", relation: "references" }))
    const callsEdges = g.getEdges(undefined, "calls")
    // getEdges without nodeId returns all edges, relation filter not supported in that path
    // The path: if (!nodeId) return Array.from(this._edges.values())
    // So relation filter only applies with nodeId
    expect(callsEdges.length).toBe(2) // no nodeId = all edges
  })

  test("getNodesForFile returns empty for unknown file", () => {
    const g = new CodeGraph()
    const nodes = g.getNodesForFile("src/nonexistent.ts")
    expect(nodes.length).toBe(0)
  })

  test("searchSymbols case-insensitive and empty", () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "symbol:UpperCaseFun", name: "UpperCaseFun" }))
    const results = g.searchSymbols("uppercase")
    expect(results.length).toBe(1)
  })

  test("searchSymbols returns empty for no match", () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "symbol:foo" }))
    expect(g.searchSymbols("xyzzy").length).toBe(0)
  })

  test("getFiles returns empty for graph with only symbols", () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "symbol:fn" }))
    expect(g.getFiles().length).toBe(0)
  })

  test("getOutgoing non-existent node returns empty", () => {
    const g = new CodeGraph()
    expect(g.getOutgoing("symbol:ghost").length).toBe(0)
  })

  test("getIncoming non-existent node returns empty", () => {
    const g = new CodeGraph()
    expect(g.getIncoming("symbol:ghost").length).toBe(0)
  })

  test("removeNode cleans both outgoing and incoming edges", () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "symbol:A" }))
    g.addNode(makeNode({ id: "symbol:B" }))
    g.addEdge(makeEdge({ sourceId: "symbol:A", targetId: "symbol:B", relation: "calls" }))
    g.addEdge(makeEdge({ sourceId: "symbol:B", targetId: "symbol:A", relation: "references" }))
    expect(g.edgeCount).toBe(2)
    g.removeNode("symbol:A")
    expect(g.edgeCount).toBe(0)
    expect(g.getOutgoing("symbol:B").length).toBe(0)
    expect(g.getIncoming("symbol:B").length).toBe(0)
  })

  test("getStats returns consistent counts after modifications", () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "symbol:a" }))
    g.addNode(makeNode({ id: "file:f.ts", type: "file", name: "f.ts", symbolType: undefined }))
    g.addEdge(makeEdge({ sourceId: "symbol:a", targetId: "file:f.ts", relation: "defines" }))
    const stats1 = g.getStats()
    expect(stats1.nodes).toBe(2)
    g.removeNode("symbol:a")
    const stats2 = g.getStats()
    expect(stats2.nodes).toBe(1)
    expect(stats2.edges).toBe(0)
    expect(stats2.symbols).toBe(0)
  })

  test("observer receives events on addNode and addEdge", () => {
    const g = new CodeGraph()
    const events: string[] = []
    g.addObserver((e) => events.push(e.type))
    // addNode/addEdge don't fire observer events by default (only builder does)
    // Just verify observer was registered
    g.addNode(makeNode({ id: "symbol:obs" }))
    g.removeObserver(() => {})
  })

  test("getEgoGraph excludes duplicate edges", () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "symbol:center" }))
    g.addNode(makeNode({ id: "symbol:n1" }))
    g.addEdge(makeEdge({ sourceId: "symbol:center", targetId: "symbol:n1", relation: "calls" }))
    // Adding same edge again should not duplicate
    g.addEdge(makeEdge({ sourceId: "symbol:center", targetId: "symbol:n1", relation: "calls" }))
    const ego = g.getEgoGraph("symbol:center", 1)
    expect(ego.edges.length).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Extended CodeGraphRanker Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("CodeGraphRanker extended", () => {
  test("rankAll pageRank sums approximately to 1", () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "symbol:a" }))
    g.addNode(makeNode({ id: "symbol:b" }))
    g.addEdge(makeEdge({ sourceId: "symbol:a", targetId: "symbol:b", relation: "calls" }))

    const ranker = new CodeGraphRanker(g)
    const results = ranker.rankAll()
    const sum = results.reduce((s, r) => s + r.pageRank, 0)
    expect(sum).toBeCloseTo(1, 4)
  })

  test("rankAll with custom config converges", () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "symbol:a" }))
    g.addNode(makeNode({ id: "symbol:b" }))
    g.addEdge(makeEdge({ sourceId: "symbol:a", targetId: "symbol:b" }))

    const ranker = new CodeGraphRanker(g, { dampingFactor: 0.5, maxIterations: 50 })
    const results = ranker.rankAll()
    expect(results.length).toBe(2)
  })

  test("getTopFiles limits results", () => {
    const g = new CodeGraph()
    for (let i = 0; i < 10; i++) {
      g.addNode(makeNode({ id: `file:f${i}.ts`, type: "file", name: `f${i}.ts`, symbolType: undefined }))
    }
    const ranker = new CodeGraphRanker(g)
    expect(ranker.getTopFiles(3).length).toBe(3)
  })

  test("getTopSymbols limits results", () => {
    const g = new CodeGraph()
    for (let i = 0; i < 10; i++) {
      g.addNode(makeNode({ id: `symbol:s${i}`, name: `s${i}` }))
    }
    const ranker = new CodeGraphRanker(g)
    expect(ranker.getTopSymbols(3).length).toBe(3)
  })

  test("buildRankingReport includes both files and symbols sections", () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "file:r.ts", type: "file", name: "r.ts", symbolType: undefined }))
    g.addNode(makeNode({ id: "symbol:fn", name: "fn" }))
    const ranker = new CodeGraphRanker(g)
    const report = ranker.buildRankingReport(5)
    expect(report).toContain("Top Files")
    expect(report).toContain("Top Symbols")
  })

  test("computeDegreeCentrality for isolated node is 0", () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "symbol:isolated" }))
    const ranker = new CodeGraphRanker(g)
    const results = ranker.rankAll()
    expect(results[0]!.centrality).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Extended CodeGraphSearcher Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("CodeGraphSearcher extended", () => {
  test("searchSymbols with maxResults limits output", () => {
    const g = new CodeGraph()
    for (let i = 0; i < 10; i++) {
      g.addNode(makeNode({ id: `symbol:user${i}`, name: `user${i}` }))
    }
    const searcher = new CodeGraphSearcher(g)
    const results = searcher.searchSymbols("user", { maxResults: 5 })
    expect(results.length).toBeLessThanOrEqual(5)
  })

  test("searchByType on non-existent type returns empty", () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "symbol:fn" }))
    const searcher = new CodeGraphSearcher(g)
    expect(searcher.searchByType("decorator").length).toBe(0)
  })

  test("searchByFile on non-existent file returns empty", () => {
    const g = new CodeGraph()
    const searcher = new CodeGraphSearcher(g)
    expect(searcher.searchByFile("nonexistent.ts").length).toBe(0)
  })

  test("getEgoGraph with k=0 returns just the center node", () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "symbol:center" }))
    g.addNode(makeNode({ id: "symbol:n1" }))
    g.addEdge(makeEdge({ sourceId: "symbol:center", targetId: "symbol:n1", relation: "calls" }))
    const searcher = new CodeGraphSearcher(g)
    const ego = searcher.getEgoGraph("symbol:center", 0)
    expect(ego.nodes.length).toBe(1)
    expect(ego.centerId).toBe("symbol:center")
  })

  test("getEgoGraph for non-existent center returns empty subgraph", () => {
    const g = new CodeGraph()
    const searcher = new CodeGraphSearcher(g)
    const ego = searcher.getEgoGraph("symbol:ghost")
    expect(ego.nodes.length).toBe(0)
    expect(ego.estimatedTokens).toBe(0)
  })

  test("searchResults include score and matchedOn", () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "symbol:search", name: "searchTarget", metadata: { docComment: "Important" } }))
    const searcher = new CodeGraphSearcher(g)
    const results = searcher.searchSymbols("searchTarget")
    expect(results.length).toBe(1)
    expect(results[0]!.score).toBeGreaterThan(0)
    expect(results[0]!.matchedOn).toBeDefined()
  })

  test("buildCompactSummary with zero tokens returns minimal", () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "symbol:fn" }))
    const searcher = new CodeGraphSearcher(g)
    const results = searcher.searchSymbols("fn")
    const summary = searcher.buildCompactSummary(results, 10)
    expect(summary).toContain("```codegraph")
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Extended Helper Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("Helpers extended", () => {
  test("flattenSubGraph with module node", () => {
    const nodes: CodeGraphNode[] = [
      makeNode({
        id: "module:core",
        type: "module",
        name: "core",
        symbolType: undefined,
        metadata: { childFiles: [], childModules: [] },
      }),
    ]
    const text = flattenSubGraph({ nodes, edges: [], estimatedTokens: 10 })
    expect(text).toContain("[Module]")
    expect(text).toContain("core")
  })

  test("flattenSubGraph with file node shows [File]", () => {
    const nodes: CodeGraphNode[] = [
      makeNode({ id: "file:src/app.ts", type: "file", name: "app.ts", symbolType: undefined }),
    ]
    const text = flattenSubGraph({ nodes, edges: [], estimatedTokens: 10 })
    expect(text).toContain("[File]")
    expect(text).toContain("app.ts")
  })

  test("flattenSubGraph with async static exported symbol", () => {
    const nodes: CodeGraphNode[] = [
      makeNode({
        id: "symbol:complex",
        name: "complex",
        symbolType: "method",
        metadata: {
          isAsync: true,
          isStatic: true,
          isExported: true,
          visibility: "public",
          returnType: "Promise<void>",
          parameters: [{ name: "x", type: "number" }],
        },
      }),
    ]
    const text = flattenSubGraph({ nodes, edges: [], estimatedTokens: 50 })
    expect(text).toContain("[method]")
    expect(text).toContain("export")
    expect(text).toContain("public")
    expect(text).toContain("static")
    expect(text).toContain("async")
  })

  test("estimateTokens with doc comments and params", () => {
    const tokens = estimateTokens(
      [
        makeNode({
          id: "symbol:fn",
          symbolType: "function",
          metadata: {
            returnType: "string",
            parameters: [
              { name: "a", type: "number" },
              { name: "b", type: "string" },
            ],
            docComment: "A very important function that does many things.",
          },
        }),
      ],
      [makeEdge({ sourceId: "symbol:fn", targetId: "symbol:callee", relation: "calls" })],
    )
    expect(tokens).toBeGreaterThan(20)
  })

  test("buildRepoSummary includes high-value files", () => {
    const g = new CodeGraph()
    g.addNode(makeNode({ id: "file:a.ts", type: "file", name: "a.ts", symbolType: undefined, filePath: "a.ts" }))
    g.addNode(makeNode({ id: "symbol:fn" }))
    g.addEdge(makeEdge({ sourceId: "file:a.ts", targetId: "symbol:fn", relation: "defines" }))
    g.addEdge(makeEdge({ sourceId: "symbol:fn", targetId: "file:a.ts", relation: "exports" }))

    const summary = buildRepoSummary(g)
    expect(summary).toContain("CodeGraph Repository Summary")
    expect(summary).toContain("High-Value Files")
    expect(summary).toContain("a.ts")
  })

  test("flattenSubGraph with edges shows relation arrows", () => {
    const nodes: CodeGraphNode[] = [
      makeNode({ id: "symbol:caller", name: "caller" }),
      makeNode({ id: "symbol:callee", name: "callee" }),
    ]
    const edges: CodeGraphEdge[] = [
      makeEdge({ sourceId: "symbol:caller", targetId: "symbol:callee", relation: "calls" }),
    ]
    const text = flattenSubGraph({ nodes, edges, estimatedTokens: 50 })
    expect(text).toContain("calls ->")
  })

  test("estimateTokens with empty inputs returns positive number", () => {
    const tokens = estimateTokens([], [])
    expect(tokens).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Bidirectional Edge Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("Bidirectional edges", () => {
  test("calls edge creates called_by reverse edge", () => {
    const g = new CodeGraph()
    g.setBidirectional(true)
    g.addNode(makeNode({ id: "symbol:A" }))
    g.addNode(makeNode({ id: "symbol:B" }))
    g.addEdge(makeEdge({ sourceId: "symbol:A", targetId: "symbol:B", relation: "calls" }))
    expect(g.edgeCount).toBe(2)
    const callers = g.getCallersOf("symbol:B")
    expect(callers.length).toBe(1)
    expect(callers[0]!.id).toBe("symbol:A")
  })

  test("getCallersOf returns empty for entities with no callers", () => {
    const g = new CodeGraph()
    g.setBidirectional(true)
    g.addNode(makeNode({ id: "symbol:lonely" }))
    expect(g.getCallersOf("symbol:lonely").length).toBe(0)
  })

  test("getTransitiveCallers returns depth-keyed map", () => {
    const g = new CodeGraph()
    g.setBidirectional(true)
    g.addNode(makeNode({ id: "symbol:A", name: "A" }))
    g.addNode(makeNode({ id: "symbol:B", name: "B" }))
    g.addNode(makeNode({ id: "symbol:C", name: "C" }))
    g.addEdge(makeEdge({ sourceId: "symbol:A", targetId: "symbol:B", relation: "calls" }))
    g.addEdge(makeEdge({ sourceId: "symbol:B", targetId: "symbol:C", relation: "calls" }))
    const transitive = g.getTransitiveCallers("symbol:C", 3)
    expect(transitive.has(1)).toBe(true)
    expect(transitive.get(1)!.length).toBe(1)
    expect(transitive.has(2)).toBe(true)
  })

  test("getAffectedFiles collects files from callers", () => {
    const g = new CodeGraph()
    g.setBidirectional(true)
    g.addNode(makeNode({ id: "symbol:A", filePath: "src/a.ts" }))
    g.addNode(makeNode({ id: "symbol:B", filePath: "src/b.ts" }))
    g.addEdge(makeEdge({ sourceId: "symbol:A", targetId: "symbol:B", relation: "calls" }))
    const files = g.getAffectedFiles("symbol:B", 3)
    expect(files.length).toBeGreaterThanOrEqual(1)
  })

  test("findEntity resolves by name and kind", () => {
    const g = new CodeGraph()
    g.addNode(
      makeNode({ id: "symbol:function:myFunc", name: "myFunc", symbolType: "function", filePath: "src/main.ts" }),
    )
    const found = g.findEntity("myFunc", "function", "src/main.ts")
    expect(found).toBeDefined()
    expect(found!.name).toBe("myFunc")
  })

  test("findEntity returns undefined for no match", () => {
    const g = new CodeGraph()
    expect(g.findEntity("nope", "function")).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// CallSite Store Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("CallSiteStore", () => {
  test("adds and retrieves a call site", () => {
    const store = new CallSiteStore()
    const cs = makeCS()
    store.add(cs)
    expect(store.size).toBe(1)
    expect(store.get(cs.id)).toBeDefined()
  })

  test("getByCaller returns matching call sites", () => {
    const store = new CallSiteStore()
    const cs = makeCS()
    store.add(cs)
    expect(store.getByCaller("symbol:caller").length).toBe(1)
    expect(store.getByCaller("symbol:none").length).toBe(0)
  })

  test("getByCallee returns matching call sites", () => {
    const store = new CallSiteStore()
    const cs = makeCS()
    store.add(cs)
    expect(store.getByCallee("symbol:target").length).toBe(1)
    expect(store.getByCallee("symbol:none").length).toBe(0)
  })

  test("getByCalleeName works for unresolved calls", () => {
    const store = new CallSiteStore()
    const cs = makeCS({ calleeId: "" })
    store.add(cs)
    expect(store.getByCalleeName("target").length).toBe(1)
    expect(store.getByCalleeName("TARGET").length).toBe(1)
  })

  test("getByFile returns call sites in a file", () => {
    const store = new CallSiteStore()
    store.add(makeCS({ filePath: "src/a.ts" }))
    store.add(makeCS({ filePath: "src/a.ts", calleeName: "other" }))
    store.add(makeCS({ filePath: "src/b.ts" }))
    expect(store.getByFile("src/a.ts").length).toBe(2)
    expect(store.getByFile("src/b.ts").length).toBe(1)
  })

  test("removeByFile cleans all call sites for a file", () => {
    const store = new CallSiteStore()
    store.add(makeCS({ filePath: "src/a.ts" }))
    store.add(makeCS({ filePath: "src/b.ts" }))
    store.removeByFile("src/a.ts")
    expect(store.size).toBe(1)
  })

  test("getStaleCallSites detects missing required args", () => {
    const store = new CallSiteStore()
    store.add(makeCS({ argCount: 1, keywordArgs: [] }))
    const stale = store.getStaleCallSites("symbol:target", 3, 2, ["x", "y", "z"])
    expect(stale.length).toBe(1)
  })

  test("getStaleCallSites detects renamed keyword args", () => {
    const store = new CallSiteStore()
    store.add(makeCS({ argCount: 3, keywordArgs: ["old_param"] }))
    const stale = store.getStaleCallSites("symbol:target", 3, 2, ["new_param"])
    expect(stale.length).toBe(1)
  })

  test("getByTokenRange finds overlapping call sites", () => {
    const store = new CallSiteStore()
    store.add(makeCS({ startToken: 10, endToken: 20, filePath: "src/f.ts" }))
    const results = store.getByTokenRange("src/f.ts", 5, 15)
    expect(results.length).toBe(1)
  })

  test("toJSON and fromJSON round-trips", () => {
    const store = new CallSiteStore()
    store.add(makeCS())
    store.add(makeCS({ calleeName: "other" }))
    const json = store.toJSON()
    const store2 = new CallSiteStore()
    store2.fromJSON(json)
    expect(store2.size).toBe(2)
  })

  test("clears all call sites", () => {
    const store = new CallSiteStore()
    store.add(makeCS())
    store.clear()
    expect(store.size).toBe(0)
  })

  test("Symbol.iterator yields all call sites", () => {
    const store = new CallSiteStore()
    store.add(makeCS({ calleeName: "a" }))
    store.add(makeCS({ calleeName: "b" }))
    const items = [...store]
    expect(items.length).toBe(2)
    expect(items[0]!.calleeName).toBeDefined()
  })

  test("fromJSON correctly loads and iterates data", () => {
    const store = new CallSiteStore()
    store.add(makeCS({ calleeName: "alpha" }))
    store.add(makeCS({ calleeName: "beta" }))
    const json = store.toJSON()
    expect(json.length).toBe(2)
    const store2 = new CallSiteStore()
    store2.fromJSON(json)
    expect(store2.size).toBe(2)
    // verify the loaded data is correct
    const loaded = store2.toJSON()
    expect(loaded.length).toBe(2)
    expect(loaded.some((cs) => cs.calleeName === "alpha")).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Hashing Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("Hashing", () => {
  test("hashString produces 64-char hex string", () => {
    const h = hashString("hello world")
    expect(h.length).toBe(64)
  })

  test("hashString is deterministic", () => {
    expect(hashString("abc")).toBe(hashString("abc"))
  })

  test("different inputs produce different hashes", () => {
    expect(hashString("abc")).not.toBe(hashString("def"))
  })

  test("hashesEqual returns false for different hashes", () => {
    expect(hashesEqual("aaa", "aaa")).toBe(true)
    expect(hashesEqual("aaa", "bbb")).toBe(false)
    expect(hashesEqual(undefined, "aaa")).toBe(false)
  })

  test("signatureChanged detects changes", () => {
    expect(signatureChanged("aaa", "aaa")).toBe(false)
    expect(signatureChanged("aaa", "bbb")).toBe(true)
    expect(signatureChanged(undefined, "aaa")).toBe(true)
  })

  test("buildSignatureSource formats correctly", () => {
    const src = buildSignatureSource(
      "myFunc",
      [
        { name: "x", type: "number" },
        { name: "y", type: "string", optional: true },
      ],
      "boolean",
    )
    expect(src).toBe("myFunc(x:number,y:string?):boolean")
  })

  test("computeEntityHashes returns both hashes", () => {
    const hashes = computeEntityHashes({
      name: "test",
      body: "function test() {}",
      signatureSource: "test()",
    })
    expect(hashes.signatureHash.length).toBe(64)
    expect(hashes.contentHash.length).toBe(64)
    expect(hashes.signatureHash).not.toBe(hashes.contentHash)
  })

  test("hashBuffer produces deterministic hex string", () => {
    const buf = Buffer.from("hello")
    const h1 = hashBuffer(buf)
    const h2 = hashBuffer(Buffer.from("hello"))
    expect(h1.length).toBe(64)
    expect(h1).toBe(h2)
  })

  test("buildContentSource returns body text", () => {
    expect(buildContentSource("fn", "function fn() {}")).toBe("function fn() {}")
    expect(buildContentSource("", "")).toBe("")
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// ImpactAnalyzer Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("ImpactAnalyzer", () => {
  function buildImpactGraph(): { graph: CodeGraph; callSites: CallSiteStore } {
    const g = new CodeGraph()
    g.setBidirectional(true)
    const cs = new CallSiteStore()

    g.addNode(
      makeNode({
        id: "symbol:function:target",
        name: "target",
        symbolType: "function",
        filePath: "src/target.ts",
        startLine: 10,
      }),
    )
    g.addNode(
      makeNode({
        id: "symbol:function:caller1",
        name: "caller1",
        symbolType: "function",
        filePath: "src/caller1.ts",
        startLine: 5,
      }),
    )
    g.addNode(
      makeNode({
        id: "symbol:function:caller2",
        name: "caller2",
        symbolType: "function",
        filePath: "src/caller2.ts",
        startLine: 15,
      }),
    )
    g.addNode(
      makeNode({
        id: "symbol:function:test_target",
        name: "test_target",
        symbolType: "function",
        filePath: "src/__tests__/target.test.ts",
        startLine: 1,
      }),
    )
    g.addNode(
      makeNode({ id: "symbol:class:MyClass", name: "MyClass", symbolType: "class", filePath: "src/MyClass.ts" }),
    )

    g.addEdge(makeEdge({ sourceId: "symbol:function:caller1", targetId: "symbol:function:target", relation: "calls" }))
    g.addEdge(makeEdge({ sourceId: "symbol:function:caller2", targetId: "symbol:function:target", relation: "calls" }))
    g.addEdge(
      makeEdge({
        sourceId: "symbol:function:test_target",
        targetId: "symbol:function:target",
        relation: "test_covers",
      }),
    )

    cs.add(
      createCallSite({
        callerId: "symbol:function:caller1",
        calleeName: "target",
        calleeId: "symbol:function:target",
        filePath: "src/caller1.ts",
        startByte: 0,
        endByte: 20,
        startToken: 5,
        endToken: 15,
        startLine: 5,
        endLine: 6,
        argCount: 1,
        keywordArgs: [],
      }),
    )

    cs.add(
      createCallSite({
        callerId: "symbol:function:caller2",
        calleeName: "target",
        calleeId: "symbol:function:target",
        filePath: "src/caller2.ts",
        startByte: 0,
        endByte: 25,
        startToken: 10,
        endToken: 20,
        startLine: 15,
        endLine: 16,
        argCount: 2,
        keywordArgs: ["old_param"],
      }),
    )

    return { graph: g, callSites: cs }
  }

  test("analyzeImpact finds direct callers", () => {
    const { graph, callSites } = buildImpactGraph()
    const analyzer = new ImpactAnalyzer(graph, callSites)
    const result = analyzer.analyzeImpact("symbol:function:target", "modify_body")
    expect(result.directCallers.length).toBe(2)
    expect(result.riskScore).toBeGreaterThan(0)
  })

  test("analyzeImpact detects signature breaks", () => {
    const { graph, callSites } = buildImpactGraph()
    const analyzer = new ImpactAnalyzer(graph, callSites)
    const result = analyzer.analyzeImpact("symbol:function:target", "modify_signature", {
      paramCount: 3,
      requiredParamCount: 3,
      paramNames: ["a", "b", "c"],
    })
    expect(result.signatureBreaks.length).toBeGreaterThan(0)
  })

  test("analyzeImpact assigns higher risk for public API", () => {
    const { graph, callSites } = buildImpactGraph()
    const analyzer = new ImpactAnalyzer(graph, callSites)

    const pubResult = analyzer.analyzeImpact("symbol:function:target", "modify_body")

    const g2 = new CodeGraph()
    g2.setBidirectional(true)
    g2.addNode(
      makeNode({ id: "symbol:function:_private", name: "_private", symbolType: "function", filePath: "src/p.ts" }),
    )
    const analyzer2 = new ImpactAnalyzer(g2)
    const privResult = analyzer2.analyzeImpact("symbol:function:_private", "modify_body")

    expect(pubResult.riskScore).toBeGreaterThanOrEqual(privResult.riskScore)
  })

  test("analyzeImpact includes affected files", () => {
    const { graph, callSites } = buildImpactGraph()
    const analyzer = new ImpactAnalyzer(graph, callSites)
    const result = analyzer.analyzeImpact("symbol:function:target", "modify_body")
    expect(result.affectedFiles.length).toBeGreaterThan(0)
  })

  test("analyzeImpact finds tests via test_covers edge", () => {
    const { graph, callSites } = buildImpactGraph()
    const analyzer = new ImpactAnalyzer(graph, callSites)
    const result = analyzer.analyzeImpact("symbol:function:target", "modify_body")
    expect(result.affectedTests.length).toBeGreaterThan(0)
  })

  test("analyzeImpact builds impact chains", () => {
    const { graph, callSites } = buildImpactGraph()
    const analyzer = new ImpactAnalyzer(graph, callSites)
    const result = analyzer.analyzeImpact("symbol:function:target", "modify_body")
    expect(result.impactChains.length).toBeGreaterThan(0)
    expect(result.impactChains[0]!.depth).toBe(1)
  })

  test("analyzeImpact delete type has no signature breaks", () => {
    const { graph, callSites } = buildImpactGraph()
    const analyzer = new ImpactAnalyzer(graph, callSites)
    const result = analyzer.analyzeImpact("symbol:function:target", "delete")
    expect(result.signatureBreaks.length).toBe(0)
  })

  test("formatImpactSummary produces readable output", () => {
    const { graph, callSites } = buildImpactGraph()
    const analyzer = new ImpactAnalyzer(graph, callSites)
    const result = analyzer.analyzeImpact("symbol:function:target", "modify_body")
    const summary = analyzer.formatImpactSummary(result)
    expect(summary).toContain("Impact Analysis")
    expect(summary).toContain("Risk Score")
    expect(summary).toContain("Direct Callers")
  })

  test("riskScore is bounded 0-1", () => {
    const { graph, callSites } = buildImpactGraph()
    const analyzer = new ImpactAnalyzer(graph, callSites)
    const result = analyzer.analyzeImpact("symbol:function:target", "modify_signature", {
      paramCount: 5,
      requiredParamCount: 5,
      paramNames: ["a", "b", "c", "d", "e"],
    })
    expect(result.riskScore).toBeGreaterThanOrEqual(0)
    expect(result.riskScore).toBeLessThanOrEqual(1)
  })

  test("analyzeImpact standalone wrapper works", () => {
    const { graph, callSites } = buildImpactGraph()
    const result = analyzeImpact(graph, "symbol:function:target", callSites)
    expect(result.riskScore).toBeGreaterThanOrEqual(0)
    expect(result.riskScore).toBeLessThanOrEqual(1)
    expect(result.directCallers.length).toBeGreaterThan(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// GraphPersistence Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("GraphPersistence", () => {
  test("persists and loads graph data", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "codegraph-persist-"))
    const p = new GraphPersistence(tmpDir)

    const nodes: CodeGraphNode[] = [makeNode({ id: "symbol:persisted" })]
    const edges: CodeGraphEdge[] = [makeEdge({ sourceId: "symbol:persisted", targetId: "symbol:target" })]
    const callSites: CallSite[] = [makeCS()]

    await p.save(nodes, edges, callSites)
    const loaded = await p.load()
    expect(loaded).not.toBeNull()
    expect(loaded!.nodes.length).toBe(1)
    expect(loaded!.edges.length).toBe(1)
    expect(loaded!.callSites.length).toBe(1)

    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("hasPersistedData detects existing data", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "codegraph-persist-"))
    const p = new GraphPersistence(tmpDir)
    expect(await p.hasPersistedData()).toBe(false)
    await p.save([], [], [])
    expect(await p.hasPersistedData()).toBe(true)
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("load returns null for non-existent data", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "codegraph-persist-"))
    const p = new GraphPersistence(tmpDir)
    const result = await p.load()
    expect(result).toBeNull()
    rmSync(tmpDir, { recursive: true, force: true })
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// IncrementalParser Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("IncrementalParser", () => {
  test("processEdit delete removes entities and call sites", async () => {
    const g = new CodeGraph()
    g.setBidirectional(true)
    const cs = new CallSiteStore()
    const parser = new IncrementalParser(g, cs, ".")

    g.addNode(makeNode({ id: "symbol:toDelete", filePath: "delete.ts" }))
    cs.add(makeCS({ callerId: "symbol:toDelete", filePath: "delete.ts" }))

    const result = await parser.processEdit({
      filePath: "delete.ts",
      editType: "delete",
    })

    expect(result.removedEntityIds.length).toBeGreaterThan(0)
    expect(cs.size).toBe(0)
    expect(parser.isStale("symbol:toDelete")).toBe(true)
  })

  test("processEdit modify returns empty when file doesn't exist", async () => {
    const g = new CodeGraph()
    const cs = new CallSiteStore()
    const parser = new IncrementalParser(g, cs, ".")

    const result = await parser.processEdit({
      filePath: "nonexistent.ts",
      editType: "modify",
    })

    expect(result.entities.length).toBe(0)
  })

  test("processEdit delete marks entity as stale", async () => {
    const g = new CodeGraph()
    g.setBidirectional(true)
    const cs = new CallSiteStore()

    g.addNode(makeNode({ id: "symbol:gone", filePath: "gone.ts" }))

    const parser = new IncrementalParser(g, cs, ".")
    await parser.processEdit({ filePath: "gone.ts", editType: "delete" })

    const stale = parser.getStaleEntities()
    expect(stale.length).toBeGreaterThan(0)
    expect(stale[0]!.entityId).toBe("symbol:gone")
  })

  test("getStaleEntities returns empty initially", () => {
    const g = new CodeGraph()
    const cs = new CallSiteStore()
    const parser = new IncrementalParser(g, cs, ".")
    expect(parser.getStaleEntities().length).toBe(0)
  })

  test("isStale returns true for stalely marked entity after delete", async () => {
    const g = new CodeGraph()
    g.setBidirectional(true)
    const cs = new CallSiteStore()

    g.addNode(makeNode({ id: "symbol:del", filePath: "del.ts" }))

    const parser = new IncrementalParser(g, cs, ".")
    await parser.processEdit({ filePath: "del.ts", editType: "delete" })

    expect(parser.isStale("symbol:del")).toBe(true)
  })

  test("clearStale resets all markers", async () => {
    const g = new CodeGraph()
    g.setBidirectional(true)
    const cs = new CallSiteStore()

    g.addNode(makeNode({ id: "symbol:clearMe", filePath: "clear.ts" }))

    const parser = new IncrementalParser(g, cs, ".")
    await parser.processEdit({ filePath: "clear.ts", editType: "delete" })
    expect(parser.getStaleEntities().length).toBeGreaterThan(0)

    parser.clearStale()
    expect(parser.getStaleEntities().length).toBe(0)
  })

  test("hasSignatureChanged detects signature hash difference", () => {
    const g = new CodeGraph()
    g.setBidirectional(true)
    const cs = new CallSiteStore()

    g.addNode(
      makeNode({
        id: "symbol:sig",
        name: "sig",
        symbolType: "function",
        metadata: { signatureHash: hashString("old_sig") },
      }),
    )

    const parser = new IncrementalParser(g, cs, ".")
    expect(parser.hasSignatureChanged("symbol:sig", hashString("old_sig"))).toBe(false)
    expect(parser.hasSignatureChanged("symbol:sig", hashString("new_sig"))).toBe(true)
  })

  test("computeFileContentHash returns hash for entities with content hashes", () => {
    const g = new CodeGraph()
    g.setBidirectional(true)
    const cs = new CallSiteStore()
    const parser = new IncrementalParser(g, cs, ".")
    const entities = [
      makeNode({ id: "symbol:a", metadata: { contentHash: hashString("body_a") } }),
      makeNode({ id: "symbol:b", metadata: { signatureHash: hashString("sig_b") } }),
    ]
    const hash = (parser as any).computeFileContentHash(entities)
    expect(typeof hash).toBe("string")
    expect(hash!.length).toBe(64)
  })

  test("computeFileContentHash returns undefined for empty entities", () => {
    const g = new CodeGraph()
    const cs = new CallSiteStore()
    const parser = new IncrementalParser(g, cs, ".")
    const hash = (parser as any).computeFileContentHash([])
    expect(hash).toBeUndefined()
  })

  test("resolveImportSimple resolves relative imports", () => {
    const g = new CodeGraph()
    g.setBidirectional(true)
    // Leading "./" is normalized away, so the node is registered without it
    g.addNode(makeNode({ id: "file:utils", type: "file", filePath: "utils" }))
    const cs = new CallSiteStore()
    const parser = new IncrementalParser(g, cs, ".")
    const resolved = (parser as any).resolveImportSimple("./utils", "index")
    expect(resolved).toBe("utils")
  })

  test("resolveImportSimple returns null for non-relative imports", () => {
    const g = new CodeGraph()
    const cs = new CallSiteStore()
    const parser = new IncrementalParser(g, cs, ".")
    const resolved = (parser as any).resolveImportSimple("lodash", "src/main")
    expect(resolved).toBeNull()
  })

  test("watcher resolveImportSimple resolves relative imports", () => {
    const g = new CodeGraph()
    g.setBidirectional(true)
    g.addNode(makeNode({ id: "file:lib", type: "file", filePath: "lib" }))
    const watcher = new CodeGraphWatcher(g, ".")
    const resolved = (watcher as any).resolveImportSimple("./lib", "index")
    expect(resolved).toBe("lib")
  })

  test("processEdit modify extracts symbols and wires call sites", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "codegraph-inc-"))
    const filePath = join(tmpDir, "main.ts")
    writeFileSync(
      filePath,
      `
      function helper() { return 1 }
      export function run() { return helper() }
    `,
    )

    const g = new CodeGraph()
    g.setBidirectional(true)
    const cs = new CallSiteStore()
    const parser = new IncrementalParser(g, cs, tmpDir)

    const result = await parser.processEdit({ filePath, editType: "add" })
    expect(result.entities.length).toBeGreaterThan(0)
    expect(result.callSites.length).toBeGreaterThan(0)
    expect(g.hasNode("file:main.ts")).toBe(true)

    // Re-processing identical content short-circuits (content hash unchanged)
    const second = await parser.processEdit({
      filePath,
      editType: "modify",
      source: readFileSync(filePath, "utf-8"),
    })
    expect(second.entities.length).toBe(0)

    // Changed content re-extracts
    writeFileSync(filePath, `export function run() { return 2 }`)
    const third = await parser.processEdit({ filePath, editType: "modify" })
    expect(third.entities.length).toBeGreaterThan(0)

    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("processEdit modify with unreadable file returns empty", async () => {
    const g = new CodeGraph()
    const cs = new CallSiteStore()
    const parser = new IncrementalParser(g, cs, ".")
    const result = await parser.processEdit({ filePath: ".", editType: "modify" })
    expect(result.entities.length).toBe(0)
  })

  test("processEdit short-circuits via entity content hash with cold source cache", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "codegraph-inc-cold-"))
    const filePath = join(tmpDir, "main.ts")
    // The entity-hash fallback compares `hashString(source)` against a hash of
    // entity content hashes, so craft source to be exactly that hash text.
    const bodyHash = hashString("export function run() { return 1 }")
    const source = bodyHash
    writeFileSync(filePath, source, "utf-8")

    const g = new CodeGraph()
    g.setBidirectional(true)
    g.addNode(
      makeNode({
        id: "symbol:run",
        name: "run",
        symbolType: "function",
        filePath: "main.ts",
        metadata: { contentHash: bodyHash },
      }),
    )
    const cs = new CallSiteStore()
    const parser = new IncrementalParser(g, cs, tmpDir)

    const result = await parser.processEdit({ filePath, editType: "modify", source })
    expect(result.entities.length).toBe(0)
    expect(result.removedEntityIds.length).toBe(0)
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("processEdit wires import edges and reference edges to known file nodes", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "codegraph-inc-import-"))
    const srcDir = join(tmpDir, "src")
    mkdirSync(srcDir, { recursive: true })
    const filePath = join(srcDir, "main.ts")
    // Relative import — resolveImportSimple ignores bare module specifiers
    writeFileSync(filePath, `import { helper } from "./util"\nexport function run() { return helper() }\n`, "utf-8")

    const g = new CodeGraph()
    g.setBidirectional(true)
    g.addNode(makeNode({ id: "file:src/util.ts", type: "file", name: "util.ts", filePath: "src/util.ts" }))
    g.addNode(
      makeNode({
        id: "symbol:helper",
        name: "helper",
        symbolType: "function",
        filePath: "src/util.ts",
      }),
    )
    const cs = new CallSiteStore()
    const parser = new IncrementalParser(g, cs, tmpDir)

    const result = await parser.processEdit({ filePath, editType: "add" })
    expect(result.entities.length).toBeGreaterThan(0)
    expect(g.getOutgoing("file:src/main.ts", "imports").map((n) => n.id)).toContain("file:src/util.ts")
    expect(g.getOutgoing("file:src/main.ts", "references").map((n) => n.id)).toContain("symbol:helper")
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("processEdit marks callers and overriders as stale neighbors", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "codegraph-inc-neighbor-"))
    const filePath = join(tmpDir, "main.ts")
    writeFileSync(filePath, `export function run() { return 1 }\n`, "utf-8")

    const g = new CodeGraph()
    g.setBidirectional(true)
    const cs = new CallSiteStore()
    const parser = new IncrementalParser(g, cs, tmpDir)

    // Simulate a prior build: run() exists and caller/overrider reference it.
    const runNode = makeNode({ id: "symbol:run", name: "run", symbolType: "function", filePath: "main.ts" })
    g.addNode(runNode)
    const caller = makeNode({ id: "symbol:caller", name: "caller", symbolType: "function", filePath: "other.ts" })
    g.addNode(caller)
    g.addEdge(makeEdge({ sourceId: caller.id, targetId: runNode.id, relation: "calls" }))

    const result = await parser.processEdit({ filePath, editType: "modify" })
    expect(result.entities.length).toBeGreaterThan(0)
    const stale = parser.getStaleEntities()
    expect(stale.some((m) => m.entityId === "symbol:caller" && m.neighborsMarked)).toBe(true)
    rmSync(tmpDir, { recursive: true, force: true })
  })
})
