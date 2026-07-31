/**
 * CodeGraph Ranker — PageRank + Centrality
 *
 * @module codegraph/ranker
 */

import type { CodeGraph } from "./graph"
import type { CodeGraphNode, RankedNode, RankingConfig } from "./types"
import { DEFAULT_RANKING_CONFIG } from "./types"

export class CodeGraphRanker {
  private graph: CodeGraph
  private config: RankingConfig

  constructor(graph: CodeGraph, config?: Partial<RankingConfig>) {
    this.graph = graph
    this.config = { ...DEFAULT_RANKING_CONFIG, ...config }
  }

  rankAll(): RankedNode[] {
    const allNodes = this.graph.findNodes(() => true)
    if (allNodes.length === 0) return []

    const nodeIds = allNodes.map((n) => n.id)
    const idToIndex = new Map(nodeIds.map((id, i) => [id, i]))
    const n = nodeIds.length

    const outDegree: number[] = new Array(n).fill(0)
    const inLinks: number[][] = new Array(n).fill(null).map(() => [])

    for (const node of allNodes) {
      const edges = this.graph.getEdges(node.id)
      const outEdges = edges.filter((e) => e.sourceId === node.id)
      outDegree[idToIndex.get(node.id)!] = outEdges.length

      for (const edge of outEdges) {
        const targetIdx = idToIndex.get(edge.targetId)
        if (targetIdx !== undefined) {
          inLinks[targetIdx]!.push(idToIndex.get(node.id)!)
        }
      }
    }

    const danglingNodes: number[] = []
    for (let i = 0; i < n; i++) {
      if (outDegree[i] === 0) danglingNodes.push(i)
    }

    const damping = this.config.dampingFactor ?? 0.85
    const maxIter = this.config.maxIterations ?? 100
    const threshold = this.config.convergenceThreshold ?? 0.0001

    let rank = new Array(n).fill(1 / n)
    const teleport = (1 - damping) / n

    for (let iter = 0; iter < maxIter; iter++) {
      const newRank = new Array(n).fill(0)
      let danglingSum = 0

      for (const d of danglingNodes) danglingSum += rank[d]!
      const danglingContribution = (damping * danglingSum) / n

      for (let i = 0; i < n; i++) {
        newRank[i] = teleport + danglingContribution

        for (const j of inLinks[i]!) {
          newRank[i]! += (damping * rank[j]!) / outDegree[j]!
        }
      }

      let diff = 0
      for (let i = 0; i < n; i++) {
        diff += Math.abs(newRank[i]! - rank[i]!)
      }
      rank = newRank

      if (diff < threshold) break
    }

    const maxRank = Math.max(...rank)
    const results: RankedNode[] = allNodes.map((node, i) => ({
      node,
      pageRank: rank[i]!,
      centrality: this.computeDegreeCentrality(node),
      compositeScore: (rank[i]! / maxRank) * 0.7 + this.computeDegreeCentrality(node) * 0.3,
    }))

    results.sort((a, b) => b.compositeScore - a.compositeScore)
    return results
  }

  getTopFiles(n = 10): RankedNode[] {
    return this.rankAll()
      .filter((r) => r.node.type === "file")
      .slice(0, n)
  }

  getTopSymbols(n = 20): RankedNode[] {
    return this.rankAll()
      .filter((r) => r.node.type === "symbol")
      .slice(0, n)
  }

  buildRankingReport(topN = 15): string {
    const ranked = this.rankAll()
    const lines: string[] = [
      "## CodeGraph Ranking Report",
      "",
      `Total nodes ranked: ${ranked.length}`,
      "",
      "### Top Files (by PageRank + Centrality)",
      "",
    ]

    let rank = 1
    for (const r of ranked) {
      if (r.node.type !== "file") continue
      if (rank > topN) break
      lines.push(
        `${rank}. ${r.node.name}  (pr=${r.pageRank.toExponential(2)}, ` +
          `cent=${r.centrality.toFixed(3)}, score=${r.compositeScore.toFixed(3)})`,
      )
      rank++
    }

    lines.push("", "### Top Symbols (by PageRank + Centrality)", "")
    rank = 1
    for (const r of ranked) {
      if (r.node.type !== "symbol") continue
      if (rank > topN) break
      lines.push(
        `${rank}. ${r.node.name}  [${r.node.symbolType}]  (pr=${r.pageRank.toExponential(2)}, ` +
          `score=${r.compositeScore.toFixed(3)})`,
      )
      rank++
    }

    return lines.join("\n")
  }

  private computeDegreeCentrality(node: CodeGraphNode): number {
    const edges = this.graph.getEdges(node.id)
    const totalDegree = edges.length
    const totalNodes = this.graph.nodeCount
    if (totalNodes <= 1) return 0
    return totalDegree / (totalNodes - 1)
  }
}
