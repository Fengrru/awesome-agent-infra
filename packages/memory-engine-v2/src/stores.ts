/**
 * Memory stores — tiered storage layers.
 * @module memory-engine-v2/stores
 */

import { computeIDF, computeTFIDFVector, cosineSimilarity, tokenize } from "./tfidf"
import type { MemoryItem } from "./types"

// ═══════════════════════════════════════════════════════════════════════════
// WorkingMemory
// ═══════════════════════════════════════════════════════════════════════════

export class WorkingMemory {
  readonly capacity: number
  private items: MemoryItem[] = []

  constructor(capacity = 7) {
    this.capacity = capacity
  }

  store(item: MemoryItem): boolean {
    if (this.items.length >= this.capacity) return false
    const stored = { ...item, lastAccessed: Date.now(), accessCount: item.accessCount + 1 }
    this.items.push(stored)
    return true
  }

  get(id: string): MemoryItem | undefined {
    const item = this.items.find((i) => i.id === id)
    if (item) {
      item.lastAccessed = Date.now()
      item.accessCount++
    }
    return item
  }

  forget(id: string): boolean {
    const idx = this.items.findIndex((i) => i.id === id)
    if (idx === -1) return false
    this.items.splice(idx, 1)
    return true
  }

  getAll(): MemoryItem[] {
    return [...this.items]
  }

  isFull(): boolean {
    return this.items.length >= this.capacity
  }

