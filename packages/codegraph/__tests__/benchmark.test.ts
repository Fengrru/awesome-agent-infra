/**
 * Benchmark: codegraph
 *
 * Measures performance of graph operations:
 * - Graph construction (100, 500, 1000 nodes with edges)
 * - PageRank computation (CodeGraphRanker)
 * - K-hop ego-graph extraction (getEgoGraph)
 * - Edge insertion throughput
 *
 * NOTE: This is a benchmark file, not a strict correctness test.
 * Run with: bun test packages/codegraph/__tests__/benchmark.test.ts
 */

import { describe, test } from "bun:test"
import { CodeGraph, CodeGraphRanker } from "../src/index"
import type { CodeGraphEdge, CodeGraphNode } from "../src/index"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function measure(
  label: string,
  fn: () => void,
  iterations = 100,
): { opsPerSec: number; avgMs: number; totalMs: number } {
  const start = performance.now()
  for (let i = 0; i < iterations; i++) fn()
  const totalMs = performance.now() - start
  return {
    opsPerSec: Math.round(iterations / (totalMs / 1000)),
    avgMs: totalMs / iterations,
    totalMs,
  }
}

function makeNode(id: number, fileIdx: number, type: "file" | "symbol" = "symbol"): CodeGraphNode {
  if (type === "file") {
    return {
      id: `file:file_${fileIdx}`,
      type: "file",
      name: `file_${fileIdx}.ts`,
      filePath: `src/module${fileIdx}/file_${fileIdx}.ts`,
      startLine: 1,
      endLine: 200,
      metadata: { language: "typescript", size: 4000, imports: [], exports: [] },
      mtime: Date.now(),
    }
  }
  return {
    id: `symbol:func_${id}`,
    type: "symbol",
    symbolType: id % 3 === 0 ? "function" : id % 3 === 1 ? "class" : "method",
    name: `func_${id}`,
    filePath: `src/module${fileIdx}/file_${fileIdx}.ts`,
    startLine: id * 3,
    endLine: id * 3 + 10,
    metadata: {
      isExported: true,
      returnType: "void",
      parameters: [],
    },
    mtime: Date.now(),
  }
}

function makeEdge(
  sourceId: string,
  targetId: string,
  relation: "calls" | "imports" | "references" = "calls",
): CodeGraphEdge {
  return { sourceId, targetId, relation }
}

function buildGraph(nodeCount: number): CodeGraph {
  const g = new CodeGraph()
  const fileCount = Math.max(1, Math.floor(nodeCount / 20))
  for (let f = 0; f < fileCount; f++) {
    g.addNode(makeNode(-(f + 1), f, "file"))
  }
  for (let i = 0; i < nodeCount; i++) {
    const fileIdx = i % fileCount
    g.addNode(makeNode(i, fileIdx))
  }
  // Create a connected graph: link each node to a few others
  for (let i = 0; i < nodeCount; i++) {
    for (let j = 1; j <= 3 && i + j < nodeCount; j++) {
      g.addEdge(makeEdge(`symbol:func_${i}`, `symbol:func_${i + j}`, j % 3 === 0 ? "calls" : "references"))
    }
  }
  return g
}

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

describe("benchmark: graph construction", () => {
  for (const nodeCount of [100, 500, 1000]) {
    test(`build graph with ${nodeCount} nodes + edges`, () => {
      const result = measure("", () => buildGraph(nodeCount), nodeCount >= 500 ? 10 : 30)
      console.log(
        `  ${nodeCount} nodes: ${result.opsPerSec.toLocaleString()} ops/sec, avg ${result.avgMs.toFixed(3)}ms`,
      )
    })
  }
})

describe("benchmark: node insertion", () => {
  test("insert 1000 nodes into empty graph", () => {
    const g = new CodeGraph()
    const result = measure(
      "",
      () => {
        for (let i = 0; i < 1000; i++) {
          g.addNode(makeNode(i, i % 10))
        }
      },
      10,
    )
    console.log(`  1000 inserts (avg per insert): ${((result.avgMs / 1000) * 1000).toFixed(3)}us`)
  })
})

describe("benchmark: edge insertion", () => {
  test("insert 1000 edges into populated graph", () => {
    const g = buildGraph(500)
    const result = measure(
      "",
      () => {
        for (let i = 0; i < 1000; i++) {
          const src = `symbol:func_${(i * 2) % 500}`
          const tgt = `symbol:func_${(i * 3 + 7) % 500}`
          g.addEdge(makeEdge(src, tgt, "imports"))
        }
      },
      10,
    )
    console.log(`  1000 edges (avg per insert): ${((result.avgMs / 1000) * 1000).toFixed(3)}us`)
  })
})

describe("benchmark: PageRank computation", () => {
  for (const nodeCount of [100, 500, 1000]) {
    test(`PageRank on ${nodeCount}-node graph`, () => {
      const g = buildGraph(nodeCount)
      const ranker = new CodeGraphRanker(g, {
        dampingFactor: 0.85,
        maxIterations: 100,
        convergenceThreshold: 0.0001,
      })

      const result = measure("", () => ranker.rankAll(), nodeCount >= 500 ? 5 : 20)
      console.log(`  PageRank ${nodeCount} nodes: ${result.avgMs.toFixed(3)}ms avg`)
    })
  }
})

describe("benchmark: k-hop ego-graph extraction", () => {
  for (const k of [1, 3, 5]) {
    test(`${k}-hop ego-graph from 500-node graph`, () => {
      const g = buildGraph(500)
      // Pick a central-ish node
      const centerId = "symbol:func_250"

      const result = measure("", () => g.getEgoGraph(centerId, k), k >= 3 ? 10 : 50)
      console.log(`  k=${k}: ${result.avgMs.toFixed(3)}ms avg`)
    })
  }
})

describe("benchmark: node lookup", () => {
  test("getNode lookups on 1000-node graph", () => {
    const g = buildGraph(1000)
    const result = measure(
      "",
      () => {
        for (let i = 0; i < 100; i++) {
          g.getNode(`symbol:func_${i * 10}`)
        }
      },
      100,
    )
    console.log(`  100 lookups on 1000-node graph: ${result.avgMs.toFixed(4)}ms avg`)
  })
})
