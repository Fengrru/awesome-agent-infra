/**
 * AgentMemory — 4-tier memory system for AI agents.
 *
 * Tiers:
 * - L1 Transient: current turn scratchpad (max 10 items)
 * - L2 Working: current session workspace (max 20 items)
 * - L3 Long-term: cross-session persistent memory with Ebbinghaus forgetting curve
 * - L4 Core Rules: persistent agent personality/constraint rules
 *
 * Key features:
 * - 5-factor importance scoring (user_marked, error_related, goal_similarity, frequency, recency)
 * - Compound retention (Ebbinghaus decay with access_count boost)
 * - Composite retrieval scoring (0.4×vector + 0.3×importance + 0.3×retention)
 * - Token-budget-aware context assembly with 5-second result caching
 *
 * ## Unified bridge (v2)
 * `UnifiedMemoryBridge` wraps memory-engine-v2's 5-tier bio-inspired architecture
 * and adds CoreRules + Ebbinghaus decay + token-budget context assembly.
 * Use `import { UnifiedMemoryBridge } from "@fengrru/agent-memory"`.
 */

// ── Unified bridge (memory-engine-v2 integration) ─────────────────────────
export {
  UnifiedMemoryBridge,
  type BridgeConfig,
  type AssembledContext as BridgeAssembledContext,
  type CoreRule as BridgeCoreRule,
  type LongTermMemory as BridgeLongTermMemory,
  type WorkingMemory as BridgeWorkingMemory,
  type TransientMemory as BridgeTransientMemory,
} from "./bridge"

// ── Types ────────────────────────────────────────────────────────────────

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

export interface CoreRule {
  rule_id: string
  category: string
  content: string
  token_count: number
  importance: number
}

export interface TransientMemory {
  id: string
  content: string
  token_count: number
  created_at: number
}

export interface AssembledContext {
  l4: CoreRule[]
  l2: WorkingMemory[]
  l3: LongTermMemory[]
  l1: TransientMemory[]
  totalTokens: number
}

/** Optional persistence backend — implement this to persist memories externally */
export interface MemoryDatabase {
  insertMemory(mem: LongTermMemory): void
  getMemories(sessionId: string): LongTermMemory[]
  searchByTags(tags: string[]): LongTermMemory[]
  markSuccessful(memoryId: string): void
  getAgentSelfRules(): CoreRule[]
  upsertAgentSelfRule(rule: CoreRule): void
  getUserProfiles(userHash?: string): Array<{
    profile_id: string
    user_hash: string
    category: string
    content: string
    token_count: number
    importance: number
  }>
  upsertUserProfile(profile: {
    profile_id: string
    user_hash: string
    category: string
    content: string
    token_count: number
    importance: number
  }): void
}

// ── Helpers ──────────────────────────────────────────────────────────────

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

// ── MemorySystem ─────────────────────────────────────────────────────────

export class MemorySystem {
  private workingMemories: WorkingMemory[] = []
  private longTermMemories: LongTermMemory[] = []
  private coreRules: CoreRule[] = []
  private transientMemories: TransientMemory[] = []
  private maxTokens = 8000
  private db: MemoryDatabase | null = null

  // Cache for assembleContext
  private cachedContext: AssembledContext | null = null
  private cacheGoal = ""
  private cacheVectorHash = ""
  private cacheTimestamp = 0
  private readonly CACHE_TTL_MS = 5000

  setMaxTokens(tokens: number): void {
    this.maxTokens = tokens
  }

  setDatabase(db: MemoryDatabase): void {
    this.db = db
    for (const rule of db.getAgentSelfRules()) this.addCoreRule(rule)
    for (const mem of db.getMemories("global")) this.addLongTermMemory(mem)
  }

  addCoreRule(rule: CoreRule): void {
    const idx = this.coreRules.findIndex((r) => r.rule_id === rule.rule_id)
    if (idx >= 0) this.coreRules[idx] = rule
    else this.coreRules.push(rule)
    this.db?.upsertAgentSelfRule(rule)
  }

