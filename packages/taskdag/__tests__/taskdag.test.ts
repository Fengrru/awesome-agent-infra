import { describe, expect, test } from "bun:test"
import {
  validateDAG,
  getReadyNodes,
  markNodeFailed,
  getTransitiveDependents,
  estimateDAGCost,
  replaceSubtree,
  isComplete,
  allSucceeded,
  type DAG,
  type DAGNode,
} from "../src/index"

function makeNode(id: string, overrides?: Partial<DAGNode>): DAGNode {
  return {
    node_id: id,
    capability_id: `cap-${id}`,
    inputs: {},
    dependencies: [],
    risk_level: 0,
    estimated_tokens: 100,
    estimated_duration_ms: 1000,
    status: "pending",
    ...overrides,
  }
}

/** Linear DAG: a → b → c */
function makeLinearDAG(): DAG {
  return {
    version: 1,
    nodes: [
      makeNode("a"),
      makeNode("b", { dependencies: ["a"] }),
      makeNode("c", { dependencies: ["b"] }),
    ],
    edges: [
      ["a", "b"],
      ["b", "c"],
    ],
    metadata: { goal: "test", strategy: "SEQUENTIAL", replan_count: 0, created_at: Date.now() },
  }
}

/** Diamond DAG: a → b, a → c, b → d, c → d */
function makeDiamondDAG(): DAG {
  return {
    version: 1,
    nodes: [
      makeNode("a"),
      makeNode("b", { dependencies: ["a"] }),
      makeNode("c", { dependencies: ["a"] }),
      makeNode("d", { dependencies: ["b", "c"] }),
    ],
    edges: [
      ["a", "b"],
      ["a", "c"],
      ["b", "d"],
      ["c", "d"],
    ],
  }
}

describe("validateDAG", () => {
  test("valid linear DAG returns execution order", () => {
    const result = validateDAG(makeLinearDAG())
    expect(result.valid).toBe(true)
    expect(result.executionOrder).toEqual(["a", "b", "c"])
  })

  test("valid diamond DAG orders sources before sinks", () => {
    const result = validateDAG(makeDiamondDAG())
    expect(result.valid).toBe(true)
    const order = result.executionOrder!
    expect(order[0]).toBe("a")
    expect(order[3]).toBe("d")
    expect(order.length).toBe(4)
  })

  test("detects cycle and reports cycle nodes", () => {
    const dag: DAG = {
      version: 1,
      nodes: [makeNode("a", { dependencies: ["b"] }), makeNode("b", { dependencies: ["a"] })],
      edges: [
        ["a", "b"],
        ["b", "a"],
      ],
    }
    const result = validateDAG(dag)
    expect(result.valid).toBe(false)
    expect(result.error).toBe("CYCLE_DETECTED")
    expect(result.cycleNodes).toContain("a")
    expect(result.cycleNodes).toContain("b")
  })

  test("rejects edge with unknown source node", () => {
    const dag: DAG = { version: 1, nodes: [makeNode("a")], edges: [["ghost", "a"]] }
    const result = validateDAG(dag)
    expect(result.valid).toBe(false)
    expect(result.error).toContain("UNKNOWN_SOURCE_NODE")
  })

  test("rejects edge with unknown target node", () => {
    const dag: DAG = { version: 1, nodes: [makeNode("a")], edges: [["a", "ghost"]] }
    const result = validateDAG(dag)
    expect(result.valid).toBe(false)
    expect(result.error).toContain("UNKNOWN_TARGET_NODE")
  })

  test("rejects node with unknown dependency", () => {
    const dag: DAG = {
      version: 1,
      nodes: [makeNode("a", { dependencies: ["ghost"] })],
      edges: [],
    }
    const result = validateDAG(dag)
    expect(result.valid).toBe(false)
    expect(result.error).toContain("UNKNOWN_DEPENDENCY")
  })

  test("empty DAG is valid with empty order", () => {
    const result = validateDAG({ version: 1, nodes: [], edges: [] })
    expect(result.valid).toBe(true)
    expect(result.executionOrder).toEqual([])
  })
})

describe("getReadyNodes", () => {
  test("returns only root nodes initially", () => {
    const ready = getReadyNodes(makeDiamondDAG())
    expect(ready.map((n) => n.node_id)).toEqual(["a"])
  })

  test("unblocks downstream after dependency completes", () => {
    const dag = makeDiamondDAG()
    dag.nodes[0]!.status = "completed"
    const ready = getReadyNodes(dag)
    expect(ready.map((n) => n.node_id).sort()).toEqual(["b", "c"])
  })

  test("node with partially completed dependencies is not ready", () => {
    const dag = makeDiamondDAG()
    dag.nodes[0]!.status = "completed"
    dag.nodes[1]!.status = "completed" // b done, c still pending
    const ready = getReadyNodes(dag)
    expect(ready.map((n) => n.node_id)).toEqual(["c"])
  })

  test("running and completed nodes are excluded", () => {
    const dag = makeLinearDAG()
    dag.nodes[0]!.status = "running"
    expect(getReadyNodes(dag)).toEqual([])
  })
})

