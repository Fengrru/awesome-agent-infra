import { EnhancedTFIDF } from "./tfidf"
import type {
  CodeGraph,
  HybridSearchOptions,
  HybridSearchResult,
} from "./types"

export class HybridSearch {
  private tfidf: EnhancedTFIDF
  private codeGraph: CodeGraph | null

  constructor(tfidf: EnhancedTFIDF, codeGraph?: CodeGraph) {
    this.tfidf = tfidf
    this.codeGraph = codeGraph ?? null
  }

  setCodeGraph(graph: CodeGraph): void {
    this.codeGraph = graph
  }

  async search(options: HybridSearchOptions): Promise<HybridSearchResult[]> {
    const {
      query,
      topK,
      weights = { vector: 0.4, graph: 0.3, text: 0.3 },
      minScore = 0,
    } = options

    const textResults = this.tfidf.search(query, topK * 2)
    const textScoreMap = new Map<string, number>()
    for (const r of textResults) {
      textScoreMap.set(r.docId, r.score)
    }

    const candidateIds = new Set(textResults.map((r) => r.docId))

    const graphScores = new Map<string, number>()
    if (this.codeGraph) {
      for (const docId of candidateIds) {
        try {
          const centrality = this.codeGraph.getNodeCentrality(docId)
          graphScores.set(docId, centrality)
        } catch {
          graphScores.set(docId, 0)
        }
      }

      const searchPromises = [...candidateIds].map(async (docId) => {
        try {
          const neighbors = await this.codeGraph!.searchNeighbors(docId, {
            maxDepth: 2,
            maxNeighbors: 5,
          })
          return { docId, neighbors }
        } catch {
          return { docId, neighbors: [] }
        }
      })
      const neighborResults = await Promise.all(searchPromises)
      for (const { docId, neighbors } of neighborResults) {
        for (const neighbor of neighbors) {
          candidateIds.add(neighbor.id)
          graphScores.set(neighbor.id, Math.max(graphScores.get(neighbor.id) ?? 0, neighbor.score))
        }
      }
    }

    const hybridResults: HybridSearchResult[] = []
    for (const id of candidateIds) {
      const textScore = textScoreMap.get(id) ?? 0
      const graphScore = graphScores.get(id) ?? 0

      const vectorScore = textScore

      const compositeScore =
        weights.vector * vectorScore +
        weights.graph * graphScore +
        weights.text * textScore

      if (compositeScore >= minScore) {
        hybridResults.push({
          id,
          content: "",
          vectorScore,
          graphScore,
          textScore,
          compositeScore,
        })
      }
    }

    hybridResults.sort((a, b) => b.compositeScore - a.compositeScore)
    return hybridResults.slice(0, topK)
  }
}