  addWorkingMemory(mem: WorkingMemory): void {
    this.workingMemories.push(mem)
    if (this.workingMemories.length > 20) this.workingMemories = this.workingMemories.slice(-20)
    this.invalidateCache()
  }

  addLongTermMemory(mem: LongTermMemory): void {
    const idx = this.longTermMemories.findIndex((m) => m.memory_id === mem.memory_id)
    if (idx >= 0) this.longTermMemories[idx] = mem
    else this.longTermMemories.push(mem)
    this.db?.insertMemory(mem)
    if (this.longTermMemories.length > 800) {
      this.longTermMemories.sort((a, b) => b.retention_score - a.retention_score)
      const keep = 600
      if (this.longTermMemories.length > keep) {
        this.longTermMemories = this.longTermMemories.slice(0, keep)
      }
    }
    this.invalidateCache()
  }

  searchByTags(tags: string[]): LongTermMemory[] {
    if (tags.length === 0) return []
    const tagSet = new Set(tags.map((t) => t.toLowerCase()))
    return this.longTermMemories
      .filter((m) => m.tags?.some((t) => tagSet.has(t.toLowerCase())))
      .sort((a, b) => b.retention_score - a.retention_score)
  }

  /** Mark a memory as successfully reused — boosts importance + retention */
  markSuccessful(memoryId: string): boolean {
    const mem = this.longTermMemories.find((m) => m.memory_id === memoryId)
    if (!mem) return false
    mem.access_count++
    mem.last_accessed = Date.now()
    mem.importance = Math.min(1.0, mem.importance + 0.05)
    mem.retention_score = Math.min(1.0, this.calculateRetention(mem))
    if (mem.user_marked === undefined) mem.user_marked = true
    this.db?.insertMemory(mem)
    return true
  }

  addTransient(content: string, tokenCount: number): void {
    this.transientMemories.push({ id: `t_${Date.now()}`, content, token_count: tokenCount, created_at: Date.now() })
    if (this.transientMemories.length > 10) this.transientMemories = this.transientMemories.slice(-10)
    this.invalidateCache()
  }

  clearTransient(): void {
    this.transientMemories = []
  }

  // ── Scoring ───────────────────────────────────────────────────────

  /** 5-factor importance: user_marked(0.3) + error(0.25) + goal(0.2) + freq(0.15) + recency(0.1) */
  calculateImportance(memory: LongTermMemory): number {
    const userExplicit = memory.user_marked ? 1.0 : 0.0
    const errorRelated = memory.associated_error ? 1.0 : 0.0
    const goalRelated = memory.goal_similarity ?? 0.5
    const frequency = Math.min(1.0, memory.access_count / 10)
    const recency = Math.exp(-(Date.now() - memory.created_at) / 86400000)
    return 0.3 * userExplicit + 0.25 * errorRelated + 0.2 * goalRelated + 0.15 * frequency + 0.1 * recency
  }

  /** Ebbinghaus decay: R = exp(-t / S_eff) * beta, where S_eff = S * (1 + alpha * n) */
  calculateRetention(memory: LongTermMemory, now: number = Date.now()): number {
    const tHours = (now - memory.created_at) / 3600000
    const S = 24
    const alpha = 0.3
    const beta = 0.5 + memory.importance * 0.5
    const S_eff = S * (1 + alpha * memory.access_count)
    return Math.max(0.05, Math.min(1.0, Math.exp(-tHours / S_eff) * beta))
  }

  /** Composite retrieval: 0.4×vector_sim + 0.3×importance + 0.3×retention */
  compositeRetrievalScore(memory: LongTermMemory, queryVector: number[] | null, currentGoal: string): number {
    const vectorSim = queryVector
      ? cosineSimilarity(memory.vector ?? [], queryVector)
      : jaccardSimilarity(memory.content, currentGoal)
    return 0.4 * vectorSim + 0.3 * this.calculateImportance(memory) + 0.3 * this.calculateRetention(memory)
  }

