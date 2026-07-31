/**
 * Retrieval — meta-memory awareness and attention-based retrieval.
 * @module memory-engine-v2/retrieval
 */

import { computeIDF, computeTFIDFVector, cosineSimilarity, tokenize } from "./tfidf"
import type {
  AttentionConfig,
  AttentionWeight,
  MemoryAwareness,
  MemoryDecision,
  MemoryItem,
  MetaMemoryConfig,
} from "./types"
import { ConfidenceLevel, clamp } from "./types"

// ═══════════════════════════════════════════════════════════════════════════
// MetaMemory
// ═══════════════════════════════════════════════════════════════════════════

export class MetaMemory {
  config: MetaMemoryConfig
  private resultHistory: boolean[] = []
  private maxHistorySize = 100

  constructor(config?: Partial<MetaMemoryConfig>) {
    this.config = {
      highConfidenceThreshold: 0.8,
      mediumConfidenceThreshold: 0.5,
      lowConfidenceThreshold: 0.3,
      enableMonitoring: true,
      enableAdaptation: true,
      ...config,
    }
  }

  estimateConfidence(query: string, stats: Record<string, unknown>): number {
    const memoryAvailability = this.estimateCoverage(query, stats)
    const recentSuccess = this.getRecentSuccessRate()
    const freshness = clamp((stats.freshnessScore as number) ?? 0.5, 0, 1)
    const coverage = this.estimateCoverage(query, stats)
    const complexity = this.estimateQueryComplexity(query)
    const base = 0.5
    let confidence =
      base + 0.2 * memoryAvailability + 0.25 * recentSuccess + 0.15 * freshness + 0.2 * coverage - 0.2 * complexity
    if (this.isComputationQuery(query)) {
      confidence *= 0.2
    }
    return clamp(confidence, 0, 1)
  }

  makeDecision(query: string, confidence: number, availableActions: string[]): MemoryDecision {
    const level = this.getConfidenceLevel(confidence)
    const actions: Record<
      ConfidenceLevel,
      "direct_recall" | "augmented_retrieval" | "external_tool" | "model_collaboration"
    > = {
      [ConfidenceLevel.HIGH]: "direct_recall",
      [ConfidenceLevel.MEDIUM]: "augmented_retrieval",
      [ConfidenceLevel.LOW]: "external_tool",
      [ConfidenceLevel.VERY_LOW]: "model_collaboration",
    }
    const action = actions[level]
    const costMap: Record<string, number> = {
      direct_recall: 0.01,
      augmented_retrieval: 0.05,
      external_tool: 0.1,
      model_collaboration: 0.2,
    }
    return {
      action,
      confidence,
      source: "MetaMemory",
      reasoning: `Confidence level: ${level}, estimated complexity: ${this.estimateQueryComplexity(query).toFixed(2)}`,
      estimatedCost: costMap[action]!,
      metadata: { availableActions },
    }
  }

  recordResult(success: boolean): void {
    this.resultHistory.push(success)
    if (this.resultHistory.length > this.maxHistorySize) {
      this.resultHistory.shift()
    }
  }

  private getRecentSuccessRate(window = 20): number {
    if (this.resultHistory.length === 0 && this.config.enableAdaptation) {
      return 0.5
    }
    const recent = this.resultHistory.slice(-Math.min(window, this.resultHistory.length))
    if (recent.length === 0) return 0.5
    return recent.filter(Boolean).length / recent.length
  }

  private getConfidenceLevel(confidence: number): ConfidenceLevel {
    if (confidence >= this.config.highConfidenceThreshold) return ConfidenceLevel.HIGH
    if (confidence >= this.config.mediumConfidenceThreshold) return ConfidenceLevel.MEDIUM
    if (confidence >= this.config.lowConfidenceThreshold) return ConfidenceLevel.LOW
    return ConfidenceLevel.VERY_LOW
  }

  private estimateQueryComplexity(query: string): number {
    const hasMath = /[\d]+\s*[+\-*/]\s*[\d]+/.test(query)
    const hasLogic = /\b(solve|compute|calculate|if|then|else|and|or|not)\b/i.test(query)
    const wordCount = query.split(/\s+/).filter(Boolean).length
    let complexity = clamp(wordCount / 30, 0, 1)
    if (hasMath) complexity = Math.min(1, complexity + 0.4)
    if (hasLogic) complexity = Math.min(1, complexity + 0.3)
    return complexity
  }

