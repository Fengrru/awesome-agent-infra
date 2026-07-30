/**
 * EngineDB — Pluggable SQLite Engine Database
 *
 * Unified persistence layer for AI agent engine state. Manages 10+ tables
 * covering events, checkpoints, capabilities, repair rules, memories, skills,
 * sessions, agent self-rules, and user profiles.
 *
 * ## Design
 * - **Pluggable SQLite driver**: Inject any SQLite driver (bun:sqlite, better-sqlite3)
 *   via the `ISQLiteDatabase` interface
 * - **Shared tables**: Compatible with Drizzle ORM schemas for shared DB
 * - **Engine-only tables**: CodeGraph nodes/edges/vectors table managed by this class
 * - **External mode**: Can wrap an externally-managed DB (e.g., Drizzle) via `fromExternal()`
 *
 * @module engine-db
 */

// ─── Generic SQLite Database Interface ──────────────────────────────────────

/** A prepared statement that can be run or queried */
export interface ISQLiteStatement {
  run(...params: unknown[]): void
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}

/** Generic SQLite database interface — compatible with bun:sqlite and better-sqlite3 */
export interface ISQLiteDatabase {
  query(sql: string): ISQLiteStatement
  prepare(sql: string): ISQLiteStatement
  run(sql: string, ...params: unknown[]): void
  transaction<T>(fn: () => T): () => T
  close(): void
}

// ─── Inlined Types (zero runtime deps) ──────────────────────────────────────

/** Event types shared across the engine */
export interface PersistentEvent {
  event_id: string
  session_id: string
  parent_event_id: string | null
  event_type: string
  payload: string
  status: string
  token_cost: number
  duration_ms: number
  sequence_index: number
  timestamp: number
}

export interface BusEvent {
  type: string
  session_id: string
  parent_event_id?: string
  data: Record<string, unknown>
  timestamp: number
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

export interface Capability {
  capability_id: string
  name: string
  description: string
  input_schema: Record<string, unknown>
  output_schema: Record<string, unknown>
  tags: string[]
  risk_level: 0 | 1 | 2 | 3
  total_calls: number
  success_rate: number
  avg_duration_ms: number
  avg_token_cost: number
}

export type ErrorCategory =
  | "unknown"
  | "syntax"
  | "type"
  | "runtime"
  | "network"
  | "filesystem"
  | "permission"
  | "timeout"

export interface RecoveryRule {
  repair_id: string
  tool: string
  category: ErrorCategory
  condition: string
  recovery_action: string
  specificity: number
  hit_count: number
  last_hit: number
  occurrence_count: number
  success_rate: number
  created_at: number
  exact_hash: string
  fuzzy_hash: string
  error_type: string
  core_symbols: string[]
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
  category?: string
  tags?: string[]
}

export interface CoreRule {
  rule_id: string
  category: string
  content: string
  token_count: number
  importance: number
}

export interface SkillRecord {
  skill_id: string
  trigger_condition: string
  prompt_template: string
  priority: number
  scope: "global" | "session" | "task"
  hit_count: number
  created_at: number
}

// ─── Table Names ────────────────────────────────────────────────────────────

const T = {
  EVENT_LOG: "event_log",
  CHECKPOINT: "checkpoint",
  CAPABILITY: "capability_graph",
  REPAIR: "repair_memory",
  MEMORY: "session_memory",
  SKILL: "skill",
  SESSION: "engine_session",
  AGENT_SELF: "agent_self",
  USER_PROFILE: "user_profile",
} as const

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateUUID(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

// ═══════════════════════════════════════════════════════════════════════════════
// EngineDatabase
// ═══════════════════════════════════════════════════════════════════════════════

export class EngineDatabase {
  private db: ISQLiteDatabase | null = null
  private dbPath: string
  private external = false

  constructor(dbPath = ":memory:") {
    this.dbPath = dbPath
  }

  /** Create from an existing database connection (e.g., Drizzle-managed) */
  static fromExternal(database: ISQLiteDatabase): EngineDatabase {
    const instance = new EngineDatabase("")
    instance.db = database
    instance.external = true
    return instance
  }

  /**
   * Initialize the database. Must be called with an ISQLiteDatabase factory,
   * or connect to an existing external database via `fromExternal()`.
   *
   * @param factory - Optional factory to create the database (e.g., `() => new Database(":memory:")`)
   */
  async initialize(factory?: () => ISQLiteDatabase): Promise<void> {
    if (this.external) return
    if (factory) {
      this.db = factory()
    }
    if (this.db) {
      this.createTables()
    }
  }

  /** Directly set the database instance (for Bun-specific usage) */
  setDatabase(db: ISQLiteDatabase): void {
    this.db = db
    this.createTables()
  }

  private createTables(): void {
    if (!this.db) return

    this.db.run(`
      CREATE TABLE IF NOT EXISTS codegraph_nodes (
        node_id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('file','module','symbol')),
        symbol_type TEXT,
        name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        mtime REAL NOT NULL,
        created_at INTEGER NOT NULL
      )
    `)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_cg_nodes_type ON codegraph_nodes(type)`)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_cg_nodes_file ON codegraph_nodes(file_path)`)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_cg_nodes_name ON codegraph_nodes(name)`)

    this.db.run(`
      CREATE TABLE IF NOT EXISTS codegraph_edges (
        edge_id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relation TEXT NOT NULL,
        weight REAL DEFAULT 1.0,
        source_line INTEGER,
        source_end_line INTEGER,
        FOREIGN KEY (source_id) REFERENCES codegraph_nodes(node_id),
        FOREIGN KEY (target_id) REFERENCES codegraph_nodes(node_id)
      )
    `)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_cg_edges_source ON codegraph_edges(source_id)`)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_cg_edges_target ON codegraph_edges(target_id)`)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_cg_edges_relation ON codegraph_edges(relation)`)

