/**
 * TaskDAG — TypeScript DAG execution engine for AI agent task orchestration.
 *
 * Core operations:
 * - validateDAG — Kahn's algorithm topological sort + cycle detection
 * - getReadyNodes — find nodes whose dependencies are all completed
 * - markNodeFailed — cascade-block downstream nodes via edge traversal
 * - getTransitiveDependents — BFS for all downstream dependents
 * - replaceSubtree — incremental replan: replace failed subtree, preserve completed
 * - isComplete / allSucceeded — termination detection
 * - estimateDAGCost — token + duration estimation
 */

export interface DAGNode {
  node_id: string
  capability_id: string
  inputs: Record<string, unknown>
  dependencies: string[]
  risk_level: number
  estimated_tokens: number
  estimated_duration_ms: number
  status: "pending" | "running" | "completed" | "failed" | "blocked"
  output?: unknown
}

export interface DAG {
  version: number
  nodes: DAGNode[]
  edges: [string, string][]
  metadata?: {
    goal: string
    strategy: string
    replan_count: number
    created_at: number
  }
}

export interface DAGValidationResult {
  valid: boolean
  executionOrder?: string[]
  error?: string
  cycleNodes?: string[]
  orphanNodes?: string[]
}

/** Validate DAG structure: check edges, detect cycles via Kahn's algorithm, verify dependencies */
export function validateDAG(dag: DAG): DAGValidationResult {
  const inDegree = new Map<string, number>()
  const adj = new Map<string, string[]>()
  const nodeIds = new Set(dag.nodes.map((n) => n.node_id))

  for (const node of dag.nodes) {
    inDegree.set(node.node_id, 0)
    adj.set(node.node_id, [])
  }

  for (const [from, to] of dag.edges) {
    if (!nodeIds.has(from)) return { valid: false, error: `UNKNOWN_SOURCE_NODE: ${from}` }
    if (!nodeIds.has(to)) return { valid: false, error: `UNKNOWN_TARGET_NODE: ${to}` }
    adj.get(from)!.push(to)
    inDegree.set(to, (inDegree.get(to) || 0) + 1)
  }

  const queue: string[] = []
  for (const node of dag.nodes) {
    if ((inDegree.get(node.node_id) || 0) === 0) queue.push(node.node_id)
  }

  const sorted: string[] = []
  let head = 0
  while (head < queue.length) {
    const current = queue[head++]!
    sorted.push(current)
    for (const neighbor of adj.get(current) || []) {
      const newDegree = (inDegree.get(neighbor) || 0) - 1
      inDegree.set(neighbor, newDegree)
      if (newDegree === 0) queue.push(neighbor)
    }
  }

  if (sorted.length !== dag.nodes.length) {
    const visited = new Set(sorted)
    const cycleNodes = dag.nodes.filter((n) => !visited.has(n.node_id)).map((n) => n.node_id)
    return { valid: false, error: "CYCLE_DETECTED", cycleNodes }
  }

  for (const node of dag.nodes) {
    for (const dep of node.dependencies) {
      if (!nodeIds.has(dep)) return { valid: false, error: `UNKNOWN_DEPENDENCY: node=${node.node_id}, dep=${dep}` }
    }
  }

  return { valid: true, executionOrder: sorted }
}

/** Find all pending nodes whose dependencies are all satisfied */
export function getReadyNodes(dag: DAG): DAGNode[] {
  return dag.nodes.filter((n) => {
    if (n.status !== "pending") return false
    return n.dependencies.every((depId) => {
      const dep = dag.nodes.find((x) => x.node_id === depId)
      return dep && dep.status === "completed"
    })
  })
}

/** Mark a node as failed and cascade-block downstream nodes */
export function markNodeFailed(dag: DAG, nodeId: string): DAG {
  const blockers = new Set<string>()
  for (const [from, to] of dag.edges) {
    if (from === nodeId) blockers.add(to)
  }
  const updatedNodes = dag.nodes.map((n) => {
    if (n.node_id === nodeId) return { ...n, status: "failed" as const }
    if (n.status === "pending" && blockers.has(n.node_id)) return { ...n, status: "blocked" as const }
    return n
  })
  return { ...dag, nodes: updatedNodes }
}

/** BFS traversal: get all transitive dependents of a node */
export function getTransitiveDependents(dag: DAG, nodeId: string): Set<string> {
  const dependents = new Set<string>()
  const queue = [nodeId]
  let head = 0
  while (head < queue.length) {
    const current = queue[head++]!
    for (const [from, to] of dag.edges) {
      if (from === current && !dependents.has(to)) {
        dependents.add(to)
        queue.push(to)
      }
    }
  }
  return dependents
}

/** Estimate total token and time cost of a DAG */
export function estimateDAGCost(dag: DAG): { total_tokens: number; total_duration_ms: number } {
  return dag.nodes.reduce(
    (acc, n) => ({ total_tokens: acc.total_tokens + n.estimated_tokens, total_duration_ms: acc.total_duration_ms + n.estimated_duration_ms }),
    { total_tokens: 0, total_duration_ms: 0 },
  )
}

/**
 * Incremental DAG update: replace a failed subtree while preserving completed nodes.
 * 1. Identify subtree = failedNode + all transitive dependents
 * 2. Remove subtree nodes, keep completed + unaffected pending
 * 3. Insert replacement nodes, rewiring dependencies
 */
export function replaceSubtree(dag: DAG, failedNodeId: string, replacementNodes: DAGNode[]): DAG {
  const subtreeIds = new Set(getTransitiveDependents(dag, failedNodeId))
  subtreeIds.add(failedNodeId)

  const keptNodes = dag.nodes.filter((n) => !subtreeIds.has(n.node_id))
  const keptIds = new Set(keptNodes.map((n) => n.node_id))
  const replacementIds = new Set(replacementNodes.map((n) => n.node_id))
  const validIds = new Set([...keptIds, ...replacementIds])

  for (const replacement of replacementNodes) {
    replacement.dependencies = replacement.dependencies.filter((depId) => validIds.has(depId))
  }

  const newNodes = [...keptNodes, ...replacementNodes]
  const newEdges: [string, string][] = dag.edges.filter(
    ([from, to]) => !subtreeIds.has(from) && !subtreeIds.has(to),
  )
  for (const replacement of replacementNodes) {
    for (const dep of replacement.dependencies) {
      newEdges.push([dep, replacement.node_id])
    }
  }

  return {
    version: dag.version + 1,
    nodes: newNodes,
    edges: newEdges,
    metadata: {
      goal: dag.metadata?.goal ?? "",
      strategy: dag.metadata?.strategy ?? "INCREMENTAL_REPLAN",
      replan_count: (dag.metadata?.replan_count ?? 0) + 1,
      created_at: Date.now(),
    },
  }
}

/** Check if DAG execution is terminally complete */
export function isComplete(dag: DAG): boolean {
  if (dag.nodes.length === 0) return false
  return dag.nodes.every((n) => n.status === "completed" || n.status === "failed" || n.status === "blocked")
}

/** Check if all nodes succeeded (blocked from failure cascade counts as terminal) */
export function allSucceeded(dag: DAG): boolean {
  if (dag.nodes.length === 0) return false
  return dag.nodes.every((n) => n.status === "completed" || n.status === "blocked")
}
