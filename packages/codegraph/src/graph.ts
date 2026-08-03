/**
 * CodeGraph — In-Memory Heterogeneous Code Graph
 *
 * Stores symbols, files, and modules as nodes with typed edges.
 * Fast adjacency lookups, subgraph extraction, serialization for persistence.
 *
 * Extended with bidirectional edge management (auto-generating reverse
 * edges for calls→called_by, overrides→overridden_by) and impact-aware
 * query methods (getCallersOf, getOverriddenBy, getTypeUsersOf, etc.).
 *
 * @module codegraph/graph
 */

import type {
  BuildEvent,
  BuildObserver,
  CodeGraphEdge,
  CodeGraphNode,
  EdgeRelation,
  SubGraph,
  SymbolMetadata,
} from "./types"
import { REVERSE_RELATIONS } from "./types"

const NODE_ID_SEPARATOR = ":"
const EDGE_KEY_SEPARATOR = "->"

function edgeKey(sourceId: string, relation: string, targetId: string): string {
  return `${sourceId}${EDGE_KEY_SEPARATOR}${relation}${EDGE_KEY_SEPARATOR}${targetId}`
}

export class CodeGraph {
  constructor() {}

  private _nodes = new Map<string, CodeGraphNode>()
  private _fileIndex = new Map<string, Set<string>>()
  private _outgoing = new Map<string, Map<EdgeRelation, Set<string>>>()
  private _incoming = new Map<string, Map<EdgeRelation, Set<string>>>()
  private _edges = new Map<string, CodeGraphEdge>()
  private _observers: BuildObserver[] = []
  /** When true, adding an edge also creates the reverse edge automatically */
  private _bidirectional = false

  // ── Configuration ─────────────────────────────────────────────────────

  /** Enable/disable automatic bidirectional edge creation */
  setBidirectional(enabled: boolean): void {
    this._bidirectional = enabled
  }

  get bidirectional(): boolean {
    return this._bidirectional
  }

  // ── Observers ─────────────────────────────────────────────────────────

  addObserver(observer: BuildObserver): void {
    this._observers.push(observer)
  }

  removeObserver(observer: BuildObserver): void {
    const idx = this._observers.indexOf(observer)
    if (idx >= 0) this._observers.splice(idx, 1)
  }

  private notify(event: BuildEvent): void {
    for (const obs of this._observers) {
      try {
        obs(event)
      } catch {
        /* swallow */
      }
    }
  }

  // ── Node Operations ───────────────────────────────────────────────────

  addNode(node: CodeGraphNode): void {
    this._nodes.set(node.id, node)
    if (!this._fileIndex.has(node.filePath)) {
      this._fileIndex.set(node.filePath, new Set())
    }
    this._fileIndex.get(node.filePath)!.add(node.id)
  }

  getNode(nodeId: string): CodeGraphNode | undefined {
    return this._nodes.get(nodeId)
  }

  hasNode(nodeId: string): boolean {
    return this._nodes.has(nodeId)
  }

  removeNode(nodeId: string): void {
    const node = this._nodes.get(nodeId)
    if (!node) return

    const fileNodes = this._fileIndex.get(node.filePath)
    if (fileNodes) {
      fileNodes.delete(nodeId)
      if (fileNodes.size === 0) this._fileIndex.delete(node.filePath)
    }

    const outgoing = this._outgoing.get(nodeId)
    if (outgoing) {
      for (const [rel, targets] of outgoing) {
        for (const targetId of targets) {
          this._edges.delete(edgeKey(nodeId, rel, targetId))
          this.removeFromIncoming(targetId, nodeId)
        }
      }
      this._outgoing.delete(nodeId)
    }

    const incoming = this._incoming.get(nodeId)
    if (incoming) {
      for (const [rel, sources] of incoming) {
        for (const sourceId of sources) {
          this._edges.delete(edgeKey(sourceId, rel, nodeId))
          this.removeFromOutgoing(sourceId, nodeId)
        }
      }
      this._incoming.delete(nodeId)
    }

    this._nodes.delete(nodeId)
  }

