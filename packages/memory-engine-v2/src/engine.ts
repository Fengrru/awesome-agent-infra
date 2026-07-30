/**
 * MemoryEngine — unified memory orchestration engine.
 * @module memory-engine-v2/engine
 */

import type { MemoryItem, MemoryConfig, SleepConfig, MetaMemoryConfig, AttentionConfig, ConsolidationResult } from "./types"
import { MemoryType, DEFAULT_MEMORY_CONFIG, clamp, createMemoryItem } from "./types"
import { WorkingMemory, ShortTermMemory, LongTermMemory, EpisodicMemory, SemanticMemory } from "./stores"
import { SleepConsolidation } from "./consolidation"
import { MetaMemory, AttentionRetrieval } from "./retrieval"

export class MemoryEngine {
  workingMemory: WorkingMemory
  shortTermMemory: ShortTermMemory
  longTermMemory: LongTermMemory
  episodicMemory: EpisodicMemory
  semanticMemory: SemanticMemory | null
  sleepConsolidation: SleepConsolidation
  metaMemory: MetaMemory
  attentionRetrieval: AttentionRetrieval
  stmTransferThreshold = 0.6
  ltmConsolidationThreshold = 3
  private lastConsolidation: number | null = null

  constructor(
    config?: Partial<{
      memory: MemoryConfig
      sleep: SleepConfig
      meta: MetaMemoryConfig
      attention: AttentionConfig
    }>,
  ) {
    const memCfg = config?.memory ?? DEFAULT_MEMORY_CONFIG
    this.workingMemory = new WorkingMemory(memCfg.workingMemoryCapacity)
    this.shortTermMemory = new ShortTermMemory(memCfg.shortTermMemoryCapacity, memCfg.shortTermMemoryDurationMs)
    this.longTermMemory = new LongTermMemory()
    this.episodicMemory = new EpisodicMemory()
    this.semanticMemory = memCfg.enableSemanticMemory ? new SemanticMemory() : null
    this.sleepConsolidation = new SleepConsolidation(config?.sleep)
    this.metaMemory = new MetaMemory(config?.meta)
    this.attentionRetrieval = new AttentionRetrieval(config?.attention)
  }

  addMemory(
    content: unknown,
    memoryType?: MemoryType,
    importance = 0.5,
    metadata?: Record<string, unknown>,
    emotionScore?: number,
    confidence?: number,
  ): MemoryItem {
    const scoredImportance = importance === 0.5 ? this.autoScoreImportance(content) : importance
    const type = memoryType ?? this.determineMemoryType(content, scoredImportance)

    const item = createMemoryItem(content, type, {
      importance: scoredImportance,
      metadata,
      emotionScore,
      confidence,
    })

    if (type === MemoryType.WORKING && this.workingMemory.isFull()) {
      this.evictFromWorkingMemory()
    }

    this.storeByType(item)

    return item
  }

  recall(query: string, topK = 10, layers?: MemoryType[]): [MemoryItem, number][] {
    const searchLayers = layers ?? [
      MemoryType.WORKING,
      MemoryType.SHORT_TERM,
      MemoryType.LONG_TERM,
      MemoryType.EPISODIC,
      MemoryType.SEMANTIC,
    ]
    const seen = new Set<string>()
    const results: [MemoryItem, number][] = []

    for (const layer of searchLayers) {
      const layerResults = this.searchLayer(layer, query, topK * 2)
      for (const [item, score] of layerResults) {
        if (!seen.has(item.id)) {
          seen.add(item.id)
          results.push([item, score])
        }
      }
    }

    results.sort((a, b) => b[1] - a[1])
    const top = results.slice(0, topK)

    for (const [item] of top) {
      this.metaMemory.recordResult(true)
    }

    return top
  }

  forget(id: string): boolean {
    let forgotten = false
    for (const layer of [
      this.workingMemory,
      this.shortTermMemory,
      this.longTermMemory,
      this.episodicMemory,
    ]) {
      if (layer.forget(id)) forgotten = true
    }
    if (this.semanticMemory?.forget(id)) forgotten = true
    return forgotten
  }

  consolidate(id: string): boolean {
    const item = this.findItem(id)
    if (!item || item.memoryType === MemoryType.LONG_TERM) return false
    const consolidated = createMemoryItem(item.content, MemoryType.LONG_TERM, {
      importance: item.importance,
      metadata: { ...item.metadata, consolidatedFrom: id },
      emotionScore: item.emotionScore,
      confidence: item.confidence,
    })
    this.longTermMemory.store(consolidated)
    return true
  }