  private estimateCoverage(query: string, stats: Record<string, unknown>): number {
    const totalMemories = (stats.totalMemories as number) ?? 0
    if (totalMemories === 0) return 0
    const memoryAvailability = Math.min(totalMemories / 50, 1)
    const queryTokens = tokenize(query)
    const uniqueTokens = new Set(queryTokens)
    if (uniqueTokens.size === 0) return memoryAvailability * 0.5
    const statsStr = JSON.stringify(stats).toLowerCase()
    let matchCount = 0
    for (const token of uniqueTokens) {
      if (statsStr.includes(token.toLowerCase())) matchCount++
    }
    const tokenCoverage = matchCount / uniqueTokens.size
    return 0.6 * memoryAvailability + 0.4 * tokenCoverage
  }

  private isComputationQuery(query: string): boolean {
    return /[\d]+\s*[+\-*/^]\s*[\d]+/.test(query) || /\b(solve|compute|calculate)\b/i.test(query)
  }

  getAwareness(stats: Record<string, unknown>): MemoryAwareness {
    const totalMemories = (stats.totalMemories as number) ?? 0
    const distribution = (stats.memoryDistribution as Record<string, number>) ?? {}
    const avgImportance = (stats.averageImportance as number) ?? 0
    const successRate = this.getRecentSuccessRate()
    const consolidationNeeded =
      totalMemories > 100 ||
      (((stats.lastConsolidation as number) ?? 0) > 0 && Date.now() - (stats.lastConsolidation as number) > 3600000)
    const forgettingRate =
      this.resultHistory.length > 0 ? 1 - this.resultHistory.filter(Boolean).length / this.resultHistory.length : 0
    const confidence = clamp(0.3 + 0.3 * Math.min(totalMemories / 100, 1) + 0.4 * successRate, 0, 1)
    return {
      totalMemories,
      memoryDistribution: distribution,
      averageImportance: avgImportance,
      retrievalSuccessRate: successRate,
      consolidationNeeded,
      forgettingRate,
      confidenceLevel: this.getConfidenceLevel(confidence),
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// AttentionRetrieval
// ═══════════════════════════════════════════════════════════════════════════

function tfidfSimilarity(query: string, content: string): number {
  const tokensA = tokenize(query)
  const tokensB = tokenize(content)
  if (tokensA.length === 0 || tokensB.length === 0) return 0
  const docs = [tokensA, tokensB]
  const idf = computeIDF(docs)
  const vecA = computeTFIDFVector(tokensA, idf)
  const vecB = computeTFIDFVector(tokensB, idf)
  return cosineSimilarity(vecA, vecB)
}

export class AttentionRetrieval {
  config: AttentionConfig

  constructor(config?: Partial<AttentionConfig>) {
    this.config = {
      importanceWeight: 0.3,
      recencyWeight: 0.2,
      relevanceWeight: 0.4,
      emotionWeight: 0.1,
      recencyDecayHours: 24,
      minAttentionThreshold: 0.1,
      ...config,
    }
  }

  retrieve(query: string, candidates: MemoryItem[], topK = 10): [MemoryItem, AttentionWeight][] {
    const results: [MemoryItem, AttentionWeight][] = []
    for (const item of candidates) {
      const weight = this.calcAttentionWeight(query, item)
      if (weight.total >= this.config.minAttentionThreshold) {
        results.push([{ ...item }, weight])
      }
    }
    results.sort((a, b) => b[1].total - a[1].total)
    return results.slice(0, topK)
  }

  private calcAttentionWeight(query: string, item: MemoryItem): AttentionWeight {
    const importance = item.importance * this.config.importanceWeight
    const recency = this.computeRecency(item.lastAccessed) * this.config.recencyWeight
    const relevance = this.computeRelevance(query, item) * this.config.relevanceWeight
    const emotion = Math.abs(item.emotionScore) * this.config.emotionWeight
    const total = importance + recency + relevance + emotion
    return {
      importance: item.importance,
      recency: this.computeRecency(item.lastAccessed),
      relevance: this.computeRelevance(query, item),
      emotion: Math.abs(item.emotionScore),
      total,
    }
  }

  private computeRelevance(query: string, item: MemoryItem): number {
    if (!query.trim()) return 0
    return tfidfSimilarity(query, String(item.content))
  }

  private computeRecency(timestamp: number): number {
    const ageHours = Math.max((Date.now() - timestamp) / (1000 * 60 * 60), 0)
    return 1 / (1 + ageHours / this.config.recencyDecayHours)
  }

  getStatistics(): Record<string, unknown> {
    return {
      importanceWeight: this.config.importanceWeight,
      recencyWeight: this.config.recencyWeight,
      relevanceWeight: this.config.relevanceWeight,
      emotionWeight: this.config.emotionWeight,
      recencyDecayHours: this.config.recencyDecayHours,
      minAttentionThreshold: this.config.minAttentionThreshold,
    }
  }
}