describe("markNodeFailed", () => {
  test("marks node failed and blocks direct pending dependents", () => {
    const result = markNodeFailed(makeLinearDAG(), "a")
    expect(result.nodes.find((n) => n.node_id === "a")!.status).toBe("failed")
    expect(result.nodes.find((n) => n.node_id === "b")!.status).toBe("blocked")
    // c is not a direct dependent of a — only direct edges are blocked
    expect(result.nodes.find((n) => n.node_id === "c")!.status).toBe("pending")
  })

  test("does not block non-pending dependents", () => {
    const dag = makeLinearDAG()
    dag.nodes[1]!.status = "completed"
    const result = markNodeFailed(dag, "a")
    expect(result.nodes.find((n) => n.node_id === "b")!.status).toBe("completed")
  })

  test("is immutable — original DAG unchanged", () => {
    const dag = makeLinearDAG()
    markNodeFailed(dag, "a")
    expect(dag.nodes.find((n) => n.node_id === "a")!.status).toBe("pending")
  })
})

describe("getTransitiveDependents", () => {
  test("collects all downstream nodes via BFS", () => {
    const deps = getTransitiveDependents(makeLinearDAG(), "a")
    expect([...deps].sort()).toEqual(["b", "c"])
  })

  test("diamond root reaches every other node exactly once", () => {
    const deps = getTransitiveDependents(makeDiamondDAG(), "a")
    expect([...deps].sort()).toEqual(["b", "c", "d"])
  })

  test("sink node has no dependents", () => {
    const deps = getTransitiveDependents(makeLinearDAG(), "c")
    expect(deps.size).toBe(0)
  })
})

describe("estimateDAGCost", () => {
  test("sums tokens and duration across nodes", () => {
    const cost = estimateDAGCost(makeLinearDAG())
    expect(cost.total_tokens).toBe(300)
    expect(cost.total_duration_ms).toBe(3000)
  })

  test("empty DAG costs zero", () => {
    expect(estimateDAGCost({ version: 1, nodes: [], edges: [] })).toEqual({
      total_tokens: 0,
      total_duration_ms: 0,
    })
  })
})

describe("replaceSubtree", () => {
  test("replaces failed subtree and preserves completed nodes", () => {
    const dag = makeLinearDAG()
    dag.nodes[0]!.status = "completed"
    dag.nodes[1]!.status = "failed"

    const replacement = [makeNode("b2", { dependencies: ["a"] })]
    const result = replaceSubtree(dag, "b", replacement)

    const ids = result.nodes.map((n) => n.node_id).sort()
    expect(ids).toEqual(["a", "b2"])
    expect(result.version).toBe(2)
    expect(result.edges).toContainEqual(["a", "b2"])
    // old subtree edges removed
    expect(result.edges).not.toContainEqual(["a", "b"])
    expect(result.edges).not.toContainEqual(["b", "c"])
  })

  test("filters replacement dependencies pointing to removed nodes", () => {
    const dag = makeLinearDAG()
    const replacement = [makeNode("x", { dependencies: ["a", "b", "ghost"] })]
    // replacing b removes b and c; dep on b and ghost must be dropped
    const result = replaceSubtree(dag, "b", replacement)
    const x = result.nodes.find((n) => n.node_id === "x")!
    expect(x.dependencies).toEqual(["a"])
  })

  test("increments replan_count and keeps goal", () => {
    const dag = makeLinearDAG()
    const result = replaceSubtree(dag, "c", [])
    expect(result.metadata!.replan_count).toBe(1)
    expect(result.metadata!.goal).toBe("test")
  })
})

describe("isComplete / allSucceeded", () => {
  test("empty DAG is never complete", () => {
    const empty: DAG = { version: 1, nodes: [], edges: [] }
    expect(isComplete(empty)).toBe(false)
    expect(allSucceeded(empty)).toBe(false)
  })

  test("pending nodes mean incomplete", () => {
    expect(isComplete(makeLinearDAG())).toBe(false)
  })

  test("all terminal statuses mean complete", () => {
    const dag = makeLinearDAG()
    dag.nodes[0]!.status = "completed"
    dag.nodes[1]!.status = "failed"
    dag.nodes[2]!.status = "blocked"
    expect(isComplete(dag)).toBe(true)
    expect(allSucceeded(dag)).toBe(false)
  })

  test("allSucceeded true when completed or blocked only", () => {
    const dag = makeLinearDAG()
    dag.nodes.forEach((n) => (n.status = "completed"))
    expect(allSucceeded(dag)).toBe(true)
    dag.nodes[2]!.status = "blocked"
    expect(allSucceeded(dag)).toBe(true)
    dag.nodes[2]!.status = "failed"
    expect(allSucceeded(dag)).toBe(false)
  })
})
