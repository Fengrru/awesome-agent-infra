/**
 * CodeGraph — In-Memory Heterogeneous Code Graph
 *
 * Stores symbols, files, and modules as nodes with typed edges.
 * Fast adjacency lookups, subgraph extraction, serialization for persistence.
 *
 * @module codegraph/graph
 */

import type {
  CodeGraphNode,
  CodeGraphEdge,
  EdgeRelation,
  SubGraph,
  SymbolMetadata,
  BuildEvent,
  BuildObserver,
} from "./types"

const NODE_ID_SEPARATOR = ":"
const EDGE_KEY_SEPARATOR = "->"

function edgeKey(sourceId: string, relation: string, targetId: string): string {
  return `${sourceId}${EDGE_KEY_SEPARATOR}${relation}${EDGE_KEY_SEPARATOR}${targetId}`
}

export class CodeGraph {
  private _nodes = new Map<string, CodeGraphNode>()
  private _fileIndex = new Map<string, Set<string>>()
  private _outgoing = new Map<string, Map<EdgeRelation, Set<string>>>()
  private _incoming = new Map<string, Map<EdgeRelation, Set<string>>>()
  private _edges = new Map<string, CodeGraphEdge>()
  private _observers: BuildObserver[] = []

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
      try { obs(event) } catch { /* swallow */ }
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
    return this.findNodes(
      (n) => n.type === "symbol" && n.name.toLowerCase().includes(q),
    )
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

  /** K-hop ego subgraph extraction via BFS */
  getEgoGraph(centerId: string, k: number = 1): SubGraph {
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

  get nodeCount(): number { return this._nodes.size }
  get edgeCount(): number { return this._edges.size }
  get fileCount(): number { return this._fileIndex.size }

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
    for (const node of data.nodes) this.addNode(node)
    for (const edge of data.edges) this.addEdge(edge)
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
