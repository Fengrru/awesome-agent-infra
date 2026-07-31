/**
 * UnifiedMemoryBridge — 统一 agent-memory 4-tier 与 memory-engine-v2 5-tier 双轨记忆系统。
 *
 * 架构:
 * - 底层存储: MemoryEngine (5-tier: Working / ShortTerm / LongTerm / Episodic / Semantic)
 * - 上层扩展: CoreRules (L4) + TransientMemory (L1) + 上下文组装 + Ebbinghaus 衰减
 *
 * 功能:
 * - addMemory(content, type, importance, metadata) → 写入 engine 对应层
 * - recall(query, topK, layers) → 跨层注意力检索
 * - addCoreRule / getCoreRules → L4 规则管理
 * - addTransient / clearTransient → L1 瞬态记忆
 * - assembleContext(goal, vector, maxTokens) → 令牌预算上下文组装
 * - calculateRetention(memory) → Ebbinghaus 衰减 (R = exp(-t/S_eff) * beta)
 * - calculateImportance(memory) → 5因子重要性评分
 * - markSuccessful(id) → 成功标记提升重要性
 * - autoConsolidate() → 触发睡眠巩固
 * - getStatistics() → 完整统计信息
 * - toJSON / fromJSON → 序列化还原
 *
 * @module agent-memory/bridge
 */

import { MemoryEngine, type MemoryType } from "@fengru/memory-engine-v2"
import type { AttentionConfig, MemoryConfig, MemoryItem, MetaMemoryConfig, SleepConfig } from "@fengru/memory-engine-v2"

// ── 兼容类型 (re-export from agent-memory) ──────────────────────────────

export interface CoreRule {
  rule_id: string
  category: string
  content: string
  token_count: number
  importance: number
}

export interface LongTermMemory {
  memory_id: string
  content: string
  token_count: number
  importance: number
  access_count: number
  created_at: number
  last_accessed: number
  retention_score: number
  vector?: number[]
  goal_similarity?: number
  associated_error?: boolean
  user_marked?: boolean
  category?: string
  tags?: string[]
}

export interface WorkingMemory {
  id: string
  content: string
  token_count: number
  priority: number
}

export interface TransientMemory {
  id: string
  content: string
  token_count: number
  created_at: number
}

export interface AssembledContext {
  l4: CoreRule[]
  l3: LongTermMemory[]
  l2: WorkingMemory[]
  l1: TransientMemory[]
  l3Engine: MemoryItem[] // raw engine items for debug
  totalTokens: number
}

export interface BridgeConfig {
  maxTokens: number
  cacheTtlMs: number
  workingMemoryCap: number
  transientMemoryCap: number
}

const DEFAULT_BRIDGE_CONFIG: BridgeConfig = {
  maxTokens: 8000,
  cacheTtlMs: 5000,
  workingMemoryCap: 20,
  transientMemoryCap: 10,
}

// ── 辅助函数 ───────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

function jaccardSimilarity(textA: string, textB: string): number {
  const wordsA = new Set(textA.toLowerCase().split(/\s+/).filter(Boolean))
  const wordsB = new Set(textB.toLowerCase().split(/\s+/).filter(Boolean))
  const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)))
  const union = new Set([...wordsA, ...wordsB])
  return union.size === 0 ? 0 : intersection.size / union.size
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

// ── UnifiedMemoryBridge ─────────────────────────────────────────────────

export class UnifiedMemoryBridge {
  /** 底层 5-tier bio-inspired 记忆引擎 */
  readonly engine: MemoryEngine

  /** L4 核心规则 (agent 行为约束) */
  private coreRules: CoreRule[] = []

  /** L2 工作记忆镜像 (agent-memory 兼容) */
  private workingMirror: WorkingMemory[] = []

  /** L1 瞬态记忆 (当前轮次草稿) */
  private transientMemories: TransientMemory[] = []

  private config: BridgeConfig

  // 上下文缓存
  private cachedContext: AssembledContext | null = null
  private cacheGoal = ""
  private cacheVectorHash = ""
  private cacheTimestamp = 0