  getStatistics(): { count: number; capacity: number; averageImportance: number } {
    const count = this.items.length
    const avgImportance = count > 0 ? this.items.reduce((sum, i) => sum + i.importance, 0) / count : 0
    return { count, capacity: this.capacity, averageImportance: avgImportance }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ShortTermMemory
// ═══════════════════════════════════════════════════════════════════════════

export class ShortTermMemory {
  readonly capacity: number
  readonly halfLifeMs: number
  private items: MemoryItem[] = []

  constructor(capacity = 100, halfLifeMs = 3600000) {
    this.capacity = capacity
    this.halfLifeMs = halfLifeMs
  }

  store(item: MemoryItem): boolean {
    if (this.items.length >= this.capacity) return false
    const stored = { ...item, lastAccessed: Date.now(), accessCount: item.accessCount + 1 }
    this.items.push(stored)
    return true
  }

  get(id: string): MemoryItem | undefined {
    const item = this.items.find((i) => i.id === id)
    if (item) {
      item.lastAccessed = Date.now()
      item.accessCount++
    }
    return item
  }

  forget(id: string): boolean {
    const idx = this.items.findIndex((i) => i.id === id)
    if (idx === -1) return false
    this.items.splice(idx, 1)
    return true
  }

  getAll(): MemoryItem[] {
    return [...this.items]
  }

  getActive(): MemoryItem[] {
    const now = Date.now()
    return this.items.filter((i) => now - i.timestamp <= this.halfLifeMs).sort((a, b) => b.importance - a.importance)
  }

  decayExpiredItems(): MemoryItem[] {
    const now = Date.now()
    const expired: MemoryItem[] = []
    this.items = this.items.filter((i) => {
      if (now - i.timestamp > this.halfLifeMs) {
        expired.push({ ...i })
        return false
      }
      return true
    })
    return expired
  }

  getStatistics(): { count: number; capacity: number; activeCount: number; decayedCount: number } {
    const now = Date.now()
    const active = this.items.filter((i) => now - i.timestamp <= this.halfLifeMs).length
    const decayed = this.items.length - active
    return { count: this.items.length, capacity: this.capacity, activeCount: active, decayedCount: decayed }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// LongTermMemory
// ═══════════════════════════════════════════════════════════════════════════

export class LongTermMemory {
  private items: MemoryItem[] = []

  store(item: MemoryItem): boolean {
    const stored = { ...item, lastAccessed: Date.now(), accessCount: item.accessCount + 1 }
    this.items.push(stored)
    return true
  }

  get(id: string): MemoryItem | undefined {
    const item = this.items.find((i) => i.id === id)
    if (item) {
      item.lastAccessed = Date.now()
      item.accessCount++
    }
    return item
  }

  forget(id: string): boolean {
    const idx = this.items.findIndex((i) => i.id === id)
    if (idx === -1) return false
    this.items.splice(idx, 1)
    return true
  }

  getAll(): MemoryItem[] {
    return [...this.items]
  }

  search(query: string, topK = 10): [MemoryItem, number][] {
    if (this.items.length === 0 || !query.trim()) return []
    const queryTokens = tokenize(query)
    if (queryTokens.length === 0) return []
    const documents = this.items.map((item) => tokenize(String(item.content)))
    const idf = computeIDF(documents)
    const queryVec = computeTFIDFVector(queryTokens, idf)
    const results: [MemoryItem, number][] = []
    for (let i = 0; i < this.items.length; i++) {
      const docVec = computeTFIDFVector(documents[i]!, idf)
      const similarity = cosineSimilarity(queryVec, docVec)
      if (similarity > 0) {
        results.push([this.items[i]!, similarity])
      }
    }
    results.sort((a, b) => b[1] - a[1])
    return results.slice(0, topK)
  }

  getStatistics(): { count: number; totalAccessCount: number } {
    const totalAccessCount = this.items.reduce((sum, i) => sum + i.accessCount, 0)
    return { count: this.items.length, totalAccessCount }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EpisodicMemory
// ═══════════════════════════════════════════════════════════════════════════

export class EpisodicMemory {
  private items: MemoryItem[] = []

  store(item: MemoryItem): boolean {
    const stored = { ...item, lastAccessed: Date.now(), accessCount: item.accessCount + 1 }
    this.items.push(stored)
    this.items.sort((a, b) => a.timestamp - b.timestamp)
    return true
  }

  get(id: string): MemoryItem | undefined {
    const item = this.items.find((i) => i.id === id)
    if (item) {
      item.lastAccessed = Date.now()
      item.accessCount++
    }
    return item
  }

  forget(id: string): boolean {
    const idx = this.items.findIndex((i) => i.id === id)
    if (idx === -1) return false
    this.items.splice(idx, 1)
    return true
  }

  getAll(): MemoryItem[] {
    return [...this.items]
  }

  getByTimeRange(start: number, end: number): MemoryItem[] {
    return this.items.filter((i) => i.timestamp >= start && i.timestamp <= end)
  }

  getStatistics(): { count: number; oldestTimestamp: number | null } {
    const oldest = this.items.length > 0 ? this.items[0]!.timestamp : null
    return { count: this.items.length, oldestTimestamp: oldest }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SemanticMemory
// ═══════════════════════════════════════════════════════════════════════════

export class SemanticMemory {
  private entities = new Map<string, MemoryItem>()
  private edges: { source: string; relation: string; target: string }[] = []

  store(entity: MemoryItem): boolean {
    if (this.entities.has(entity.id)) return false
    this.entities.set(entity.id, {
      ...entity,
      lastAccessed: Date.now(),
      accessCount: entity.accessCount + 1,
    })
    return true
  }

  addRelation(sourceId: string, relation: string, targetId: string): boolean {
    if (!this.entities.has(sourceId) || !this.entities.has(targetId)) return false
    this.edges.push({ source: sourceId, relation, target: targetId })
    return true
  }

  get(id: string): MemoryItem | undefined {
    const entity = this.entities.get(id)
    if (entity) {
      entity.lastAccessed = Date.now()
      entity.accessCount++
    }
    return entity
  }

  forget(id: string): boolean {
    if (!this.entities.has(id)) return false
    this.entities.delete(id)
    this.edges = this.edges.filter((e) => e.source !== id && e.target !== id)
    return true
  }

  getAll(): MemoryItem[] {
    return Array.from(this.entities.values())
  }

  getNeighbors(id: string, depth = 1): MemoryItem[] {
    if (!this.entities.has(id)) return []
    const visited = new Set<string>()
    const queue: [string, number][] = [[id, 0]]
    const result: MemoryItem[] = []
    visited.add(id)
    while (queue.length > 0) {
      const [currentId, currentDepth] = queue.shift()!
      if (currentDepth >= depth) continue
      for (const edge of this.edges) {
        let neighborId: string | null = null
        if (edge.source === currentId && !visited.has(edge.target)) {
          neighborId = edge.target
        } else if (edge.target === currentId && !visited.has(edge.source)) {
          neighborId = edge.source
        }
        if (neighborId !== null) {
          visited.add(neighborId)
          const entity = this.entities.get(neighborId)
          if (entity) result.push(entity)
          queue.push([neighborId, currentDepth + 1])
        }
      }
    }
    return result
  }

  getStatistics(): { entityCount: number; relationCount: number } {
    return { entityCount: this.entities.size, relationCount: this.edges.length }
  }
}