  getContext(query: string, maxTokens = 2000): string {
    const results = this.recall(query, 10)
    const lines: string[] = []
    let charCount = 0
    const maxChars = maxTokens * 4
    for (const [item] of results) {
      const line = `[${item.memoryType}] ${typeof item.content === "string" ? item.content : JSON.stringify(item.content)}`
      if (charCount + line.length > maxChars) break
      lines.push(line)
      charCount += line.length
    }
    return lines.join("\n")
  }

  updateMemory(
    id: string,
    updates: {
      content?: unknown
      importance?: number
      metadata?: Record<string, unknown>
    },
  ): MemoryItem | null {
    for (const layer of [
      this.workingMemory,
      this.shortTermMemory,
      this.longTermMemory,
      this.episodicMemory,
    ]) {
      const items = layer.getAll()
      const idx = items.findIndex((i) => i.id === id)
      if (idx !== -1) {
        const item = items[idx]!
        if (updates.content !== undefined) item.content = updates.content
        if (updates.importance !== undefined) item.importance = clamp(updates.importance, 0, 1)
        if (updates.metadata !== undefined) item.metadata = { ...item.metadata, ...updates.metadata }
        item.lastAccessed = Date.now()
        return item
      }
    }
    if (this.semanticMemory) {
      const entity = this.semanticMemory.get(id)
      if (entity) {
        if (updates.content !== undefined) entity.content = updates.content
        if (updates.importance !== undefined) entity.importance = clamp(updates.importance, 0, 1)
        if (updates.metadata !== undefined) entity.metadata = { ...entity.metadata, ...updates.metadata }
        entity.lastAccessed = Date.now()
        return entity
      }
    }
    return null
  }

  autoConsolidate(): ConsolidationResult | null {
    const expired = this.shortTermMemory.decayExpiredItems()
    for (const item of expired) {
      this.attemptTransfer(item)
    }

    const allItems = [
      ...this.workingMemory.getAll(),
      ...this.shortTermMemory.getAll(),
      ...this.longTermMemory.getAll(),
      ...this.episodicMemory.getAll(),
    ]
    if (this.semanticMemory) {
      allItems.push(...this.semanticMemory.getAll())
    }

    if (!this.sleepConsolidation.shouldConsolidate(this.lastConsolidation, allItems.length)) {
      return null
    }

    const result = this.sleepConsolidation.consolidate(
      this.workingMemory.getAll(),
      this.shortTermMemory.getAll(),
      (item) => this.longTermMemory.store(item),
      (id) => this.forget(id),
      (id, updates) => {
        const layers = [
          this.workingMemory,
          this.shortTermMemory,
          this.longTermMemory,
          this.episodicMemory,
        ]
        let targetIndex = -1
        let targetItems: MemoryItem[] | null = null
        for (const layer of layers) {
          const items = layer.getAll()
          const idx = items.findIndex((i) => i.id === id)
          if (idx !== -1) {
            targetItems = items
            targetIndex = idx
            break
          }
        }
        if (targetItems && targetIndex !== -1) {
          if (updates.importance !== undefined) targetItems[targetIndex]!.importance = clamp(updates.importance, 0, 1)
          if (updates.confidence !== undefined) targetItems[targetIndex]!.confidence = clamp(updates.confidence, 0, 1)
        }
      },
    )

    this.lastConsolidation = Date.now()
    return result
  }

  getStatistics(): Record<string, unknown> {
    const allItems = [
      ...this.workingMemory.getAll(),
      ...this.shortTermMemory.getAll(),
      ...this.longTermMemory.getAll(),
      ...this.episodicMemory.getAll(),
    ]
    if (this.semanticMemory) {
      allItems.push(...this.semanticMemory.getAll())
    }

    const seen = new Set<string>()
    const unique = allItems.filter((item) => {
      if (seen.has(item.id)) return false
      seen.add(item.id)
      return true
    })

    const totalMemories = unique.length
    const distribution: Record<string, number> = {
      working: 0,
      short_term: 0,
      long_term: 0,
      episodic: 0,
      semantic: 0,
    }
    for (const item of unique) {
      distribution[item.memoryType] = (distribution[item.memoryType] ?? 0) + 1
    }

    const totalImportance = unique.reduce((sum, item) => sum + item.importance, 0)
    const averageImportance = totalMemories > 0 ? totalImportance / totalMemories : 0

    let freshnessScore = 0
    if (totalMemories > 0) {
      const now = Date.now()
      const maxAge = 24 * 60 * 60 * 1000
      const freshnessSum = unique.reduce((sum, item) => {
        const age = Math.min(now - item.lastAccessed, maxAge)
        return sum + (1 - age / maxAge)
      }, 0)
      freshnessScore = freshnessSum / totalMemories
    }

    return {
      totalMemories,
      memoryDistribution: distribution,
      averageImportance,
      freshnessScore,
      lastConsolidation: this.lastConsolidation,
      workingMemory: this.workingMemory.getStatistics(),
      shortTermMemory: this.shortTermMemory.getStatistics(),
      longTermMemory: this.longTermMemory.getStatistics(),
      episodicMemory: this.episodicMemory.getStatistics(),
      semanticMemory: this.semanticMemory?.getStatistics() ?? { entityCount: 0, relationCount: 0 },
    }
  }

