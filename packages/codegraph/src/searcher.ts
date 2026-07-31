/**
 * CodeGraph Searcher — k-hop ego-graph retrieval and symbol search
 *
 * @module codegraph/searcher
 */

import { type CodeGraph, flattenSubGraph } from "./graph"
import type { CodeGraphNode, SearchOptions, SearchResult, SubGraph } from "./types"

export class CodeGraphSearcher {
  private graph: CodeGraph

  constructor(graph: CodeGraph) {
    this.graph = graph
  }

  searchSymbols(term: string, options?: SearchOptions): SearchResult[] {
    const maxResults = options?.maxResults ?? 20
    const k = options?.kHop ?? 1
    const q = term.toLowerCase()

    const matches = this.graph.searchSymbols(q)
    const results: SearchResult[] = []

    for (const node of matches) {
      const score = this.computeRelevance(node, q)
      let context: SubGraph | undefined
      if (k > 0) context = this.graph.getEgoGraph(node.id, k)

      results.push({
        node,
        score,
        matchedOn: score >= 1 ? "name" : "full_text",
        context,
      })
    }

    results.sort((a, b) => b.score - a.score)
    return results.slice(0, maxResults)
  }

  searchByType(symbolType: string, options?: SearchOptions): SearchResult[] {
    const maxResults = options?.maxResults ?? 50
    const nodes = this.graph.findNodes((n) => n.type === "symbol" && n.symbolType === symbolType)
    return nodes.slice(0, maxResults).map((node) => ({
      node,
      score: 1,
      matchedOn: "type" as const,
      context: options?.kHop ? this.graph.getEgoGraph(node.id, options.kHop) : undefined,
    }))
  }

  searchByFile(filePath: string, options?: SearchOptions): SearchResult[] {
    const nodes = this.graph.getNodesForFile(filePath)
    return nodes.map((node) => ({
      node,
      score: 1,
      matchedOn: "file" as const,
      context: options?.kHop ? this.graph.getEgoGraph(node.id, options.kHop) : undefined,
    }))
  }

  getEgoGraph(nodeId: string, k = 1): SubGraph {
    return this.graph.getEgoGraph(nodeId, k)
  }

  getFileContext(filePath: string): SubGraph {
    const fileNodes = this.graph.findNodes((n) => n.type === "file" && n.filePath === filePath)
    if (fileNodes.length === 0) {
      return { nodes: [], edges: [], estimatedTokens: 0 }
    }
    return this.graph.getEgoGraph(fileNodes[0]!.id, 1)
  }

  flattenResults(
    results: SearchResult[],
    options?: { includeDocComments?: boolean; includeSourceCode?: boolean },
  ): string {
    if (results.length === 0) return ""

    const sections: string[] = []
    let rank = 1

    for (const r of results) {
      const node = r.node
      sections.push(
        `[${rank}] ${node.name}  [${node.symbolType ?? node.type}]  (${node.filePath}:${node.startLine})  matched: ${r.matchedOn}  score: ${r.score.toFixed(3)}`,
      )

      if (r.context && r.context.nodes.length > 1) {
        const contextText = flattenSubGraph(r.context, options)
        const indented = contextText
          .split("\n")
          .map((l) => `  ${l}`)
          .join("\n")
        sections.push(indented)
      }

      rank++
    }

    return sections.join("\n\n")
  }

  buildCompactSummary(results: SearchResult[], maxTokens = 2000): string {
    const lines: string[] = ["```codegraph"]
    let estimatedTokens = 0

    for (const r of results) {
      const line = `${r.node.name} | ${r.node.symbolType ?? r.node.type} | ${r.node.filePath}:${r.node.startLine} | sim=${r.score.toFixed(2)}`
      const tokenEstimate = Math.ceil(line.length / 4) + 2
      if (estimatedTokens + tokenEstimate > maxTokens) break
      lines.push(line)
      estimatedTokens += tokenEstimate
    }

    lines.push("```")
    return lines.join("\n")
  }

  private computeRelevance(node: CodeGraphNode, query: string): number {
    let score = 0
    const name = node.name.toLowerCase()

    if (name === query) score += 10
    else if (name.startsWith(query)) score += 5
    else if (name.includes(query)) score += 3
    else if (name.split(/[_.\-]/).some((part) => part === query)) score += 4

    const meta = node.metadata as Record<string, unknown>
    if (meta.isExported) score += 1
    if (meta.visibility === "public") score += 0.5

    if (node.symbolType === "class" || node.symbolType === "interface" || node.symbolType === "type") {
      score += 1
    }

    return score
  }
}
