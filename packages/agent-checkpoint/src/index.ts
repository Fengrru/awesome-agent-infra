/**
 * AgentCheckpoint — 3-tier checkpoint system for AI agents.
 *
 * Tiers:
 * - L1: Lightweight snapshot (state machine + DAG progress + pending queue)
 *       Max size: 50 KB, max stored: 10
 * - L2: Medium snapshot (L1 + context summary + full DAG + memory pointers)
 *       Max size: 200 KB, max stored: 5
 * - L3: Deep snapshot (L2 + archive reference + session metadata)
 *       Max size: 10 KB, max stored: 20
 *
 * Features:
 * - LRU cache with 5 MB memory budget and DB eviction callback
 * - Per-level size validation and count limits
 * - DB-backed fallback for persistence
 */

// ── Snapshot Types ──────────────────────────────────────────────────────────

export interface L1Snapshot {
  state_machine: { current_state: string; previous_state: string; transition_count: number }
  dag_progress: {
    version: number
    total_nodes: number
    completed_nodes: number
    failed_nodes: number
    node_statuses: Record<string, "pending" | "running" | "completed" | "failed" | "blocked">
  }
  pending_queue: string[]
  workspace_hash: string
}

export interface MessageRef {
  event_id: string
  sequence_index: number
  summary: string
  token_count: number
}

export interface FileContextRef {
  file_path: string
  content_hash: string
  relevant_lines: [number, number]
  summary: string
}

export interface ContextSummary {
  system_prompt_ref: string
  key_conclusions: Array<{ text: string; confidence: number }>
  recent_messages: MessageRef[]
  file_contexts: FileContextRef[]
}

export interface MemoryPointer {
  memory_id: string
  memory_type: "session" | "agent_self" | "user_profile"
  relevance_score: number
}

export interface L2Snapshot {
  l1_data: L1Snapshot
  context_summary: ContextSummary
  dag_full: unknown // generic — cast to your DAG type
  memory_pointers: MemoryPointer[]
}

export interface L3Snapshot {
  l2_data: L2Snapshot
  archive_reference: { archive_path: string; event_count: number; sequence_range: [number, number] }
  session_metadata: SessionMeta
}

export interface SessionMeta {
  title: string
  goal: string
  total_events: number
  total_tokens: number
  duration_ms: number
  created_at: number
  completed_at?: number
}

export interface Checkpoint {
  checkpoint_id: string
  session_id: string
  last_event_id: string
  level: "L1" | "L2" | "L3"
  execution_state: Record<string, unknown>
  context_hash: string
  git_head_hash?: string
  created_at: number
}

/** Database interface — implement to persist checkpoints externally */
export interface CheckpointDatabase {
  insertCheckpoint(cp: Checkpoint): void
  getLatestCheckpoint(sessionId: string, level?: string): Checkpoint | null
  getCheckpoints(sessionId: string): Checkpoint[]
  isConnected(): boolean
}

// ── LRU Cache ───────────────────────────────────────────────────────────────

class LRUCheckpointCache {
  private map = new Map<string, { cp: Checkpoint; sizeBytes: number }>()
  private totalBytes = 0

  constructor(private maxBytes: number = 5 * 1024 * 1024) {}

  get(id: string): Checkpoint | undefined {
    const entry = this.map.get(id)
    if (entry) {
      this.map.delete(id)
      this.map.set(id, entry)
      return entry.cp
    }
    return undefined
  }

  set(id: string, cp: Checkpoint, sizeBytes: number, onEvict?: (cp: Checkpoint) => void): void {
    const old = this.map.get(id)
    if (old) {
      this.totalBytes -= old.sizeBytes
      this.map.delete(id)
    }
    while (this.totalBytes + sizeBytes > this.maxBytes && this.map.size > 0) {
      const firstKey = this.map.keys().next().value
      if (!firstKey) break
      const evicted = this.map.get(firstKey)!
      this.totalBytes -= evicted.sizeBytes
      this.map.delete(firstKey)
      onEvict?.(evicted.cp)
    }
    this.map.set(id, { cp, sizeBytes })
    this.totalBytes += sizeBytes
  }

  has(id: string): boolean {
    return this.map.has(id)
  }
  delete(id: string): void {
    const e = this.map.get(id)
    if (e) {
      this.totalBytes -= e.sizeBytes
      this.map.delete(id)
    }
  }
  clear(): void {
    this.map.clear()
    this.totalBytes = 0
  }
  get size(): number {
    return this.map.size
  }
  get memoryBytes(): number {
    return this.totalBytes
  }
}

// ── CheckpointManager ──────────────────────────────────────────────────────

export class CheckpointManager {
  private lruCache: LRUCheckpointCache
  private readonly MAX_L1 = 10
  private readonly MAX_L2 = 5
  private readonly MAX_L3 = 20
  private db: CheckpointDatabase | null = null

  static readonly L1_MAX_BYTES = 50 * 1024
  static readonly L2_MAX_BYTES = 200 * 1024
  static readonly L3_MAX_BYTES = 10 * 1024

  private l1Cps: Checkpoint[] = []
  private l2Cps: Checkpoint[] = []
  private l3Cps: Checkpoint[] = []

  constructor() {
    this.lruCache = new LRUCheckpointCache(5 * 1024 * 1024)
  }