    this.db.run(`
      CREATE TABLE IF NOT EXISTS codegraph_vector_entries (
        entry_id TEXT PRIMARY KEY,
        vector BLOB,
        text TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        indexed_at INTEGER NOT NULL
      )
    `)

    this.db.run(`
      CREATE TABLE IF NOT EXISTS codegraph_build_state (
        build_id INTEGER PRIMARY KEY AUTOINCREMENT,
        status TEXT CHECK(status IN ('running','complete','failed')) DEFAULT 'running',
        node_count INTEGER DEFAULT 0,
        edge_count INTEGER DEFAULT 0,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        error_message TEXT
      )
    `)
  }

  isConnected(): boolean {
    return this.db !== null
  }

  // ─── Event Log ────────────────────────────────────────────────────────

  private sequenceCounters = new Map<string, number>()

  private initSequenceCounter(sessionId: string): void {
    if (this.sequenceCounters.has(sessionId)) return
    if (!this.db) return
    const row = this.db
      .query(`SELECT MAX(sequence_index) as max_seq FROM ${T.EVENT_LOG} WHERE session_id = ?`)
      .get(sessionId) as { max_seq: number | null } | null
    this.sequenceCounters.set(sessionId, row?.max_seq ?? 0)
  }

  persistBusEvent(event: BusEvent): void {
    if (!this.db) return
    this.initSequenceCounter(event.session_id)
    const seq = (this.sequenceCounters.get(event.session_id) ?? 0) + 1
    this.sequenceCounters.set(event.session_id, seq)

    const persistentEvent: PersistentEvent = {
      event_id: generateUUID(),
      session_id: event.session_id,
      parent_event_id: event.parent_event_id ?? null,
      event_type: event.type,
      payload: JSON.stringify(event.data),
      status: "pending",
      token_cost: 0,
      duration_ms: 0,
      sequence_index: seq,
      timestamp: event.timestamp,
    }
    this.insertEventsSync([persistentEvent])
  }

  private insertEventsSync(events: PersistentEvent[]): void {
    if (!this.db) return
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO ${T.EVENT_LOG}
      (event_id, session_id, parent_event_id, event_type, payload, status, token_cost, duration_ms, sequence_index, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    this.db.transaction(() => {
      for (const e of events) {
        stmt.run(
          e.event_id, e.session_id, e.parent_event_id, e.event_type,
          e.payload, e.status, e.token_cost, e.duration_ms,
          e.sequence_index, e.timestamp,
        )
      }
    })()
  }

  async insertEvents(events: PersistentEvent[]): Promise<void> {
    this.insertEventsSync(events)
  }

  queryEvents(sessionId: string, fromSeq?: number, limit = 1000): PersistentEvent[] {
    if (!this.db) return []
    const query = fromSeq
      ? this.db.query(
          `SELECT * FROM ${T.EVENT_LOG} WHERE session_id = ? AND sequence_index >= ? ORDER BY sequence_index LIMIT ?`,
        )
      : this.db.query(
          `SELECT * FROM ${T.EVENT_LOG} WHERE session_id = ? ORDER BY sequence_index LIMIT ?`,
        )

    return (
      fromSeq ? query.all(sessionId, fromSeq, limit) : query.all(sessionId, limit)
    ) as PersistentEvent[]
  }

  countEvents(sessionId: string): number {
    if (!this.db) return 0
    const row = this.db
      .query(`SELECT COUNT(*) as c FROM ${T.EVENT_LOG} WHERE session_id = ?`)
      .get(sessionId) as { c: number } | null
    return row?.c ?? 0
  }

  deleteColdEvents(
    sessionId: string,
    maxSeqIndex: number,
    archivePath: string,
    archivedCount: number,
  ): void {
    if (!this.db) return
    this.db.transaction(() => {
      this.db!.run(
        `DELETE FROM ${T.EVENT_LOG} WHERE session_id = ? AND sequence_index <= ?`,
        sessionId, maxSeqIndex,
      )
      this.db!.run(
        `INSERT INTO ${T.EVENT_LOG} (event_id, session_id, parent_event_id, event_type, payload, status, token_cost, duration_ms, sequence_index, timestamp)
         VALUES (?, ?, NULL, 'archive_summary', ?, 'success', 0, 0, ?, ?)`,
        `archive_${Date.now()}`,
        sessionId,
        JSON.stringify({ archived_to: archivePath, event_count: archivedCount }),
        maxSeqIndex,
        Date.now(),
      )
    })()
  }

  // ─── Checkpoints ──────────────────────────────────────────────────────

  insertCheckpoint(cp: Checkpoint): void {
    if (!this.db) return
    this.db.run(
      `INSERT OR REPLACE INTO ${T.CHECKPOINT} (checkpoint_id, session_id, last_event_id, level, execution_state, context_hash, git_head_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      cp.checkpoint_id, cp.session_id, cp.last_event_id, cp.level,
      JSON.stringify(cp.execution_state), cp.context_hash,
      cp.git_head_hash ?? null, cp.created_at,
    )
  }

  getLatestCheckpoint(sessionId: string, level?: string): Checkpoint | null {
    if (!this.db) return null
    const query = level
      ? `SELECT * FROM ${T.CHECKPOINT} WHERE session_id = ? AND level = ? ORDER BY created_at DESC LIMIT 1`
      : `SELECT * FROM ${T.CHECKPOINT} WHERE session_id = ? ORDER BY created_at DESC LIMIT 1`
    const row = (
      level ? this.db.query(query).get(sessionId, level) : this.db.query(query).get(sessionId)
    ) as Record<string, unknown> | null
    if (!row) return null
    return {
      checkpoint_id: row.checkpoint_id as string,
      session_id: row.session_id as string,
      last_event_id: row.last_event_id as string,
      level: row.level as "L1" | "L2" | "L3",
      execution_state:
        typeof row.execution_state === "string"
          ? JSON.parse(row.execution_state as string)
          : (row.execution_state as Record<string, unknown>),
      context_hash: row.context_hash as string,
      git_head_hash: row.git_head_hash as string,
      created_at: row.created_at as number,
    }
  }

  getCheckpoints(sessionId: string): Checkpoint[] {
    if (!this.db) return []
    const rows = this.db
      .query(`SELECT * FROM ${T.CHECKPOINT} WHERE session_id = ? ORDER BY created_at DESC`)
      .all(sessionId) as Record<string, unknown>[]
    return rows.map((row) => ({
      checkpoint_id: row.checkpoint_id as string,
      session_id: row.session_id as string,
      last_event_id: row.last_event_id as string,
      level: row.level as "L1" | "L2" | "L3",
      execution_state:
        typeof row.execution_state === "string"
          ? JSON.parse(row.execution_state as string)
          : (row.execution_state as Record<string, unknown>),
      context_hash: row.context_hash as string,
      git_head_hash: row.git_head_hash as string,
      created_at: row.created_at as number,
    }))
  }

  // ─── Capabilities ─────────────────────────────────────────────────────

  upsertCapability(cap: Capability): void {
    if (!this.db) return
    this.db.run(
      `INSERT OR REPLACE INTO ${T.CAPABILITY} (capability_id, name, description, input_schema, output_schema, tags, risk_level, total_calls, success_rate, avg_duration_ms, avg_token_cost)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      cap.capability_id, cap.name, cap.description,
      JSON.stringify(cap.input_schema), JSON.stringify(cap.output_schema),
      JSON.stringify(cap.tags), cap.risk_level, cap.total_calls,
      cap.success_rate, cap.avg_duration_ms, cap.avg_token_cost,
    )
  }

  getCapabilities(): Capability[] {
    if (!this.db) return []
    const rows = this.db
      .query(`SELECT * FROM ${T.CAPABILITY} ORDER BY success_rate DESC`)
      .all() as Record<string, unknown>[]
    return rows.map((r) => ({
      capability_id: r.capability_id as string,
      name: r.name as string,
      description: (r.description as string) ?? "",
      input_schema:
        typeof r.input_schema === "string"
          ? JSON.parse(r.input_schema as string)
          : (r.input_schema as Record<string, unknown>),
      output_schema:
        typeof r.output_schema === "string"
          ? JSON.parse(r.output_schema as string)
          : (r.output_schema as Record<string, unknown>),
      tags:
        typeof r.tags === "string"
          ? (JSON.parse(r.tags as string) as string[])
          : (r.tags as string[]),
      risk_level: (r.risk_level as 0 | 1 | 2 | 3) ?? 0,
      total_calls: (r.total_calls as number) ?? 0,
      success_rate: (r.success_rate as number) ?? 0,
      avg_duration_ms: (r.avg_duration_ms as number) ?? 0,
      avg_token_cost: (r.avg_token_cost as number) ?? 0,
    }))
  }

  // ─── Repair Memories ──────────────────────────────────────────────────

  upsertRepairRule(rule: RecoveryRule): void {
    if (!this.db) return
    this.db.run(
      `INSERT OR REPLACE INTO ${T.REPAIR} (repair_id, error_category, exact_hash, fuzzy_hash, error_type, core_symbols, condition, recovery_action, success_rate, hit_count, specificity, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      rule.repair_id, rule.category,
      rule.exact_hash ?? rule.repair_id,
      rule.fuzzy_hash ?? rule.repair_id,
      rule.error_type ?? "UnknownError",
      JSON.stringify(rule.core_symbols ?? []),
      rule.condition, rule.recovery_action,
      rule.success_rate, rule.hit_count,
      rule.specificity, rule.created_at,
    )
  }

  getRepairRules(): RecoveryRule[] {
    if (!this.db) return []
    const rows = this.db
      .query(`SELECT * FROM ${T.REPAIR} ORDER BY specificity DESC, success_rate DESC`)
      .all() as Record<string, unknown>[]
    return rows.map((r) => ({
      repair_id: r.repair_id as string,
      tool: "any",
      category: (r.error_category as ErrorCategory) ?? "unknown",
      condition: r.condition as string,
      recovery_action: r.recovery_action as string,
      specificity: (r.specificity as number) ?? 0,
      hit_count: (r.hit_count as number) ?? 0,
      last_hit: Date.now(),
      occurrence_count: 1,
      success_rate: (r.success_rate as number) ?? 0,
      created_at: (r.created_at as number) ?? Date.now(),
      exact_hash: (r.exact_hash as string) ?? (r.repair_id as string),
      fuzzy_hash: (r.fuzzy_hash as string) ?? (r.repair_id as string),
      error_type: (r.error_type as string) ?? "UnknownError",
      core_symbols:
        typeof r.core_symbols === "string"
          ? (JSON.parse(r.core_symbols as string) as string[])
          : ((r.core_symbols as string[]) ?? []),
    }))
  }

  // ─── Memory ───────────────────────────────────────────────────────────

  insertMemory(mem: LongTermMemory): void {
    if (!this.db) return
    this.db.run(
      `INSERT OR REPLACE INTO ${T.MEMORY} (memory_id, session_id, content, token_count, importance, access_count, retention_score, created_at, category, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      mem.memory_id, "global", mem.content, mem.token_count,
      mem.importance, mem.access_count, mem.retention_score,
      mem.created_at, mem.category ?? null,
      mem.tags ? JSON.stringify(mem.tags) : null,
    )
  }

  getMemories(sessionId: string): LongTermMemory[] {
    if (!this.db) return []
    const rows = this.db
      .query(
        `SELECT * FROM ${T.MEMORY} WHERE session_id = ? OR session_id = 'global' ORDER BY retention_score DESC`,
      )
      .all(sessionId) as Record<string, unknown>[]
    return rows.map((r) => ({
      memory_id: r.memory_id as string,
      content: r.content as string,
      token_count: r.token_count as number,
      importance: (r.importance as number) ?? 0.5,
      access_count: (r.access_count as number) ?? 0,
      created_at: (r.created_at as number) ?? Date.now(),
      last_accessed: Date.now(),
      retention_score: (r.retention_score as number) ?? 1,
      category: r.category as string | undefined,
      tags: r.tags ? (JSON.parse(r.tags as string) as string[]) : undefined,
    }))
  }

  searchByTags(tags: string[]): LongTermMemory[] {
    if (!this.db || tags.length === 0) return []
    const likeClauses = tags.map(() => `tags LIKE ?`).join(" OR ")
    const params = tags.map((t) => `%${t}%`)
    const rows = this.db
      .query(
        `SELECT * FROM ${T.MEMORY} WHERE (${likeClauses}) ORDER BY retention_score DESC`,
      )
      .all(...params) as Record<string, unknown>[]
    return rows.map((r) => ({
      memory_id: r.memory_id as string,
      content: r.content as string,
      token_count: r.token_count as number,
      importance: (r.importance as number) ?? 0.5,
      access_count: (r.access_count as number) ?? 0,
      created_at: (r.created_at as number) ?? Date.now(),
      last_accessed: Date.now(),
      retention_score: (r.retention_score as number) ?? 1,
      category: r.category as string | undefined,
      tags: r.tags ? (JSON.parse(r.tags as string) as string[]) : undefined,
    }))
  }

  markSuccessful(memoryId: string): void {
    if (!this.db) return
    this.db.run(
      `UPDATE ${T.MEMORY} SET access_count = access_count + 1, importance = MIN(1.0, importance + 0.05), last_accessed = ? WHERE memory_id = ?`,
      Date.now(), memoryId,
    )
  }

  // ─── Skills ───────────────────────────────────────────────────────────

  upsertSkill(skill: SkillRecord): void {
    if (!this.db) return
    this.db.run(
      `INSERT OR REPLACE INTO ${T.SKILL} (skill_id, trigger_condition, prompt_template, priority, scope, hit_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      skill.skill_id, skill.trigger_condition, skill.prompt_template,
      skill.priority, skill.scope, skill.hit_count, skill.created_at,
    )
  }

  getSkills(): SkillRecord[] {
    if (!this.db) return []
    const rows = this.db
      .query(`SELECT * FROM ${T.SKILL} ORDER BY priority DESC`)
      .all() as Record<string, unknown>[]
    return rows.map((r) => ({
      skill_id: r.skill_id as string,
      trigger_condition: r.trigger_condition as string,
      prompt_template: r.prompt_template as string,
      priority: (r.priority as number) ?? 0,
      scope: (r.scope as "global" | "session" | "task") ?? "session",
      hit_count: (r.hit_count as number) ?? 0,
      created_at: (r.created_at as number) ?? Date.now(),
    }))
  }

  // ─── Branch / Fork Operations ─────────────────────────────────────────

  copyEventLog(sourceSessionId: string, targetSessionId: string): number {
    if (!this.db) return 0
    const events = this.queryEvents(sourceSessionId, undefined, 100_000)
    if (events.length === 0) return 0
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO ${T.EVENT_LOG}
      (event_id, session_id, parent_event_id, event_type, payload, status, token_cost, duration_ms, sequence_index, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    let copied = 0
    this.db.transaction(() => {
      for (const e of events) {
        const newId = `fork_${e.event_id}`
        stmt.run(
          newId, targetSessionId, e.parent_event_id, e.event_type,
          typeof e.payload === "string" ? e.payload : JSON.stringify(e.payload),
          e.status, e.token_cost, e.duration_ms, e.sequence_index, e.timestamp,
        )
        copied++
      }
    })()
    return copied
  }

  copyLatestCheckpoint(sourceSessionId: string, targetSessionId: string): Checkpoint | null {
    const cp = this.getLatestCheckpoint(sourceSessionId)
    if (!cp || !this.db) return null
    const newCp: Checkpoint = {
      ...cp,
      checkpoint_id: `fork_${cp.checkpoint_id}`,
      session_id: targetSessionId,
      created_at: Date.now(),
    }
    this.insertCheckpoint(newCp)
    return newCp
  }

  // ─── Engine Sessions ──────────────────────────────────────────────────

  upsertSession(session: {
    session_id: string
    title?: string
    status: string
    workspace_path?: string
    current_checkpoint_id?: string
  }): void {
    if (!this.db) return
    const now = Date.now()
    this.db.run(
      `INSERT INTO ${T.SESSION} (session_id, title, status, workspace_path, current_checkpoint_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET status=excluded.status, current_checkpoint_id=excluded.current_checkpoint_id, updated_at=excluded.updated_at`,
      session.session_id, session.title ?? null, session.status,
      session.workspace_path ?? null, session.current_checkpoint_id ?? null,
      now, now,
    )
  }

  getSession(sessionId: string): Record<string, unknown> | null {
    if (!this.db) return null
    return this.db
      .query(`SELECT * FROM ${T.SESSION} WHERE session_id = ?`)
      .get(sessionId) as Record<string, unknown> | null
  }

  updateSessionStatus(sessionId: string, status: string, checkpointId?: string): void {
    if (!this.db) return
    if (checkpointId) {
      this.db.run(
        `UPDATE ${T.SESSION} SET status = ?, current_checkpoint_id = ?, updated_at = ? WHERE session_id = ?`,
        status, checkpointId, Date.now(), sessionId,
      )
    } else {
      this.db.run(
        `UPDATE ${T.SESSION} SET status = ?, updated_at = ? WHERE session_id = ?`,
        status, Date.now(), sessionId,
      )
    }
  }

  // ─── Agent Self (Core Rules / L4 Memory) ─────────────────────────────

  upsertAgentSelfRule(rule: CoreRule): void {
    if (!this.db) return
    const now = Date.now()
    this.db.run(
      `INSERT INTO ${T.AGENT_SELF} (rule_id, category, content, token_count, importance, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(rule_id) DO UPDATE SET content=excluded.content, token_count=excluded.token_count, importance=excluded.importance, updated_at=excluded.updated_at`,
      rule.rule_id, rule.category, rule.content, rule.token_count,
      rule.importance, now, now,
    )
  }

  getAgentSelfRules(): CoreRule[] {
    if (!this.db) return []
    const rows = this.db
      .query(`SELECT * FROM ${T.AGENT_SELF} ORDER BY importance DESC`)
      .all() as Record<string, unknown>[]
    return rows.map((r) => ({
      rule_id: r.rule_id as string,
      category: r.category as string,
      content: r.content as string,
      token_count: r.token_count as number,
      importance: (r.importance as number) ?? 0.8,
    }))
  }

  // ─── User Profile (L3/L4 Persistent Memory) ──────────────────────────

  upsertUserProfile(profile: {
    profile_id: string
    user_hash: string
    category: string
    content: string
    token_count: number
    importance: number
  }): void {
    if (!this.db) return
    this.db.run(
      `INSERT INTO ${T.USER_PROFILE} (profile_id, user_hash, category, content, token_count, importance, frequency_score, created_at, last_accessed)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
       ON CONFLICT(profile_id) DO UPDATE SET content=excluded.content, importance=excluded.importance`,
      profile.profile_id, profile.user_hash, profile.category,
      profile.content, profile.token_count, profile.importance,
      Date.now(), Date.now(),
    )
  }

  getUserProfiles(userHash?: string): Array<{
    profile_id: string
    user_hash: string
    category: string
    content: string
    token_count: number
    importance: number
  }> {
    if (!this.db) return []
    const rows = userHash
      ? (this.db
          .query(
            `SELECT * FROM ${T.USER_PROFILE} WHERE user_hash = ? ORDER BY importance DESC`,
          )
          .all(userHash) as Record<string, unknown>[])
      : (this.db
          .query(`SELECT * FROM ${T.USER_PROFILE} ORDER BY importance DESC`)
          .all() as Record<string, unknown>[])
    return rows.map((r) => ({
      profile_id: r.profile_id as string,
      user_hash: r.user_hash as string,
      category: r.category as string,
      content: r.content as string,
      token_count: r.token_count as number,
      importance: (r.importance as number) ?? 0.7,
    }))
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────

  close(): void {
    if (this.external) return
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }
}

// ─── Backend Adapters ───────────────────────────────────────────────────────

export { MemoryBackend } from "./adapters/memory-backend"
export type { MemoryDatabase } from "./adapters/memory-backend"
export { EventArchiveBackend } from "./adapters/event-archive-backend"
export type { ArchiveDatabase, IEventArchiver } from "./adapters/event-archive-backend"