  /**
   * Remove all nodes belonging to a file path.
   * Used by incremental updates before re-adding fresh entities.
   * Returns array of removed entity IDs for stale marker tracking.
   */
  removeFileNodes(filePath: string): string[] {
    const removedIds: string[] = []
    const nodeIds = this._fileIndex.get(filePath)
    if (nodeIds) {
      for (const id of Array.from(nodeIds)) {
        this.removeNode(id)
        removedIds.push(id)
      }
    }
    const fileId = `file:${filePath}`
    if (this._nodes.has(fileId)) {
      this.removeNode(fileId)
      removedIds.push(fileId)
    }
    return removedIds
  }

  private removeFromIncoming(targetId: string, sourceId: string): void {
    const incoming = this._incoming.get(targetId)
    if (!incoming) return
    for (const [, sources] of incoming) sources.delete(sourceId)
  }

  private removeFromOutgoing(sourceId: string, targetId: string): void {
    const outgoing = this._outgoing.get(sourceId)
    if (!outgoing) return
    for (const [, targets] of outgoing) targets.delete(targetId)
  }

  // ── Edge Operations ───────────────────────────────────────────────────

  /**
   * Add an edge. When bidirectional mode is enabled, also adds
   * the reverse edge (e.g., calls → called_by, overrides → overridden_by).
   */
  addEdge(edge: CodeGraphEdge): void {
    const key = edgeKey(edge.sourceId, edge.relation, edge.targetId)
    if (this._edges.has(key)) return
    this._edges.set(key, edge)

    if (!this._outgoing.has(edge.sourceId)) {
      this._outgoing.set(edge.sourceId, new Map())
    }
    const outRelMap = this._outgoing.get(edge.sourceId)!
    if (!outRelMap.has(edge.relation)) outRelMap.set(edge.relation, new Set())
    outRelMap.get(edge.relation)!.add(edge.targetId)

    if (!this._incoming.has(edge.targetId)) {
      this._incoming.set(edge.targetId, new Map())
    }
    const inRelMap = this._incoming.get(edge.targetId)!
    if (!inRelMap.has(edge.relation)) inRelMap.set(edge.relation, new Set())
    inRelMap.get(edge.relation)!.add(edge.sourceId)

    if (this._bidirectional) {
      const reverseStr = REVERSE_RELATIONS[edge.relation]
      if (reverseStr) {
        const reverse = reverseStr as EdgeRelation
        const reverseKey = edgeKey(edge.targetId, reverse, edge.sourceId)
        if (!this._edges.has(reverseKey)) {
          const reverseEdge: CodeGraphEdge = {
            sourceId: edge.targetId,
            targetId: edge.sourceId,
            relation: reverse,
            weight: edge.weight,
            sourceLoc: edge.sourceLoc,
          }
          this._edges.set(reverseKey, reverseEdge)
          if (!this._outgoing.has(reverseEdge.sourceId)) {
            this._outgoing.set(reverseEdge.sourceId, new Map())
          }
          const revOut = this._outgoing.get(reverseEdge.sourceId)!
          if (!revOut.has(reverse)) revOut.set(reverse, new Set())
          revOut.get(reverse)!.add(reverseEdge.targetId)
          if (!this._incoming.has(reverseEdge.targetId)) {
            this._incoming.set(reverseEdge.targetId, new Map())
          }
          const revIn = this._incoming.get(reverseEdge.targetId)!
          if (!revIn.has(reverse)) revIn.set(reverse, new Set())
          revIn.get(reverse)!.add(reverseEdge.sourceId)
        }
      }
    }
  }

  getEdges(nodeId?: string, relation?: EdgeRelation): CodeGraphEdge[] {
    if (!nodeId) return Array.from(this._edges.values())

    const result: CodeGraphEdge[] = []
    const outgoing = this._outgoing.get(nodeId)
    if (outgoing) {
      for (const [rel, targets] of outgoing) {
        if (relation && rel !== relation) continue
        for (const targetId of targets) {
          const key = edgeKey(nodeId, rel, targetId)
          const edge = this._edges.get(key)
          if (edge) result.push(edge)
        }
      }
    }
    return result
  }

