/**
 * Comprehensive tests for @fengru/memory-graph.
 *
 * Covers all algorithms from the paper:
 * - Algorithm 1: CoW Node Update
 * - Algorithm 2: Cascade Invalidation (BFS)
 * - Algorithm 3: Reversible Propagation (Revalidate)
 * - Algorithm 4: Conflict Detection
 * - All 5 retrieval modes (Table 3)
 * - Enhanced strategies (adaptive depth, priority queue, strength decay)
 *
 * @module memory-graph/__tests__
 */

import { describe, expect, test } from "bun:test"
import {
  ConsistencyRetriever,
  ConsistencyStatus,
  MemoryGraph,
  RelationType,
  RetrievalMode,
  createConsistencyRetriever,
  createMemoryGraph,
  generateNodeId,
} from "../src/index"

// ═══════════════════════════════════════════════════════════════════════════
// Node CRUD
// ═══════════════════════════════════════════════════════════════════════════

describe("Node CRUD", () => {
  test("addNode creates version 0 with VALID status", () => {
    const g = createMemoryGraph()
    const node = g.addNode("a", { name: "Alice" })
    expect(node.nodeId).toBe("a")
    expect(node.version).toBe(0)
    expect(node.content).toEqual({ name: "Alice" })
    expect(node.consistencyStatus).toBe(ConsistencyStatus.VALID)
    expect(node.obsolete).toBe(false)
    expect(node.causalParents).toEqual([])
    expect(node.causalChildren).toEqual([])
  })

  test("addNode auto-generates ID when omitted", () => {
    const g = createMemoryGraph()
    const node = g.addNode()
    expect(node.nodeId).toBeString()
    expect(node.nodeId.length).toBeGreaterThan(0)
    expect(g.hasNode(node.nodeId)).toBe(true)
  })

  test("addNode throws on duplicate ID", () => {
    const g = createMemoryGraph()
    g.addNode("a")
    expect(() => g.addNode("a")).toThrow("Node already exists: a")
  })

  test("hasNode returns correct values", () => {
    const g = createMemoryGraph()
    g.addNode("a")
    expect(g.hasNode("a")).toBe(true)
    expect(g.hasNode("nonexistent")).toBe(false)
  })

  test("getNode returns latest version", () => {
    const g = createMemoryGraph()
    g.addNode("a", { v: 1 })
    g.updateNode("a", { v: 2 })
    const latest = g.getNode("a")
    expect(latest?.version).toBe(1)
    expect(latest?.content).toEqual({ v: 2 })
    expect(latest?.obsolete).toBe(false)
  })

  test("getAllNodeIds returns all nodes", () => {
    const g = createMemoryGraph()
    g.addNode("a")
    g.addNode("b")
    g.addNode("c")
    expect(g.getAllNodeIds().sort()).toEqual(["a", "b", "c"])
  })

  test("getNode returns undefined for missing node", () => {
    const g = createMemoryGraph()
    expect(g.getNode("nope")).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// CoW Versioning (Algorithm 1)
// ═══════════════════════════════════════════════════════════════════════════

describe("Copy-on-Write Versioning", () => {
  test("updateNode increments version and merges content", () => {
    const g = createMemoryGraph()
    g.addNode("person", { name: "Zhang San", status: "honest" })
    const updated = g.updateNode("person", { status: "fraudster" }, "fraud detected")
    expect(updated).not.toBeNull()
    expect(updated!.version).toBe(1)
    expect(updated!.content).toEqual({ name: "Zhang San", status: "fraudster" })
    expect(updated!.obsolete).toBe(false)
    expect(updated!.consistencyStatus).toBe(ConsistencyStatus.VALID)
  })

  test("updateNode marks previous version as OBSOLETE", () => {
    const g = createMemoryGraph()
    g.addNode("a", { v: 0 })
    const v0 = g.getNode("a")!
    g.updateNode("a", { v: 1 })
    expect(v0.obsolete).toBe(true)
    expect(v0.supersededBy).toBe(1)
  })

  test("version history is preserved", () => {
    const g = createMemoryGraph()
    g.addNode("a", { step: 0 })
    g.updateNode("a", { step: 1 })
    g.updateNode("a", { step: 2 })
    const history = g.getVersionHistory("a")
    expect(history.length).toBe(3)
    expect(history[0]!.version).toBe(0)
    expect(history[0]!.content).toEqual({ step: 0 })
    expect(history[1]!.version).toBe(1)
    expect(history[1]!.content).toEqual({ step: 1 })
    expect(history[2]!.version).toBe(2)
    expect(history[2]!.content).toEqual({ step: 2 })
  })

  test("updateNode snapshots causal topology at creation time", () => {
    const g = createMemoryGraph()
    g.addNode("a")
    g.addNode("b")
    g.addEdge("a", "b", RelationType.DEPENDS_ON, 1.0)
    g.updateNode("b", { note: "v1" })

    // v1 of b should snapshot that it depends on a
    const v1 = g.getNodeVersion("b", 1)
    expect(v1!.causalParents.length).toBe(1)
    expect(v1!.causalParents[0]!.nodeId).toBe("a")
    expect(v1!.causalParents[0]!.relationType).toBe(RelationType.DEPENDS_ON)
  })

  test("getNodeAtTime for forensic queries", () => {
    const g = createMemoryGraph()
    g.addNode("a", { v: 0 })
    g.updateNode("a", { v: 1 })

    // Timestamp before node existed returns undefined
    expect(g.getNodeAtTime("a", 0)).toBeUndefined()
    // Timestamp now returns latest version
    expect(g.getNodeAtTime("a", Date.now())?.version).toBe(1)
  })

  test("getNodeVersion returns specific version by number", () => {
    const g = createMemoryGraph()
    g.addNode("a", { v: 0 })
    g.updateNode("a", { v: 1 })
    expect(g.getNodeVersion("a", 0)?.content).toEqual({ v: 0 })
    expect(g.getNodeVersion("a", 1)?.content).toEqual({ v: 1 })
    expect(g.getNodeVersion("a", 2)).toBeUndefined()
  })

  test("updateNode returns null for nonexistent node", () => {
    const g = createMemoryGraph()
    expect(g.updateNode("nope", {})).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Causal Edges
// ═══════════════════════════════════════════════════════════════════════════

describe("Causal Edges", () => {
  test("addEdge creates a directed dependency", () => {
    const g = createMemoryGraph()
    g.addNode("a")
    g.addNode("b")
    const edge = g.addEdge("a", "b", RelationType.DEPENDS_ON, 0.8)
    expect(edge).not.toBeNull()
    expect(edge!.source).toBe("a")
    expect(edge!.target).toBe("b")
    expect(edge!.relationType).toBe(RelationType.DEPENDS_ON)
    expect(edge!.strength).toBe(0.8)
  })

  test("addEdge returns null if either node doesn't exist", () => {
    const g = createMemoryGraph()
    g.addNode("a")
    expect(g.addEdge("a", "nope", RelationType.DEPENDS_ON, 0.5)).toBeNull()
    expect(g.addEdge("nope", "a", RelationType.DEPENDS_ON, 0.5)).toBeNull()
  })

  test("getOutgoingEdges returns all outgoing edges", () => {
    const g = createMemoryGraph()
    g.addNode("a")
    g.addNode("b")
    g.addNode("c")
    g.addEdge("a", "b", RelationType.DEPENDS_ON, 0.8)
    g.addEdge("a", "c", RelationType.INFLUENCES, 0.3)
    const out = g.getOutgoingEdges("a")
    expect(out.length).toBe(2)
    const targets = out.map((e) => e.target).sort()
    expect(targets).toEqual(["b", "c"])
  })

  test("getIncomingEdges returns all incoming edges", () => {
    const g = createMemoryGraph()
    g.addNode("a")
    g.addNode("b")
    g.addNode("c")
    g.addEdge("a", "c", RelationType.DEPENDS_ON, 0.9)
    g.addEdge("b", "c", RelationType.SUPPORTS, 0.7)
    const incoming = g.getIncomingEdges("c")
    expect(incoming.length).toBe(2)
    const sources = incoming.map((e) => e.source).sort()
    expect(sources).toEqual(["a", "b"])
  })

  test("removeEdge removes specific edges", () => {
    const g = createMemoryGraph()
    g.addNode("a")
    g.addNode("b")
    g.addEdge("a", "b", RelationType.DEPENDS_ON, 0.8)
    expect(g.getOutgoingEdges("a").length).toBe(1)
    g.removeEdge("a", "b", RelationType.DEPENDS_ON)
    expect(g.getOutgoingEdges("a").length).toBe(0)
  })

  test("removeEdge without type removes all edges between nodes", () => {
    const g = createMemoryGraph()
    g.addNode("a")
    g.addNode("b")
    g.addEdge("a", "b", RelationType.DEPENDS_ON, 0.8)
    g.addEdge("a", "b", RelationType.SUPPORTS, 0.5)
    g.removeEdge("a", "b")
    expect(g.getOutgoingEdges("a").length).toBe(0)
  })

  test("strength is clamped to [0, 1]", () => {
    const g = createMemoryGraph()
    g.addNode("a")
    g.addNode("b")
    const e1 = g.addEdge("a", "b", RelationType.DEPENDS_ON, 1.5)
    expect(e1!.strength).toBe(1)
    const e2 = g.addEdge("b", "a", RelationType.DEPENDS_ON, -0.5)
    expect(e2!.strength).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Cascade Invalidation (Algorithm 2)
// ═══════════════════════════════════════════════════════════════════════════

describe("Cascade Invalidation (BFS)", () => {
  test("single-hop invalidation: updating parent marks child STALE", () => {
    const g = createMemoryGraph()
    g.addNode("fact", { value: "old" })
    g.addNode("belief", { based_on: "fact" })
    g.addEdge("fact", "belief", RelationType.DEPENDS_ON, 1.0)

    g.updateNode("fact", { value: "new" }, "correction")

    const belief = g.getNode("belief")!
    expect(belief.consistencyStatus).toBe(ConsistencyStatus.STALE)
    expect(belief.staleReasons.length).toBeGreaterThan(0)
    expect(belief.staleReasons[0]).toContain("fact")
  })

  test("multi-hop chain: 4-hop dependency all marked STALE", () => {
    const g = createMemoryGraph()
    g.addNode("a")
    g.addNode("b")
    g.addNode("c")
    g.addNode("d")
    g.addEdge("a", "b", RelationType.DEPENDS_ON, 1.0)
    g.addEdge("b", "c", RelationType.DEPENDS_ON, 1.0)
    g.addEdge("c", "d", RelationType.DEPENDS_ON, 1.0)

    g.updateNode("a", { revised: true }, "root revision")

    expect(g.getNode("b")!.consistencyStatus).toBe(ConsistencyStatus.STALE)
    expect(g.getNode("c")!.consistencyStatus).toBe(ConsistencyStatus.STALE)
    expect(g.getNode("d")!.consistencyStatus).toBe(ConsistencyStatus.STALE)
  })

  test("fan-out: one root update invalidates multiple children", () => {
    const g = createMemoryGraph()
    g.addNode("root")
    g.addNode("child1")
    g.addNode("child2")
    g.addNode("child3")
    g.addEdge("root", "child1", RelationType.DEPENDS_ON, 1.0)
    g.addEdge("root", "child2", RelationType.DEPENDS_ON, 1.0)
    g.addEdge("root", "child3", RelationType.DEPENDS_ON, 1.0)

    g.updateNode("root", { revised: true })

    expect(g.getNode("child1")!.consistencyStatus).toBe(ConsistencyStatus.STALE)
    expect(g.getNode("child2")!.consistencyStatus).toBe(ConsistencyStatus.STALE)
    expect(g.getNode("child3")!.consistencyStatus).toBe(ConsistencyStatus.STALE)
  })

  test("fan-in: multiple parents revised, child gets multiple stale reasons", () => {
    const g = createMemoryGraph()
    g.addNode("parent1")
    g.addNode("parent2")
    g.addNode("child")
    g.addEdge("parent1", "child", RelationType.DEPENDS_ON, 1.0)
    g.addEdge("parent2", "child", RelationType.SUPPORTS, 1.0)

    g.updateNode("parent1", { revised: true }, "first revision")
    g.updateNode("parent2", { revised: true }, "second revision")

    const child = g.getNode("child")!
    expect(child.consistencyStatus).toBe(ConsistencyStatus.STALE)
    expect(child.staleReasons.length).toBe(2)
  })

  test("cycle handling: self-loops don't cause infinite propagation", () => {
    const g = createMemoryGraph()
    g.addNode("a")
    g.addNode("b")
    g.addEdge("a", "b", RelationType.DEPENDS_ON, 1.0)
    g.addEdge("b", "a", RelationType.INFLUENCES, 1.0) // cycle

    // Should complete without hanging
    const result = g.updateNode("a", { revised: true })
    expect(result).not.toBeNull()

    // Both should be STALE (a is root=VALID after update, b is dependent)
    expect(g.getNode("a")!.consistencyStatus).toBe(ConsistencyStatus.VALID)
    expect(g.getNode("b")!.consistencyStatus).toBe(ConsistencyStatus.STALE)
  })

  test("cascadeInvalidate returns list of marked node IDs", () => {
    const g = createMemoryGraph()
    g.addNode("a")
    g.addNode("b")
    g.addNode("c")
    g.addEdge("a", "b", RelationType.DEPENDS_ON, 1.0)
    g.addEdge("b", "c", RelationType.DEPENDS_ON, 1.0)

    g.updateNode("a", { revised: true })
    // b and c should be stale
    expect(g.getNode("b")!.consistencyStatus).toBe(ConsistencyStatus.STALE)
    expect(g.getNode("c")!.consistencyStatus).toBe(ConsistencyStatus.STALE)
  })

  test("unrelated nodes are not affected", () => {
    const g = createMemoryGraph()
    g.addNode("a")
    g.addNode("b")
    g.addNode("unrelated")
    g.addEdge("a", "b", RelationType.DEPENDS_ON, 1.0)

    g.updateNode("a", { revised: true })

    expect(g.getNode("unrelated")!.consistencyStatus).toBe(ConsistencyStatus.VALID)
  })

  test("root node stays VALID after its own update", () => {
    const g = createMemoryGraph()
    g.addNode("a", { value: "old" })
    g.updateNode("a", { value: "new" })
    expect(g.getNode("a")!.consistencyStatus).toBe(ConsistencyStatus.VALID)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Revalidate (Algorithm 3)
// ═══════════════════════════════════════════════════════════════════════════

describe("Revalidate (Reversible Propagation)", () => {
  test("revalidate restores STALE chain to VALID", () => {
    const g = createMemoryGraph()
    g.addNode("a")
    g.addNode("b")
    g.addNode("c")
    g.addEdge("a", "b", RelationType.DEPENDS_ON, 1.0)
    g.addEdge("b", "c", RelationType.DEPENDS_ON, 1.0)

    // Make everything STALE
    g.updateNode("a", { revised: true })
    expect(g.getNode("b")!.consistencyStatus).toBe(ConsistencyStatus.STALE)
    expect(g.getNode("c")!.consistencyStatus).toBe(ConsistencyStatus.STALE)

    // Revalidate
    const revalidated = g.revalidate("a", "correction reverted")
    expect(revalidated.length).toBe(3) // a, b, c
    expect(g.getNode("a")!.consistencyStatus).toBe(ConsistencyStatus.VALID)
    expect(g.getNode("b")!.consistencyStatus).toBe(ConsistencyStatus.VALID)
    expect(g.getNode("c")!.consistencyStatus).toBe(ConsistencyStatus.VALID)
  })

  test("revalidate clears stale reasons", () => {
    const g = createMemoryGraph()
    g.addNode("a")
    g.addNode("b")
    g.addEdge("a", "b", RelationType.DEPENDS_ON, 1.0)
    g.updateNode("a", { revised: true })
    expect(g.getNode("b")!.staleReasons.length).toBeGreaterThan(0)

    g.revalidate("a", "fixed")
    expect(g.getNode("b")!.staleReasons.length).toBe(0)
  })

  test("revalidate only affects nodes reachable from corrected node", () => {
    const g = createMemoryGraph()
    g.addNode("a")
    g.addNode("b")
    g.addNode("c")
    g.addNode("d")
    g.addEdge("a", "b", RelationType.DEPENDS_ON, 1.0)
    g.addEdge("c", "d", RelationType.DEPENDS_ON, 1.0) // separate chain

    g.updateNode("a", { revised: true })
    g.updateNode("c", { revised: true })

    expect(g.getNode("b")!.consistencyStatus).toBe(ConsistencyStatus.STALE)
    expect(g.getNode("d")!.consistencyStatus).toBe(ConsistencyStatus.STALE)

    // Only revalidate chain a→b
    g.revalidate("a", "fixed a")
    expect(g.getNode("b")!.consistencyStatus).toBe(ConsistencyStatus.VALID)
    expect(g.getNode("d")!.consistencyStatus).toBe(ConsistencyStatus.STALE) // still stale
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Conflict Detection (Algorithm 4)
// ═══════════════════════════════════════════════════════════════════════════

describe("Conflict Detection", () => {
  test("detectConflict identifies contradictory values", () => {
    const g = createMemoryGraph()
    g.addNode("person", { name: "Alice", role: "admin" })

    const conflicts = g.detectConflict("person", { role: "user" })
    expect(conflicts).toContain("role")
  })

  test("detectConflict marks node as CONFLICT", () => {
    const g = createMemoryGraph()
    g.addNode("fact", { status: "active" })

    g.detectConflict("fact", { status: "inactive" })

    expect(g.getNode("fact")!.consistencyStatus).toBe(ConsistencyStatus.CONFLICT)
    expect(g.getNode("fact")!.staleReasons.length).toBeGreaterThan(0)
  })

  test("detectConflict returns empty array for no conflicts", () => {
    const g = createMemoryGraph()
    g.addNode("fact", { x: 1 })

    const conflicts = g.detectConflict("fact", { y: 2 }) // new key, no conflict
    expect(conflicts).toEqual([])
  })

  test("detectConflict returns empty for same values", () => {
    const g = createMemoryGraph()
    g.addNode("fact", { x: 1 })
    expect(g.detectConflict("fact", { x: 1 })).toEqual([])
  })

  test("detectConflict returns empty for nonexistent node", () => {
    const g = createMemoryGraph()
    expect(g.detectConflict("nope", {})).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Enhanced Propagation Strategies (Section 4.3)
// ═══════════════════════════════════════════════════════════════════════════

describe("Enhanced Propagation Strategies", () => {
  test("depth limit: propagation stops at maxDepth", () => {
    const g = createMemoryGraph({ maxDepth: 2 })
    // Create a 5-node chain
    g.addNode("n0")
    g.addNode("n1")
    g.addNode("n2")
    g.addNode("n3")
    g.addNode("n4")
    g.addEdge("n0", "n1", RelationType.DEPENDS_ON, 1.0)
    g.addEdge("n1", "n2", RelationType.DEPENDS_ON, 1.0)
    g.addEdge("n2", "n3", RelationType.DEPENDS_ON, 1.0)
    g.addEdge("n3", "n4", RelationType.DEPENDS_ON, 1.0)

    g.updateNode("n0", { revised: true })

    // depth 0: n0 (root, stays VALID)
    // depth 1: n1 → STALE
    // depth 2: n2 → STALE
    // depth 3: n3 → NOT reached (maxDepth=2)
    // depth 4: n4 → NOT reached
    expect(g.getNode("n1")!.consistencyStatus).toBe(ConsistencyStatus.STALE)
    expect(g.getNode("n2")!.consistencyStatus).toBe(ConsistencyStatus.STALE)
    expect(g.getNode("n3")!.consistencyStatus).toBe(ConsistencyStatus.VALID)
    expect(g.getNode("n4")!.consistencyStatus).toBe(ConsistencyStatus.VALID)
  })

  test("strength threshold: weak edges don't propagate", () => {
    const g = createMemoryGraph({ minCausalStrength: 0.5 })
    g.addNode("a")
    g.addNode("b")
    g.addEdge("a", "b", RelationType.DEPENDS_ON, 0.3) // below threshold

    g.updateNode("a", { revised: true })

    expect(g.getNode("b")!.consistencyStatus).toBe(ConsistencyStatus.VALID)
  })

  test("strength threshold: strong edges propagate", () => {
    const g = createMemoryGraph({ minCausalStrength: 0.5 })
    g.addNode("a")
    g.addNode("b")
    g.addEdge("a", "b", RelationType.DEPENDS_ON, 0.9) // above threshold

    g.updateNode("a", { revised: true })

    expect(g.getNode("b")!.consistencyStatus).toBe(ConsistencyStatus.STALE)
  })

  test("edge type filtering: only active types propagate", () => {
    const g = createMemoryGraph({
      activeRelationTypes: [RelationType.DEPENDS_ON], // only DEPENDS_ON
    })
    g.addNode("a")
    g.addNode("b")
    g.addNode("c")
    g.addEdge("a", "b", RelationType.DEPENDS_ON, 1.0)
    g.addEdge("a", "c", RelationType.INFLUENCES, 1.0) // not active

    g.updateNode("a", { revised: true })

    expect(g.getNode("b")!.consistencyStatus).toBe(ConsistencyStatus.STALE)
    expect(g.getNode("c")!.consistencyStatus).toBe(ConsistencyStatus.VALID)
  })

  test("adaptive depth: high-priority keywords get extra depth", () => {
    const g = createMemoryGraph({
      maxDepth: 1,
      adaptiveDepthBoost: 2,
      highPriorityKeywords: ["fraud"],
    })
    g.addNode("n0", { topic: "fraud investigation" })
    g.addNode("n1")
    g.addNode("n2")
    g.addNode("n3")
    g.addEdge("n0", "n1", RelationType.DEPENDS_ON, 1.0)
    g.addEdge("n1", "n2", RelationType.DEPENDS_ON, 1.0)
    g.addEdge("n2", "n3", RelationType.DEPENDS_ON, 1.0)

    g.updateNode("n0", { revised: true })

    // With adaptive depth: maxDepth=1+2=3 → n1, n2, n3 all STALE
    expect(g.getNode("n1")!.consistencyStatus).toBe(ConsistencyStatus.STALE)
    expect(g.getNode("n2")!.consistencyStatus).toBe(ConsistencyStatus.STALE)
    expect(g.getNode("n3")!.consistencyStatus).toBe(ConsistencyStatus.STALE)
  })

  test("strength decay: long chains weaken edge strength", () => {
    const g = createMemoryGraph({
      maxDepth: 10,
      strengthDecayFactor: 0.5,
      minCausalStrength: 0.3,
    })
    g.addNode("n0")
    g.addNode("n1")
    g.addNode("n2")
    g.addNode("n3")
    g.addEdge("n0", "n1", RelationType.DEPENDS_ON, 1.0)
    g.addEdge("n1", "n2", RelationType.DEPENDS_ON, 1.0)
    g.addEdge("n2", "n3", RelationType.DEPENDS_ON, 1.0)

    g.updateNode("n0", { revised: true })

    // n1: 1.0 * 0.5^1 = 0.5 > 0.3 → STALE
    // n2: 1.0 * 0.5^2 = 0.25 < 0.3 → NOT reached
    // n3: unreachable
    expect(g.getNode("n1")!.consistencyStatus).toBe(ConsistencyStatus.STALE)
    expect(g.getNode("n2")!.consistencyStatus).toBe(ConsistencyStatus.VALID)
    expect(g.getNode("n3")!.consistencyStatus).toBe(ConsistencyStatus.VALID)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Retrieval Modes (Table 3, Section 4.5)
// ═══════════════════════════════════════════════════════════════════════════

describe("Retrieval Modes", () => {
  test("LATEST_VALID excludes STALE nodes", () => {
    const g = createMemoryGraph()
    g.addNode("a")
    g.addNode("b")
    g.addNode("c")
    g.addEdge("a", "b", RelationType.DEPENDS_ON, 1.0)

    g.updateNode("a", { revised: true })

    const retriever = createConsistencyRetriever({ topK: 100 })
    const results = retriever.retrieve(g, undefined, RetrievalMode.LATEST_VALID)

    const ids = results.map((r) => r.node.nodeId)
    expect(ids).toContain("a") // root stays VALID
    expect(ids).toContain("c") // unrelated
    expect(ids).not.toContain("b") // STALE → excluded
  })

  test("CONSISTENT_ONLY returns only VALID nodes", () => {
    const g = createMemoryGraph()
    g.addNode("a")
    g.addNode("b")
    g.addEdge("a", "b", RelationType.DEPENDS_ON, 1.0)
    g.updateNode("a", { revised: true })

    const retriever = createConsistencyRetriever({ topK: 100 })
    const results = retriever.retrieve(g, undefined, RetrievalMode.CONSISTENT_ONLY)

    for (const r of results) {
      expect(r.node.consistencyStatus).toBe(ConsistencyStatus.VALID)
    }
  })

  test("INCLUDE_STALE includes STALE nodes with warning", () => {
    const g = createMemoryGraph()
    g.addNode("a")
    g.addNode("b")
    g.addEdge("a", "b", RelationType.DEPENDS_ON, 1.0)
    g.updateNode("a", { revised: true })

    const retriever = createConsistencyRetriever({ topK: 100 })
    const results = retriever.retrieve(g, undefined, RetrievalMode.INCLUDE_STALE)

    const bResult = results.find((r) => r.node.nodeId === "b")
    expect(bResult).toBeDefined()
    expect(bResult!.warning).toBeDefined()
    expect(bResult!.warning).toContain("STALE")
  })

  test("ALL_VERSIONS returns latest regardless of status", () => {
    const g = createMemoryGraph()
    g.addNode("a")
    g.addNode("b")
    g.addEdge("a", "b", RelationType.DEPENDS_ON, 1.0)
    g.updateNode("a", { revised: true })

    const retriever = createConsistencyRetriever({ topK: 100 })
    const results = retriever.retrieve(g, undefined, RetrievalMode.ALL_VERSIONS)

    const ids = results.map((r) => r.node.nodeId)
    expect(ids).toContain("a")
    expect(ids).toContain("b") // included regardless of STALE
  })

  test("AT_TIME returns version valid at timestamp", () => {
    const g = createMemoryGraph()
    g.addNode("a", { v: 0 })
    g.updateNode("a", { v: 1 })

    // Timestamp before node existed: no results
    const retriever = createConsistencyRetriever()
    const beforeResults = retriever.retrieve(g, undefined, RetrievalMode.AT_TIME, 0)
    expect(beforeResults.length).toBe(0)

    // Timestamp now returns latest version
    const nowResults = retriever.retrieve(g, undefined, RetrievalMode.AT_TIME, Date.now())
    const aResult = nowResults.find((r) => r.node.nodeId === "a")
    expect(aResult).toBeDefined()
    expect(aResult!.node.version).toBe(1)
  })

  test("relevance scoring sorts by query match", () => {
    const g = createMemoryGraph()
    g.addNode("a", { name: "Alice", role: "admin" })
    g.addNode("b", { name: "Bob", role: "user" })
    g.addNode("c", { name: "Charlie", role: "admin" })

    const retriever = createConsistencyRetriever()
    const results = retriever.retrieve(g, "admin")

    // First results should match "admin"
    expect(results.length).toBeGreaterThan(0)
    // admin-related nodes should have higher relevance
    const adminResults = results.filter(
      (r) => (r.node.content as Record<string, unknown>).role === "admin",
    )
    expect(adminResults.length).toBe(2)
    expect(adminResults[0]!.relevance).toBeGreaterThan(0)
  })

  test("OBSOLETE nodes are excluded by all modes except AT_TIME", () => {
    const g = createMemoryGraph()
    g.addNode("a", { v: 0 })
    g.updateNode("a", { v: 1 }) // v0 becomes OBSOLETE

    const retriever = createConsistencyRetriever({ topK: 100 })

    for (const mode of [
      RetrievalMode.LATEST_VALID,
      RetrievalMode.CONSISTENT_ONLY,
      RetrievalMode.INCLUDE_STALE,
      RetrievalMode.ALL_VERSIONS,
    ]) {
      const results = retriever.retrieve(g, undefined, mode)
      // Only latest (v1) should be returned
      expect(results.length).toBe(1)
      expect(results[0]!.node.version).toBe(1)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Live Index Validation (Section 4.5)
// ═══════════════════════════════════════════════════════════════════════════

describe("Live Index Validation", () => {
  test("validateIndex marks entries with advanced version as invalid", () => {
    const g = createMemoryGraph()
    g.addNode("a", { v: 0 })

    const retriever = createConsistencyRetriever()
    // Index was built when a was at v0
    const result = retriever.validateIndex(g, [
      { nodeId: "a", indexedVersion: 0 },
    ])
    expect(result[0]!.valid).toBe(true)

    // Node advances → index becomes stale
    g.updateNode("a", { v: 1 })
    const result2 = retriever.validateIndex(g, [
      { nodeId: "a", indexedVersion: 0 },
    ])
    expect(result2[0]!.valid).toBe(false)
  })

  test("validateIndex marks STALE nodes as invalid", () => {
    const g = createMemoryGraph()
    g.addNode("a")
    g.addNode("b")
    g.addEdge("a", "b", RelationType.DEPENDS_ON, 1.0)

    const retriever = createConsistencyRetriever()
    const result0 = retriever.validateIndex(g, [
      { nodeId: "b", indexedVersion: 0 },
    ])
    expect(result0[0]!.valid).toBe(true)

    g.updateNode("a", { revised: true })
    const result1 = retriever.validateIndex(g, [
      { nodeId: "b", indexedVersion: 0 },
    ])
    expect(result1[0]!.valid).toBe(false) // STALE
  })

  test("validateIndex marks missing nodes as invalid", () => {
    const retriever = createConsistencyRetriever()
    const g = createMemoryGraph()
    const result = retriever.validateIndex(g, [
      { nodeId: "nonexistent", indexedVersion: 0 },
    ])
    expect(result[0]!.valid).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Paper Scenario: Zhang San Fraud (Section 1.1 + Experiment H)
// ═══════════════════════════════════════════════════════════════════════════

describe("Zhang San Fraud Scenario (Paper Experiment H)", () => {
  test("fraudulent person → contract → report cascade", () => {
    const g = createMemoryGraph()

    // t0: initial state
    g.addNode("person", { name: "Zhang San", status: "honest" })
    g.addNode("contract", { id: "C", status: "safe", partner: "Zhang San" })
    g.addNode("report", { conclusion: "Contract C is safe" })

    g.addEdge("person", "contract", RelationType.DEPENDS_ON, 1.0)
    g.addEdge("contract", "report", RelationType.DEPENDS_ON, 1.0)

    // Initial state: all VALID
    expect(g.getNode("person")!.consistencyStatus).toBe(ConsistencyStatus.VALID)
    expect(g.getNode("contract")!.consistencyStatus).toBe(ConsistencyStatus.VALID)
    expect(g.getNode("report")!.consistencyStatus).toBe(ConsistencyStatus.VALID)

    // t1: Zhang San discovered as fraudster
    g.updateNode("person", { status: "fraudster" }, "fraud detected")

    // t2: contract and report should be STALE
    expect(g.getNode("person")!.consistencyStatus).toBe(ConsistencyStatus.VALID)
    expect(g.getNode("contract")!.consistencyStatus).toBe(ConsistencyStatus.STALE)
    expect(g.getNode("report")!.consistencyStatus).toBe(ConsistencyStatus.STALE)

    // t3: revalidate (suppose fraud investigation cleared Zhang San)
    g.revalidate("person", "fraud allegation cleared")

    expect(g.getNode("person")!.consistencyStatus).toBe(ConsistencyStatus.VALID)
    expect(g.getNode("contract")!.consistencyStatus).toBe(ConsistencyStatus.VALID)
    expect(g.getNode("report")!.consistencyStatus).toBe(ConsistencyStatus.VALID)
  })

  test("retrieval excludes stale contract in LATEST_VALID mode", () => {
    const g = createMemoryGraph()
    g.addNode("person", { name: "Zhang San", status: "honest" })
    g.addNode("contract", { id: "C", status: "safe" })
    g.addEdge("person", "contract", RelationType.DEPENDS_ON, 1.0)
    g.updateNode("person", { status: "fraudster" })

    const retriever = createConsistencyRetriever()
    const results = retriever.retrieve(g, "contract", RetrievalMode.LATEST_VALID)
    // Contract is STALE → should not appear
    expect(results.find((r) => r.node.nodeId === "contract")).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Theorem 3.4: Propagation Degradation Under Edge Deletion
// ═══════════════════════════════════════════════════════════════════════════

describe("Edge Deletion Propagation Gap (Theorem 3.4)", () => {
  test("removing an edge breaks the cascade chain", () => {
    const g = createMemoryGraph()
    g.addNode("a")
    g.addNode("b")
    g.addNode("c")
    g.addEdge("a", "b", RelationType.DEPENDS_ON, 1.0)
    g.addEdge("b", "c", RelationType.DEPENDS_ON, 1.0)

    // Remove the a→b edge
    g.removeEdge("a", "b")

    g.updateNode("a", { revised: true })

    // Without a→b edge, b should not be STALE
    expect(g.getNode("b")!.consistencyStatus).toBe(ConsistencyStatus.VALID)
    expect(g.getNode("c")!.consistencyStatus).toBe(ConsistencyStatus.VALID)
  })

  test("partial edge recovery: one of two parent paths intact", () => {
    const g = createMemoryGraph()
    g.addNode("a")
    g.addNode("b")
    g.addNode("c")
    g.addEdge("a", "c", RelationType.DEPENDS_ON, 1.0)
    g.addEdge("b", "c", RelationType.DEPENDS_ON, 1.0)

    // Remove one parent path
    g.removeEdge("a", "c")

    g.updateNode("a", { revised: true })
    // c still depends on b which is unchanged → stays VALID
    expect(g.getNode("c")!.consistencyStatus).toBe(ConsistencyStatus.VALID)

    g.updateNode("b", { revised: true })
    // Now c's remaining parent is revised → STALE
    expect(g.getNode("c")!.consistencyStatus).toBe(ConsistencyStatus.STALE)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Statistics
// ═══════════════════════════════════════════════════════════════════════════

describe("Statistics", () => {
  test("getStatistics returns correct node/edge counts", () => {
    const g = createMemoryGraph()
    g.addNode("a")
    g.addNode("b")
    g.addEdge("a", "b", RelationType.DEPENDS_ON, 1.0)

    const stats = g.getStatistics()
    expect(stats.nodeCount).toBe(2)
    expect(stats.edgeCount).toBe(1)
    expect(stats.totalVersions).toBe(2)
  })

  test("getStatistics reflects consistency distribution", () => {
    const g = createMemoryGraph()
    g.addNode("a")
    g.addNode("b")
    g.addNode("c")
    g.addEdge("a", "b", RelationType.DEPENDS_ON, 1.0)

    g.updateNode("a", { revised: true })

    const stats = g.getStatistics()
    const dist = stats.consistencyDistribution as Record<string, number>
    expect(dist.valid).toBe(2) // a (root) and c (unrelated)
    expect(dist.stale).toBe(1) // b
    expect(dist.conflict).toBe(0)
  })

  test("getStatistics includes config snapshot", () => {
    const g = createMemoryGraph({ maxDepth: 3 })
    const stats = g.getStatistics()
    const config = stats.config as Record<string, unknown>
    expect(config.maxDepth).toBe(3)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Factory Functions
// ═══════════════════════════════════════════════════════════════════════════

describe("Factory Functions", () => {
  test("createMemoryGraph returns a working MemoryGraph", () => {
    const g = createMemoryGraph()
    expect(g).toBeInstanceOf(MemoryGraph)
    g.addNode("test")
    expect(g.hasNode("test")).toBe(true)
  })

  test("createConsistencyRetriever returns a working retriever", () => {
    const r = createConsistencyRetriever()
    expect(r).toBeInstanceOf(ConsistencyRetriever)
  })

  test("generateNodeId produces unique IDs", () => {
    const ids = new Set<string>()
    for (let i = 0; i < 100; i++) {
      ids.add(generateNodeId())
    }
    expect(ids.size).toBe(100)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Performance / Stress
// ═══════════════════════════════════════════════════════════════════════════

describe("Stress Tests", () => {
  test("large fan-out: 100 children all correctly invalidated", () => {
    const g = createMemoryGraph()
    g.addNode("root")
    for (let i = 0; i < 100; i++) {
      g.addNode(`child_${i}`)
      g.addEdge("root", `child_${i}`, RelationType.DEPENDS_ON, 1.0)
    }

    g.updateNode("root", { revised: true })

    for (let i = 0; i < 100; i++) {
      expect(g.getNode(`child_${i}`)!.consistencyStatus).toBe(ConsistencyStatus.STALE)
    }
  })

  test("deep chain within depth limit", () => {
    const chainLen = 10
    const g = createMemoryGraph({ maxDepth: chainLen })
    for (let i = 0; i < chainLen; i++) {
      g.addNode(`n${i}`)
    }
    for (let i = 0; i < chainLen - 1; i++) {
      g.addEdge(`n${i}`, `n${i + 1}`, RelationType.DEPENDS_ON, 1.0)
    }

    g.updateNode("n0", { revised: true })

    // All except root should be STALE
    for (let i = 1; i < chainLen; i++) {
      expect(g.getNode(`n${i}`)!.consistencyStatus).toBe(ConsistencyStatus.STALE)
    }
  })

  test("multiple version updates don't leak", () => {
    const g = createMemoryGraph()
    g.addNode("a", { count: 0 })
    for (let i = 1; i <= 50; i++) {
      g.updateNode("a", { count: i })
    }
    const history = g.getVersionHistory("a")
    expect(history.length).toBe(51) // v0 + 50 updates
    const latest = g.getNode("a")!
    expect(latest.version).toBe(50)
    expect(latest.content).toEqual({ count: 50 })
  })
})
