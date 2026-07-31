/**
 * taskdag — DAG validation, ready-node scheduling, failure propagation.
 *
 * Run: bun run taskdag.ts
 */
import {
  getReadyNodes,
  getTransitiveDependents,
  isComplete,
  markNodeFailed,
  validateDAG,
} from "../packages/taskdag/src/index.ts"

const dag = {
  version: 1,
  nodes: [
    {
      node_id: "n1",
      capability_id: "parse",
      inputs: {},
      dependencies: [],
      risk_level: 1,
      estimated_tokens: 100,
      estimated_duration_ms: 10,
      status: "completed" as const,
    },
    {
      node_id: "n2",
      capability_id: "lint",
      inputs: {},
      dependencies: ["n1"],
      risk_level: 2,
      estimated_tokens: 200,
      estimated_duration_ms: 20,
      status: "pending" as const,
    },
    {
      node_id: "n3",
      capability_id: "test",
      inputs: {},
      dependencies: ["n2"],
      risk_level: 3,
      estimated_tokens: 300,
      estimated_duration_ms: 30,
      status: "pending" as const,
    },
    {
      node_id: "n4",
      capability_id: "deploy",
      inputs: {},
      dependencies: ["n3"],
      risk_level: 4,
      estimated_tokens: 400,
      estimated_duration_ms: 40,
      status: "pending" as const,
    },
  ],
  edges: [
    ["n1", "n2"],
    ["n2", "n3"],
    ["n3", "n4"],
  ] as [string, string][],
}

const validation = validateDAG(dag)
console.log("valid DAG:", validation.valid, validation.error ?? "")

console.log(
  "ready nodes:",
  getReadyNodes(dag).map((n) => n.node_id),
)

// n2 fails -> n3 and n4 become blocked
markNodeFailed(dag, "n2")
console.log("transitive dependents of n2:", [...getTransitiveDependents(dag, "n2")].join(", "))
console.log("complete:", isComplete(dag))