  // ── Queries ───────────────────────────────────────────────────────────

  findNodes(predicate: (node: CodeGraphNode) => boolean): CodeGraphNode[] {
    const result: CodeGraphNode[] = []
    for (const node of this._nodes.values()) {
      if (predicate(node)) result.push(node)
    }
    return result
  }

  getNodesForFile(filePath: string): CodeGraphNode[] {
    const nodeIds = this._fileIndex.get(filePath)
    if (!nodeIds) return []
    return Array.from(nodeIds)
      .map((id) => this._nodes.get(id))
      .filter((n): n is CodeGraphNode => n !== undefined)
  }

  searchSymbols(query: string): CodeGraphNode[] {
    const q = query.toLowerCase()
    return this.findNodes((n) => n.type === "symbol" && n.name.toLowerCase().includes(q))
  }

  getFiles(): CodeGraphNode[] {
    return this.findNodes((n) => n.type === "file")
  }

  getOutgoing(nodeId: string, relation?: EdgeRelation): CodeGraphNode[] {
    const outRelMap = this._outgoing.get(nodeId)
    if (!outRelMap) return []

    const result: CodeGraphNode[] = []
    for (const [rel, targets] of outRelMap) {
      if (relation && rel !== relation) continue
      for (const targetId of targets) {
        const node = this._nodes.get(targetId)
        if (node) result.push(node)
      }
    }
    return result
  }

  getIncoming(nodeId: string, relation?: EdgeRelation): CodeGraphNode[] {
    const inRelMap = this._incoming.get(nodeId)
    if (!inRelMap) return []

    const result: CodeGraphNode[] = []
    for (const [rel, sources] of inRelMap) {
      if (relation && rel !== relation) continue
      for (const sourceId of sources) {
        const node = this._nodes.get(sourceId)
        if (node) result.push(node)
      }
    }
    return result
  }

  // ── Impact-Aware Query Methods ────────────────────────────────────────

  /**
   * Get all direct callers of a given entity.
   * Uses the "called_by" relation (auto-generated from "calls" edges).
   */
  getCallersOf(entityId: string): CodeGraphNode[] {
    return this.getOutgoing(entityId, "called_by")
  }

  /**
   * Get all direct callees of a given entity.
   * Uses the "calls" relation.
   */
  getCalleesOf(entityId: string): CodeGraphNode[] {
    return this.getOutgoing(entityId, "calls")
  }

  /**
   * Get entities that override this method.
   * Uses "overridden_by" relation (auto-generated from "overrides").
   */
  getOverriddenBy(entityId: string): CodeGraphNode[] {
    return this.getOutgoing(entityId, "overridden_by")
  }

  /**
   * Get parent entities that this entity overrides.
   */
  getOverrides(entityId: string): CodeGraphNode[] {
    return this.getOutgoing(entityId, "overrides")
  }

  /**
   * Get callers at a given depth (transitive).
   * depth=1 returns direct callers, depth=2 returns callers of callers, etc.
   */
  getTransitiveCallers(entityId: string, maxDepth = 3): Map<number, CodeGraphNode[]> {
    const result = new Map<number, CodeGraphNode[]>()
    const visited = new Set<string>([entityId])
    const frontier = [entityId]

    for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
      const nextFrontier: string[] = []
      const callersAtDepth: CodeGraphNode[] = []

      for (const currentId of frontier) {
        for (const caller of this.getCallersOf(currentId)) {
          if (!visited.has(caller.id)) {
            visited.add(caller.id)
            callersAtDepth.push(caller)
            nextFrontier.push(caller.id)
          }
        }
      }

      if (callersAtDepth.length > 0) {
        result.set(depth, callersAtDepth)
      }
      frontier.length = 0
      frontier.push(...nextFrontier)
    }