  setDatabase(db: CheckpointDatabase): void {
    this.db = db
  }

  private persist(cp: Checkpoint): void {
    if (this.db?.isConnected()) this.db.insertCheckpoint(cp)
  }

  private onCacheEvict = (cp: Checkpoint): void => {
    this.persist(cp)
  }

  private storeWithLimit(cp: Checkpoint, sizeBytes: number, maxCount: number, levelCps: Checkpoint[]): void {
    this.lruCache.set(cp.checkpoint_id, cp, sizeBytes, this.onCacheEvict)
    levelCps.push(cp)
    if (levelCps.length > maxCount) {
      const removed = levelCps.shift()!
      this.lruCache.delete(removed.checkpoint_id)
    }
  }

  createL1(sessionId: string, snapshot: L1Snapshot, contextHash: string, lastEventId: string): Checkpoint {
    const sizeBytes = this.getCheckpointSize(snapshot)
    this.validateSize("L1", sizeBytes)
    const cp: Checkpoint = {
      checkpoint_id: `cp_${Date.now()}_L1`,
      session_id: sessionId,
      last_event_id: lastEventId,
      level: "L1",
      execution_state: snapshot as unknown as Record<string, unknown>,
      context_hash: contextHash,
      created_at: Date.now(),
    }
    this.storeWithLimit(cp, sizeBytes, this.MAX_L1, this.l1Cps)
    this.persist(cp)
    return cp
  }

  createL2(
    sessionId: string,
    snapshot: L2Snapshot,
    contextHash: string,
    gitHeadHash: string,
    lastEventId: string,
  ): Checkpoint {
    const sizeBytes = this.getCheckpointSize(snapshot)
    this.validateSize("L2", sizeBytes)
    const cp: Checkpoint = {
      checkpoint_id: `cp_${Date.now()}_L2`,
      session_id: sessionId,
      last_event_id: lastEventId,
      level: "L2",
      execution_state: snapshot as unknown as Record<string, unknown>,
      context_hash: contextHash,
      git_head_hash: gitHeadHash,
      created_at: Date.now(),
    }
    this.storeWithLimit(cp, sizeBytes, this.MAX_L2, this.l2Cps)
    this.persist(cp)
    return cp
  }

  createL3(sessionId: string, snapshot: L3Snapshot, contextHash: string): Checkpoint {
    const sizeBytes = this.getCheckpointSize(snapshot)
    this.validateSize("L3", sizeBytes)
    const cp: Checkpoint = {
      checkpoint_id: `cp_${Date.now()}_L3`,
      session_id: sessionId,
      last_event_id: "",
      level: "L3",
      execution_state: snapshot as unknown as Record<string, unknown>,
      context_hash: contextHash,
      created_at: Date.now(),
    }
    this.storeWithLimit(cp, sizeBytes, this.MAX_L3, this.l3Cps)
    this.persist(cp)
    return cp
  }

  getLatest(sessionId: string, level?: "L1" | "L2" | "L3"): Checkpoint | null {
    const filterBySession = (cp: Checkpoint) => cp.session_id === sessionId
    if (level) {
      const levelCps = level === "L1" ? this.l1Cps : level === "L2" ? this.l2Cps : this.l3Cps
      return levelCps.filter(filterBySession).at(-1) ?? this.db?.getLatestCheckpoint(sessionId, level) ?? null
    }
    return (
      [...this.l1Cps, ...this.l2Cps, ...this.l3Cps].filter(filterBySession).at(-1) ??
      this.db?.getLatestCheckpoint(sessionId) ??
      null
    )
  }

  getCheckpointSize(snapshot: L1Snapshot | L2Snapshot | L3Snapshot): number {
    return new TextEncoder().encode(JSON.stringify(snapshot)).length
  }

  validateSize(
    level: "L1" | "L2" | "L3",
    sizeBytes: number,
  ): { ok: boolean; sizeBytes: number; limitBytes: number; warning?: string } {
    const limits = {
      L1: CheckpointManager.L1_MAX_BYTES,
      L2: CheckpointManager.L2_MAX_BYTES,
      L3: CheckpointManager.L3_MAX_BYTES,
    }
    const limitBytes = limits[level]
    if (sizeBytes > limitBytes) {
      return {
        ok: false,
        sizeBytes,
        limitBytes,
        warning: `${level} checkpoint ${(sizeBytes / 1024).toFixed(1)}KB exceeds ${(limitBytes / 1024).toFixed(0)}KB limit`,
      }
    }
    return { ok: true, sizeBytes, limitBytes }
  }

  getAllCheckpoints(): Checkpoint[] {
    return [...this.l1Cps, ...this.l2Cps, ...this.l3Cps]
  }
  getCacheMemoryBytes(): number {
    return this.lruCache.memoryBytes
  }
  clear(): void {
    this.l1Cps = []
    this.l2Cps = []
    this.l3Cps = []
    this.lruCache.clear()
  }
}

/**
 * Create a {@link CheckpointManager} instance.
 *
 * @param args - Constructor arguments forwarded to {@link CheckpointManager}.
 * @returns A new {@link CheckpointManager}.
 */
export function createCheckpointManager(...args: ConstructorParameters<typeof CheckpointManager>): CheckpointManager {
  return new CheckpointManager(...args)
}
