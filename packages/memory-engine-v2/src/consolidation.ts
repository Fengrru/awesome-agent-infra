/**
 * SleepConsolidation — memory consolidation via simulated sleep stages.
 * @module memory-engine-v2/consolidation
 */

import { computeIDF, computeTFIDFVector, cosineSimilarity, tokenize } from "./tfidf"
import type { ConsolidationResult, MemoryItem, SleepConfig } from "./types"
import { MemoryType, SleepStage, generateId } from "./types"

export class SleepConsolidation {
  config: SleepConfig
  currentStage: SleepStage

  constructor(config?: Partial<SleepConfig>) {
    this.config = {
      consolidationThreshold: 0.4,
      forgettingThreshold: 0.2,
      replayImportanceBoost: 0.15,
      maxConsolidationCycles: 100,
      autoConsolidateInterval: 100,
      enableReplay: true,
      enableForgetting: true,
      enableAssociation: true,
      ...config,
    }
    this.currentStage = SleepStage.AWAKE
  }

  consolidate(
    workingItems: MemoryItem[],
    shortTermItems: MemoryItem[],
    longTermStore: (item: MemoryItem) => void,
    forget: (id: string) => void,
    update: (id: string, updates: Partial<MemoryItem>) => void,
  ): ConsolidationResult {
    const startTime = Date.now()
    const stageStats: Record<string, number> = {}
    let memoriesConsolidated = 0
    let memoriesForgotten = 0
    let memoriesTransferred = 0

    const allItems = [...workingItems, ...shortTermItems]

    this.currentStage = SleepStage.N3_SLOW_WAVE
    const transferred = this.slowWaveConsolidation(allItems, longTermStore)
    memoriesTransferred += transferred
    stageStats[SleepStage.N3_SLOW_WAVE] = transferred

    this.currentStage = SleepStage.REM
    const replayed = this.memoryReplay(allItems, update)
    memoriesConsolidated += replayed
    stageStats[SleepStage.REM] = replayed

    this.currentStage = SleepStage.CONSOLIDATION
    const associated = this.createAssociations(allItems, longTermStore)
    memoriesConsolidated += associated
    stageStats[SleepStage.CONSOLIDATION] = associated

    this.currentStage = SleepStage.N1_LIGHT_SLEEP
    const forgotten = this.forgetWeakMemories(allItems, forget)
    memoriesForgotten += forgotten
    stageStats[SleepStage.N1_LIGHT_SLEEP] = forgotten

    this.currentStage = SleepStage.AWAKE
    const durationMs = Date.now() - startTime

    return {
      memoriesProcessed: allItems.length,
      memoriesConsolidated,
      memoriesForgotten,
      memoriesTransferred,
      durationMs,
      stageStats,
    }
  }

  private slowWaveConsolidation(items: MemoryItem[], store: (item: MemoryItem) => void): number {
    let count = 0
    const sorted = [...items].sort((a, b) => this.calcConsolidationScore(b) - this.calcConsolidationScore(a))
    for (let i = 0; i < Math.min(sorted.length, this.config.maxConsolidationCycles); i++) {
      const item = sorted[i]!
      if (this.calcConsolidationScore(item) >= this.config.consolidationThreshold) {
        store({
          ...item,
          memoryType: MemoryType.LONG_TERM,
          timestamp: Date.now(),
        })
        count++
      }
    }
    return count
  }

  private memoryReplay(items: MemoryItem[], update: (id: string, updates: Partial<MemoryItem>) => void): number {
    if (!this.config.enableReplay) return 0
    let count = 0
    for (const item of items) {
      const replayProb = Math.max(0.3, item.importance)
      if (Math.random() < replayProb) {
        const newImportance = Math.min(1, item.importance + this.config.replayImportanceBoost)
        update(item.id, { importance: newImportance, confidence: Math.min(1, item.confidence + 0.05) })
        count++
      }
    }
    return count
  }

  private createAssociations(items: MemoryItem[], store: (item: MemoryItem) => void): number {
    if (!this.config.enableAssociation) return 0
    let count = 0
    for (let i = 0; i < items.length && count < this.config.maxConsolidationCycles; i++) {
      for (let j = i + 1; j < items.length && count < this.config.maxConsolidationCycles; j++) {
        const similarity = this.calcSimilarity(items[i]!, items[j]!)
        if (similarity > 0.6) {
          store({
            id: generateId(),
            content: {
              association: true,
              sourceId: items[i]!.id,
              targetId: items[j]!.id,
              similarity,
            },
            memoryType: MemoryType.SEMANTIC,
            timestamp: Date.now(),
            importance: (items[i]!.importance + items[j]!.importance) / 2,
            accessCount: 0,
            lastAccessed: Date.now(),
            metadata: {
              associationSource: items[i]!.id,
              associationTarget: items[j]!.id,
              similarity,
            },
            emotionScore: (items[i]!.emotionScore + items[j]!.emotionScore) / 2,
            confidence: Math.min(items[i]!.confidence, items[j]!.confidence),
          })
          count++
        }
      }
    }
    return count
  }

  private forgetWeakMemories(items: MemoryItem[], forget: (id: string) => void): number {
    if (!this.config.enableForgetting) return 0
    let count = 0
    for (const item of items) {
      if (this.calcRetentionScore(item) < this.config.forgettingThreshold) {
        forget(item.id)
        count++
      }
    }
    return count
  }

  private calcConsolidationScore(item: MemoryItem): number {
    const ageHours = Math.max((Date.now() - item.timestamp) / (1000 * 60 * 60), 0.001)
    const ageDays = ageHours / 24
    const accessFreq = Math.min(item.accessCount / Math.max(ageDays, 0.001), 1)
    const recency = 1 / (1 + ageHours / 24)
    return (
      0.4 * item.importance +
      0.25 * accessFreq +
      0.15 * Math.abs(item.emotionScore) +
      0.1 * recency +
      0.1 * item.confidence
    )
  }

  private calcRetentionScore(item: MemoryItem): number {
    const accessHistory = Math.min(item.accessCount / 10, 1)
    return 0.5 * item.importance + 0.3 * accessHistory + 0.2 * Math.abs(item.emotionScore)
  }

  private calcSimilarity(a: MemoryItem, b: MemoryItem): number {
    const tokensA = tokenize(String(a.content))
    const tokensB = tokenize(String(b.content))
    const allTokens = new Set([...tokensA, ...tokensB])
    if (allTokens.size === 0) return 0
    const docs = [tokensA, tokensB]
    const idf = computeIDF(docs)
    const vecA = computeTFIDFVector(tokensA, idf)
    const vecB = computeTFIDFVector(tokensB, idf)
    return cosineSimilarity(vecA, vecB)
  }

  shouldConsolidate(lastConsolidation: number | null, memoryCount: number): boolean {
    if (memoryCount < this.config.autoConsolidateInterval) return false
    if (lastConsolidation === null) return true
    const timeSinceLast = Date.now() - lastConsolidation
    const minIntervalMs = 60 * 1000
    return timeSinceLast >= minIntervalMs
  }

  getStatistics(): Record<string, unknown> {
    return {
      currentStage: this.currentStage,
      consolidationThreshold: this.config.consolidationThreshold,
      forgettingThreshold: this.config.forgettingThreshold,
      enableReplay: this.config.enableReplay,
      enableForgetting: this.config.enableForgetting,
      enableAssociation: this.config.enableAssociation,
    }
  }
}