    return result
  }

  /**
   * Get all affected files for an entity, considering direct and
   * transitive callers.
   */
  getAffectedFiles(entityId: string, maxDepth = 3): string[] {
    const files = new Set<string>()
    const entity = this._nodes.get(entityId)
    if (entity) files.add(entity.filePath)

    for (const [, callers] of this.getTransitiveCallers(entityId, maxDepth)) {
      for (const caller of callers) {
        files.add(caller.filePath)
      }
    }

    return Array.from(files)
  }

  /**
   * Find symbol entities by name and kind within a file.
   * Used for entity resolution during impact analysis.
   */
  findEntity(name: string, kind: string, filePath?: string): CodeGraphNode | undefined {
    const candidates = this.findNodes((n) => {
      if (n.type !== "symbol") return false
      if (n.name !== name) return false
      if (kind && n.symbolType !== kind) return false
      if (filePath && n.filePath !== filePath) return false
      return true
    })
    return candidates[0]
  }

  /**
   * Get entities that use a given type (class/interface/enum).
   */
  getTypeUsersOf(entityId: string): CodeGraphNode[] {
    return this.getOutgoing(entityId, "type_uses")
  }

  /**
   * Get data flow consumers for a variable entity.
   */
  getDataFlowConsumers(entityId: string): CodeGraphNode[] {
    return this.getOutgoing(entityId, "data_flow")
  }

  /**
   * Get test entities that cover a given entity.
   * Edges are created as test → covered (see builder), so look at incoming.
   */
  getTestsFor(entityId: string): CodeGraphNode[] {
    return this.getIncoming(entityId, "test_covers")
  }

  /** K-hop ego subgraph extraction via BFS */
  getEgoGraph(centerId: string, k = 1): SubGraph {
    const visited = new Set<string>()
    const nodes: CodeGraphNode[] = []
    const edges: CodeGraphEdge[] = []
    const edgeKeys = new Set<string>()

    const center = this._nodes.get(centerId)
    if (!center) return { nodes, edges, estimatedTokens: 0 }

    visited.add(centerId)
    nodes.push(center)

    let frontier = [centerId]
    for (let hop = 0; hop < k && frontier.length > 0; hop++) {
      const nextFrontier: string[] = []

      for (const nodeId of frontier) {
        const outRelMap = this._outgoing.get(nodeId)
        if (outRelMap) {
          for (const [rel, targets] of outRelMap) {
            for (const targetId of targets) {
              const ek = edgeKey(nodeId, rel, targetId)
              if (!edgeKeys.has(ek)) {
                edgeKeys.add(ek)
                const edge = this._edges.get(ek)
                if (edge) edges.push(edge)
              }
              if (!visited.has(targetId)) {
                visited.add(targetId)
                const targetNode = this._nodes.get(targetId)
                if (targetNode) {
                  nodes.push(targetNode)
                  nextFrontier.push(targetId)
                }
              }
            }
          }
        }

        const inRelMap = this._incoming.get(nodeId)
        if (inRelMap) {
          for (const [rel, sources] of inRelMap) {
            for (const sourceId of sources) {
              const ek = edgeKey(sourceId, rel, nodeId)
              if (!edgeKeys.has(ek)) {
                edgeKeys.add(ek)
                const edge = this._edges.get(ek)
                if (edge) edges.push(edge)
              }
              if (!visited.has(sourceId)) {
                visited.add(sourceId)
                const sourceNode = this._nodes.get(sourceId)
                if (sourceNode) {
                  nodes.push(sourceNode)
                  nextFrontier.push(sourceId)
                }
              }
            }
          }
        }
      }

      frontier = nextFrontier
    }

    return { nodes, edges, centerId, estimatedTokens: estimateTokens(nodes, edges) }
  }

  // ── Stats ─────────────────────────────────────────────────────────────

  get nodeCount(): number {
    return this._nodes.size
  }
  get edgeCount(): number {
    return this._edges.size
  }
  get fileCount(): number {
    return this._fileIndex.size
  }

  getStats(): { nodes: number; edges: number; files: number; symbols: number } {
    return {
      nodes: this._nodes.size,
      edges: this._edges.size,
      files: this._fileIndex.size,
      symbols: this.findNodes((n) => n.type === "symbol").length,
    }
  }

  // ── Serialization ────────────────────────────────────────────────────

  toJSON(): { nodes: CodeGraphNode[]; edges: CodeGraphEdge[] } {
    return {
      nodes: Array.from(this._nodes.values()),
      edges: Array.from(this._edges.values()),
    }
  }

  fromJSON(data: { nodes: CodeGraphNode[]; edges: CodeGraphEdge[] }): void {
    this.clear()
    const prevBidirectional = this._bidirectional
    this._bidirectional = false
    for (const node of data.nodes) this.addNode(node)
    for (const edge of data.edges) this.addEdge(edge)
    this._bidirectional = prevBidirectional
  }

  clear(): void {
    this._nodes.clear()
    this._fileIndex.clear()
    this._outgoing.clear()
    this._incoming.clear()
    this._edges.clear()
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function estimateTokens(nodes: CodeGraphNode[], edges: CodeGraphEdge[]): number {
  let tokens = 0
  for (const node of nodes) {
    tokens += 5
    tokens += node.name.length / 4
    if (node.type === "symbol") {
      const meta = node.metadata as SymbolMetadata
      if (meta.returnType) tokens += 2
      if (meta.parameters) tokens += meta.parameters.length * 3
      if (meta.docComment) tokens += meta.docComment.length / 4
    }
  }
  tokens += edges.length * 2
  return Math.ceil(tokens)
}

export function flattenSubGraph(
  sg: SubGraph,
  options?: { includeDocComments?: boolean; includeSourceCode?: boolean },
): string {
  const lines: string[] = []
  const edgesByNode = new Map<string, CodeGraphEdge[]>()
  for (const edge of sg.edges) {
    if (!edgesByNode.has(edge.sourceId)) edgesByNode.set(edge.sourceId, [])
    edgesByNode.get(edge.sourceId)!.push(edge)
  }

  for (const node of sg.nodes) {
    switch (node.type) {
      case "file":
        lines.push(`[File] ${node.name}`)
        break
      case "module":
        lines.push(`[Module] ${node.name}`)
        break
      case "symbol": {
        const meta = node.metadata as SymbolMetadata
        const symType = node.symbolType ?? "unknown"
        const params = meta.parameters
          ? `(${meta.parameters.map((p) => `${p.name}: ${p.type}${p.optional ? "?" : ""}`).join(", ")})`
          : "()"
        const ret = meta.returnType ? `: ${meta.returnType}` : ""
        const prefix = meta.visibility ? `${meta.visibility} ` : ""
        const exportStr = meta.isExported ? "export " : ""
        lines.push(
          `[${symType}] ${exportStr}${prefix}${meta.isStatic ? "static " : ""}${meta.isAsync ? "async " : ""}${node.name}${params}${ret}  (${node.filePath}:${node.startLine})`,
        )
        if (options?.includeDocComments && meta.docComment) {
          lines.push(`  /* ${meta.docComment} */`)
        }
        break
      }
    }

    const edges = edgesByNode.get(node.id)
    if (edges) {
      for (const edge of edges) {
        lines.push(`  └─ ${edge.relation} -> ${shortId(edge.targetId)}`)
      }
    }
  }

  return lines.join("\n")
}

function shortId(id: string): string {
  const parts = id.split(NODE_ID_SEPARATOR)
  return parts.length >= 2 ? parts.slice(1).join(NODE_ID_SEPARATOR) : id
}

export function buildRepoSummary(graph: CodeGraph): string {
  const stats = graph.getStats()
  const lines: string[] = [
    "# CodeGraph Repository Summary",
    "",
    `- Total nodes: ${stats.nodes}`,
    `  - Files: ${stats.files}`,
    `  - Symbols: ${stats.symbols}`,
    `- Total edges: ${stats.edges}`,
    "",
    "## High-Value Files (most connected)",
    "",
  ]

  const fileScores: Array<{ path: string; score: number }> = []
  for (const file of graph.getFiles()) {
    fileScores.push({ path: file.filePath, score: graph.getEdges(file.id).length })
  }
  fileScores.sort((a, b) => b.score - a.score)

  for (const f of fileScores.slice(0, 15)) {
    lines.push(`- ${f.path} (connections: ${f.score})`)
  }

  return lines.join("\n")
}