  constructor(
    config?: Partial<
      BridgeConfig & {
        memory: MemoryConfig
        sleep: SleepConfig
        meta: MetaMemoryConfig
        attention: AttentionConfig
      }
    >,
  ) {
    this.config = { ...DEFAULT_BRIDGE_CONFIG, ...config }
    this.engine = new MemoryEngine({
      memory: config?.memory,
      sleep: config?.sleep,
      meta: config?.meta,
      attention: config?.attention,
    })
  }

  // ── 记忆写入 ──────────────────────────────────────────────────────

  /** 向引擎写入记忆，自动评分重要性和类型 */
  addMemory(
    content: unknown,
    importance?: number,
    memoryType?: MemoryType,
    metadata?: Record<string, unknown>,
    emotionScore?: number,
  ): MemoryItem {
    return this.engine.addMemory(content, memoryType, importance, metadata, emotionScore)
  }

  /** 强制写入指定层 */
  addToLayer(content: unknown, layer: MemoryType, importance = 0.5, metadata?: Record<string, unknown>): MemoryItem {
    return this.engine.addMemory(content, layer, importance, metadata)
  }

  // ── 检索 ──────────────────────────────────────────────────────────

  /** 跨层检索 top-k 记忆 */
  recall(query: string, topK = 10, layers?: MemoryType[]): [MemoryItem, number][] {
    return this.engine.recall(query, topK, layers)
  }

  /** 获取文本形式的上下文 (用于拼接入 prompt) */
  getContext(query: string, maxTokens = 2000): string {
    return this.engine.getContext(query, maxTokens)
  }

  // ── 记忆管理 ──────────────────────────────────────────────────────

  /** 删除指定记忆 */
  forget(id: string): boolean {
    return this.engine.forget(id)
  }

  /** 手动巩固某条记忆到长期层 */
  consolidate(id: string): boolean {
    return this.engine.consolidate(id)
  }

  /** 更新记忆 */
  updateMemory(
    id: string,
    updates: { content?: unknown; importance?: number; metadata?: Record<string, unknown> },
  ): MemoryItem | null {
    return this.engine.updateMemory(id, updates)
  }

  /** 触发自动巩固 (衰减 + 睡眠巩固) */
  autoConsolidate() {
    return this.engine.autoConsolidate()
  }

  // ── L4 Core Rules ─────────────────────────────────────────────────

  addCoreRule(rule: CoreRule): void {
    const idx = this.coreRules.findIndex((r) => r.rule_id === rule.rule_id)
    if (idx >= 0) this.coreRules[idx] = rule
    else this.coreRules.push(rule)
    this.invalidateCache()
  }

  getCoreRules(): CoreRule[] {
    return [...this.coreRules]
  }

  removeCoreRule(ruleId: string): boolean {
    const idx = this.coreRules.findIndex((r) => r.rule_id === ruleId)
    if (idx === -1) return false
    this.coreRules.splice(idx, 1)
    this.invalidateCache()
    return true
  }

  // ── L2 Working Memory ─────────────────────────────────────────────

  addWorkingMemory(mem: WorkingMemory): void {
    this.workingMirror.push(mem)
    if (this.workingMirror.length > this.config.workingMemoryCap) {
      this.workingMirror = this.workingMirror.slice(-this.config.workingMemoryCap)
    }
    this.invalidateCache()
  }

  getWorkingMemories(): WorkingMemory[] {
    return [...this.workingMirror]
  }

  // ── L1 Transient Memory ───────────────────────────────────────────