  // ── Context Assembly ───────────────────────────────────────────────

  /** Assemble a token-budgeted context from all 4 memory tiers */
  assembleContext(currentGoal: string, queryVector: number[] | null = null): AssembledContext {
    const now = Date.now()
    const vectorHash = queryVector ? queryVector.join(",") : "none"
    if (
      this.cachedContext &&
      this.cacheGoal === currentGoal &&
      this.cacheVectorHash === vectorHash &&
      now - this.cacheTimestamp < this.CACHE_TTL_MS
    ) {
      return this.cachedContext
    }

    let remaining = this.maxTokens
    const l4Budget = Math.min(
      this.coreRules.reduce((s, r) => s + r.token_count, 0),
      600,
    )
    remaining -= l4Budget
    const l2Budget = Math.min(
      this.workingMemories.reduce((s, m) => s + m.token_count, 0),
      1200,
    )
    remaining -= l2Budget
    const l1Budget = 500
    remaining -= l1Budget
    const l3Budget = remaining

    const scored = this.longTermMemories
      .map((m) => ({ memory: m, score: this.compositeRetrievalScore(m, queryVector, currentGoal) }))
      .sort((a, b) => b.score - a.score)

    const selectedL3: LongTermMemory[] = []
    let usedL3 = 0
    for (const { memory } of scored) {
      if (usedL3 + memory.token_count > l3Budget) break
      selectedL3.push(memory)
      usedL3 += memory.token_count
      memory.access_count++
      memory.last_accessed = Date.now()
    }

    const context: AssembledContext = {
      l4: this.coreRules.slice(0, Math.max(1, Math.floor(l4Budget / 50))),
      l2: this.workingMemories.slice(-Math.max(1, Math.floor(l2Budget / 100))),
      l3: selectedL3,
      l1: this.transientMemories.slice(-5),
      totalTokens: l4Budget + l2Budget + l1Budget + usedL3,
    }

    this.cachedContext = context
    this.cacheGoal = currentGoal
    this.cacheVectorHash = vectorHash
    this.cacheTimestamp = now
    return context
  }

  private invalidateCache(): void {
    this.cachedContext = null
    this.cacheGoal = ""
    this.cacheVectorHash = ""
    this.cacheTimestamp = 0
  }

  getWorkingMemories(): WorkingMemory[] {
    return [...this.workingMemories]
  }
  getLongTermMemories(): LongTermMemory[] {
    return [...this.longTermMemories]
  }
  getCoreRules(): CoreRule[] {
    return [...this.coreRules]
  }
  getTransientMemories(): TransientMemory[] {
    return [...this.transientMemories]
  }
  getMaxTokens(): number {
    return this.maxTokens
  }

  toJSON(): object {
    return {
      workingMemories: this.workingMemories,
      longTermMemories: this.longTermMemories,
      coreRules: this.coreRules,
      transientMemories: this.transientMemories,
      maxTokens: this.maxTokens,
    }
  }

  fromJSON(data: {
    workingMemories: WorkingMemory[]
    longTermMemories: LongTermMemory[]
    coreRules: CoreRule[]
    transientMemories: TransientMemory[]
    maxTokens: number
  }): void {
    this.workingMemories = data.workingMemories
    this.longTermMemories = data.longTermMemories
    this.coreRules = data.coreRules
    this.transientMemories = data.transientMemories
    this.maxTokens = data.maxTokens
    this.invalidateCache()
  }
}

/**
 * Create a {@link MemorySystem} instance.
 *
 * @param args - Constructor arguments forwarded to {@link MemorySystem}.
 * @returns A new {@link MemorySystem}.
 */
export function createMemorySystem(...args: ConstructorParameters<typeof MemorySystem>): MemorySystem {
  return new MemorySystem(...args)
}