  // ── Private helpers ──────────────────────────────────────────────

  private autoScoreImportance(content: unknown): number {
    const str = String(content).toLowerCase()
    let score = 0.5
    if (/urgent|critical|important|immediately|asap/i.test(str)) score += 0.3
    if (/error|failed|exception|crash|bug/i.test(str)) score += 0.2
    if (/note|reminder|todo|task/i.test(str)) score += 0.1
    if (str.length < 10) score -= 0.1
    if (str.length > 500) score += 0.1
    return clamp(score, 0, 1)
  }

  private determineMemoryType(content: unknown, importance: number): MemoryType {
    const str = String(content).toLowerCase()
    if (importance >= 0.8) return MemoryType.WORKING
    if (/\d{4}-\d{2}-\d{2}|yesterday|today|tomorrow|last week|next week/i.test(str)) return MemoryType.EPISODIC
    if (/is a|are the|definition|meaning|refers to/i.test(str)) return MemoryType.SEMANTIC
    if (importance >= 0.5) return MemoryType.SHORT_TERM
    return MemoryType.LONG_TERM
  }

  private evictFromWorkingMemory(): void {
    const items = this.workingMemory.getAll()
    if (items.length === 0) return
    const oldest = items[0]!
    this.workingMemory.forget(oldest.id)
    this.attemptTransfer(oldest)
  }

  private attemptTransfer(item: MemoryItem): void {
    if (item.importance >= this.stmTransferThreshold) {
      this.shortTermMemory.store({
        ...item,
        memoryType: MemoryType.SHORT_TERM,
        timestamp: Date.now(),
        accessCount: 0,
        lastAccessed: Date.now(),
      })
    }
  }

  private storeByType(item: MemoryItem): void {
    switch (item.memoryType) {
      case MemoryType.WORKING:
        this.workingMemory.store(item)
        break
      case MemoryType.SHORT_TERM:
        this.shortTermMemory.store(item)
        break
      case MemoryType.LONG_TERM:
        this.longTermMemory.store(item)
        break
      case MemoryType.EPISODIC:
        this.episodicMemory.store(item)
        break
      case MemoryType.SEMANTIC:
        this.semanticMemory?.store(item)
        break
    }
  }

  private findItem(id: string): MemoryItem | undefined {
    for (const layer of [
      this.workingMemory,
      this.shortTermMemory,
      this.longTermMemory,
      this.episodicMemory,
    ]) {
      const found = layer.get(id)
      if (found) return found
    }
    return this.semanticMemory?.get(id)
  }

  private searchLayer(layer: MemoryType, query: string, topK: number): [MemoryItem, number][] {
    switch (layer) {
      case MemoryType.WORKING: {
        const results = this.attentionRetrieval.retrieve(query, this.workingMemory.getAll(), topK)
        return results.map(([item, w]) => [item, w.total] as [MemoryItem, number])
      }
      case MemoryType.SHORT_TERM: {
        const results = this.attentionRetrieval.retrieve(query, this.shortTermMemory.getActive(), topK)
        return results.map(([item, w]) => [item, w.total] as [MemoryItem, number])
      }
      case MemoryType.LONG_TERM:
        return this.longTermMemory.search(query, topK)
      case MemoryType.EPISODIC: {
        const results = this.attentionRetrieval.retrieve(query, this.episodicMemory.getAll(), topK)
        return results.map(([item, w]) => [item, w.total] as [MemoryItem, number])
      }
      case MemoryType.SEMANTIC: {
        if (this.semanticMemory) {
          const results = this.attentionRetrieval.retrieve(query, this.semanticMemory.getAll(), topK)
          return results.map(([item, w]) => [item, w.total] as [MemoryItem, number])
        }
        return []
      }
      default:
        return []
    }
  }
}