  addTransient(content: string, tokenCount: number): void {
    this.transientMemories.push({
      id: `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      content,
      token_count: tokenCount,
      created_at: Date.now(),
    })
    if (this.transientMemories.length > this.config.transientMemoryCap) {
      this.transientMemories = this.transientMemories.slice(-this.config.transientMemoryCap)
    }
    this.invalidateCache()
  }

  clearTransient(): void {
    this.transientMemories = []
  }

  getTransientMemories(): TransientMemory[] {
    return [...this.transientMemories]
  }

  // ── Ebbinghaus 衰减评分 ───────────────────────────────────────────

  /**
   * Ebbinghaus 遗忘曲线:
   * R = exp(-t_hours / S_eff) * beta
   * S_eff = S * (1 + alpha * access_count)
   * beta = 0.5 + importance * 0.5
   */
  calculateRetention(memory: LongTermMemory, now: number = Date.now()): number {
    const tHours = (now - memory.created_at) / 3600000
    const S = 24
    const alpha = 0.3
    const beta = 0.5 + memory.importance * 0.5
    const S_eff = S * (1 + alpha * memory.access_count)
    return Math.max(0.05, Math.min(1.0, Math.exp(-tHours / S_eff) * beta))
  }

  /** 对引擎的 MemoryItem 计算 Ebbinghaus 衰减 */
  calculateEngineRetention(item: MemoryItem, now: number = Date.now()): number {
    const tHours = (now - item.timestamp) / 3600000
    const S = 24
    const alpha = 0.3
    const beta = 0.5 + item.importance * 0.5
    const S_eff = S * (1 + alpha * item.accessCount)
    return Math.max(0.05, Math.min(1.0, Math.exp(-tHours / S_eff) * beta))
  }

  // ── 5因子重要性评分 ───────────────────────────────────────────────

  /**
   * 5-factor importance:
   * 0.3×user_marked + 0.25×error + 0.2×goal + 0.15×frequency + 0.1×recency
   */
  calculateImportance(memory: LongTermMemory): number {
    const userExplicit = memory.user_marked ? 1.0 : 0.0
    const errorRelated = memory.associated_error ? 1.0 : 0.0
    const goalRelated = memory.goal_similarity ?? 0.5
    const frequency = Math.min(1.0, memory.access_count / 10)
    const recency = Math.exp(-(Date.now() - memory.created_at) / 86400000)
    return 0.3 * userExplicit + 0.25 * errorRelated + 0.2 * goalRelated + 0.15 * frequency + 0.1 * recency
  }

  // ── 复合检索评分 ─────────────────────────────────────────────────

  /**
   * Composite retrieval: 0.4×vector_sim + 0.3×importance + 0.3×retention
   */
  compositeRetrievalScore(memory: LongTermMemory, queryVector: number[] | null, currentGoal: string): number {
    const vectorSim = queryVector
      ? cosineSimilarity(memory.vector ?? [], queryVector)
      : jaccardSimilarity(memory.content, currentGoal)
    return 0.4 * vectorSim + 0.3 * this.calculateImportance(memory) + 0.3 * this.calculateRetention(memory)
  }

  // ── 成功标记 ─────────────────────────────────────────────────────

  /** 标记记忆成功复用 — 提升重要性和访问计数 */
  markSuccessful(id: string): boolean {
    const item = this.engine.updateMemory(id, {})
    if (!item) return false
    item.accessCount++
    item.lastAccessed = Date.now()
    item.importance = Math.min(1.0, item.importance + 0.05)
    return true
  }

  // ── 上下文组装 ───────────────────────────────────────────────────

  /**
   * 从所有记忆层组装令牌预算限制的上下文。
   * 合并 CoreRules (L4) + 引擎检索 (L3) + WorkingMemory (L2) + Transient (L1)
   */
  assembleContext(currentGoal: string, queryVector: number[] | null = null): AssembledContext {
    const now = Date.now()
    const vectorHash = queryVector ? queryVector.join(",") : "none"

    // 缓存命中
    if (
      this.cachedContext &&
      this.cacheGoal === currentGoal &&
      this.cacheVectorHash === vectorHash &&
      now - this.cacheTimestamp < this.config.cacheTtlMs
    ) {
      return this.cachedContext
    }

    let remaining = this.config.maxTokens

    // L4: CoreRules 预算 (最多 600 tokens)
    const l4Budget = Math.min(
      this.coreRules.reduce((s, r) => s + r.token_count, 0),
      600,
    )
    remaining -= l4Budget

    // L2: WorkingMemory 预算 (最多 1200 tokens)
    const l2Budget = Math.min(
      this.workingMirror.reduce((s, m) => s + m.token_count, 0),
      1200,
    )
    remaining -= l2Budget

    // L1: Transient 预算 (最多 500 tokens)
    const l1Budget = 500
    remaining -= l1Budget

    // L3: 从引擎检索 (剩余预算)
    const l3Budget = Math.max(0, remaining)

    // 引擎检索
    const engineResults = this.engine.recall(currentGoal, 50)
    const selectedEngine: MemoryItem[] = []
    let usedL3 = 0
    for (const [item] of engineResults) {
      const itemTokens = estimateTokens(String(item.content))
      if (usedL3 + itemTokens > l3Budget) break
      selectedEngine.push(item)
      usedL3 += itemTokens
      item.accessCount++
      item.lastAccessed = now
    }

    // 转换为 agent-memory 兼容格式
    const selectedL3: LongTermMemory[] = selectedEngine.map((item) => ({
      memory_id: item.id,
      content: typeof item.content === "string" ? item.content : JSON.stringify(item.content),
      token_count: estimateTokens(String(item.content)),
      importance: item.importance,
      access_count: item.accessCount,
      created_at: item.timestamp,
      last_accessed: item.lastAccessed,
      retention_score: this.calculateEngineRetention(item),
      vector: item.embedding,
      category: item.metadata?.category as string,
      tags: item.metadata?.tags as string[],
    }))

    const context: AssembledContext = {
      l4: this.coreRules.slice(0, Math.max(1, Math.floor(l4Budget / 50))),
      l2: this.workingMirror.slice(-Math.max(1, Math.floor(l2Budget / 100))),
      l3: selectedL3,
      l1: this.transientMemories.slice(-5),
      l3Engine: selectedEngine,
      totalTokens: l4Budget + l2Budget + l1Budget + usedL3,
    }

    this.cachedContext = context
    this.cacheGoal = currentGoal
    this.cacheVectorHash = vectorHash
    this.cacheTimestamp = now

    return context
  }

  // ── 统计 ─────────────────────────────────────────────────────────

  getStatistics(): Record<string, unknown> {
    const engineStats = this.engine.getStatistics()
    return {
      ...engineStats,
      coreRulesCount: this.coreRules.length,
      workingMirrorCount: this.workingMirror.length,
      transientCount: this.transientMemories.length,
      bridgeConfig: this.config,
    }
  }

  // ── 序列化 ───────────────────────────────────────────────────────

  toJSON(): object {
    return {
      coreRules: this.coreRules,
      workingMirror: this.workingMirror,
      transientMemories: this.transientMemories,
      config: this.config,
      // Note: engine 状态不支持完整序列化 (含 Map 等)
    }
  }

  fromJSON(data: {
    coreRules: CoreRule[]
    workingMirror: WorkingMemory[]
    transientMemories: TransientMemory[]
    config: BridgeConfig
  }): void {
    this.coreRules = data.coreRules ?? []
    this.workingMirror = data.workingMirror ?? []
    this.transientMemories = data.transientMemories ?? []
    if (data.config) this.config = { ...this.config, ...data.config }
    this.invalidateCache()
  }

  // ── 工具 ─────────────────────────────────────────────────────────

  setMaxTokens(tokens: number): void {
    this.config.maxTokens = tokens
  }

  getMaxTokens(): number {
    return this.config.maxTokens
  }

  /** 清空所有记忆 (重新开始) */
  reset(): void {
    this.coreRules = []
    this.workingMirror = []
    this.transientMemories = []
    this.invalidateCache()
    // engine 不支持直接清空,只能逐层 forget
  }

  // ── 私有 ─────────────────────────────────────────────────────────

  private invalidateCache(): void {
    this.cachedContext = null
    this.cacheGoal = ""
    this.cacheVectorHash = ""
    this.cacheTimestamp = 0
  }
}
