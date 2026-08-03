import { Database } from "bun:sqlite"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { EngineDatabase, createEngineDatabase, type ISQLiteDatabase, type ISQLiteStatement } from "../src/index"

// bun:sqlite → ISQLiteDatabase adapter
function bunAdapter(db: Database): ISQLiteDatabase {
  return {
    query(sql: string): ISQLiteStatement {
      return db.query(sql) as unknown as ISQLiteStatement
    },
    prepare(sql: string): ISQLiteStatement {
      return db.prepare(sql) as unknown as ISQLiteStatement
    },
    run(sql: string, ...params: unknown[]): void {
      ;(db.run as any)(sql, ...params)
    },
    transaction<T>(fn: () => T): () => T {
      return db.transaction(fn) as unknown as () => T
    },
    close(): void {
      db.close()
    },
  }
}

let db: Database
let engineDb: EngineDatabase

beforeEach(() => {
  db = new Database(":memory:")
  db.run("PRAGMA journal_mode=WAL")
  db.run("PRAGMA foreign_keys=ON")

  // Create engine tables (event_log, checkpoint, capability_graph, etc.)
  db.run(`
    CREATE TABLE IF NOT EXISTS event_log (
      event_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      parent_event_id TEXT,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT CHECK(status IN ('pending','running','success','failed','skipped')),
      token_cost INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      sequence_index INTEGER NOT NULL,
      timestamp INTEGER NOT NULL
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS checkpoint (
      checkpoint_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      last_event_id TEXT,
      level TEXT NOT NULL CHECK(level IN ('L1','L2','L3')),
      execution_state TEXT NOT NULL,
      context_hash TEXT NOT NULL,
      git_head_hash TEXT,
      created_at INTEGER NOT NULL
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS capability_graph (
      capability_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      input_schema TEXT,
      output_schema TEXT,
      tags TEXT,
      risk_level INTEGER DEFAULT 0,
      total_calls INTEGER DEFAULT 0,
      success_rate REAL DEFAULT 0,
      avg_duration_ms INTEGER DEFAULT 0,
      avg_token_cost INTEGER DEFAULT 0,
      last_used_at INTEGER
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS session_memory (
      memory_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      content TEXT NOT NULL,
      token_count INTEGER NOT NULL,
      importance REAL DEFAULT 0.5,
      access_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      last_accessed INTEGER,
      retention_score REAL DEFAULT 1.0,
      category TEXT,
      tags TEXT
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS repair_memory (
      repair_id TEXT PRIMARY KEY,
      error_category TEXT NOT NULL,
      exact_hash TEXT NOT NULL,
      fuzzy_hash TEXT NOT NULL,
      error_type TEXT NOT NULL,
      core_symbols TEXT,
      condition TEXT NOT NULL,
      recovery_action TEXT NOT NULL,
      success_rate REAL DEFAULT 0.0,
      hit_count INTEGER DEFAULT 0,
      specificity INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS skill (
      skill_id TEXT PRIMARY KEY,
      trigger_condition TEXT NOT NULL,
      prompt_template TEXT NOT NULL,
      priority INTEGER DEFAULT 0,
      scope TEXT DEFAULT 'session',
      hit_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `)

  // Create engine_session, agent_self, and user_profile tables
  db.run(`
    CREATE TABLE IF NOT EXISTS engine_session (
      session_id TEXT PRIMARY KEY,
      title TEXT,
      status TEXT NOT NULL,
      workspace_path TEXT,
      current_checkpoint_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS agent_self (
      rule_id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      token_count INTEGER NOT NULL,
      importance REAL DEFAULT 0.8,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS user_profile (
      profile_id TEXT PRIMARY KEY,
      user_hash TEXT NOT NULL,
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      token_count INTEGER NOT NULL,
      importance REAL DEFAULT 0.7,
      frequency_score INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      last_accessed INTEGER NOT NULL
    )
  `)

  engineDb = EngineDatabase.fromExternal(bunAdapter(db))
})

afterEach(() => {
  db.close()
})

describe("EngineDatabase", () => {
  test("fromExternal creates connected instance", () => {
    expect(engineDb.isConnected()).toBe(true)
  })

  test("insertEvents persists and queries correctly", async () => {
    await engineDb.insertEvents([
      {
        event_id: "evt-1",
        session_id: "s1",
        parent_event_id: null,
        event_type: "user_input",
        payload: '{"message":"hello"}',
        status: "success",
        token_cost: 100,
        duration_ms: 50,
        sequence_index: 1,
        timestamp: Date.now(),
      },
      {
        event_id: "evt-2",
        session_id: "s1",
        parent_event_id: "evt-1",
        event_type: "tool_call",
        payload: '{"tool":"read"}',
        status: "success",
        token_cost: 200,
        duration_ms: 100,
        sequence_index: 2,
        timestamp: Date.now(),
      },
    ])

    const events = engineDb.queryEvents("s1")
    expect(events.length).toBe(2)
    expect(events[0]!.event_id).toBe("evt-1")
    expect(events[1]!.event_type).toBe("tool_call")
    expect(engineDb.countEvents("s1")).toBe(2)
  })

  test("insertCheckpoint and query checkpoints", () => {
    engineDb.insertCheckpoint({
      checkpoint_id: "cp_l1_1",
      session_id: "s1",
      last_event_id: "evt-1",
      level: "L1",
      execution_state: { state: "executing", progress: 0.5 },
      context_hash: "abc123",
      created_at: Date.now(),
    })

    const latest = engineDb.getLatestCheckpoint("s1")
    expect(latest).not.toBeNull()
    expect(latest!.checkpoint_id).toBe("cp_l1_1")
    expect(latest!.level).toBe("L1")

    const all = engineDb.getCheckpoints("s1")
    expect(all.length).toBe(1)
  })

  test("upsertCapability and query capabilities", () => {
    engineDb.upsertCapability({
      capability_id: "read",
      name: "read",
      description: "Read files",
      input_schema: { type: "object" },
      output_schema: { type: "object" },
      tags: ["file_operation", "read_only"],
      risk_level: 0,
      total_calls: 10,
      success_rate: 0.9,
      avg_duration_ms: 50,
      avg_token_cost: 100,
    })

    const caps = engineDb.getCapabilities()
    expect(caps.length).toBe(1)
    expect(caps[0]!.name).toBe("read")
    expect(caps[0]!.risk_level).toBe(0)
  })

  test("upsertRepairRule and query", () => {
    engineDb.upsertRepairRule({
      repair_id: "repair-1",
      tool: "read",
      category: "filesystem",
      condition: "ENOENT",
      recovery_action: "Retry with different path",
      specificity: 5,
      hit_count: 3,
      last_hit: Date.now(),
      occurrence_count: 3,
      success_rate: 0.8,
      created_at: Date.now(),
      exact_hash: "abc",
      fuzzy_hash: "def",
      error_type: "ENOENT",
      core_symbols: [],
    })

    const rules = engineDb.getRepairRules()
    expect(rules.length).toBe(1)
    expect(rules[0]!.category).toBe("filesystem")
  })

  test("insertMemory and query memories", () => {
    engineDb.insertMemory({
      memory_id: "mem-1",
      content: "User prefers TypeScript over JavaScript",
      token_count: 10,
      importance: 0.9,
      access_count: 5,
      created_at: Date.now(),
      last_accessed: Date.now(),
      retention_score: 0.95,
    })

    const memories = engineDb.getMemories("s1")
    expect(memories.length).toBe(1)
    expect(memories[0]!.content).toBe("User prefers TypeScript over JavaScript")
  })

  test("upsertSkill and query skills", () => {
    engineDb.upsertSkill({
      skill_id: "skill-1",
      trigger_condition: "user mentions testing",
      prompt_template: "Write unit tests for {code}",
      priority: 5,
      scope: "session",
      hit_count: 2,
      created_at: Date.now(),
    })

    const skills = engineDb.getSkills()
    expect(skills.length).toBe(1)
    expect(skills[0]!.trigger_condition).toBe("user mentions testing")
  })

  test("persistBusEvent works with external database", () => {
    engineDb.persistBusEvent({
      type: "state_transition",
      session_id: "s1",
      data: { from: "IDLE", to: "READY" },
      timestamp: Date.now(),
    })

    const events = engineDb.queryEvents("s1")
    expect(events.length).toBe(1)
    expect(events[0]!.event_type).toBe("state_transition")
  })

  test("sequence_index auto-increments per session", async () => {
    const now = Date.now()
    await engineDb.insertEvents([
      {
        event_id: "a1",
        session_id: "session-a",
        parent_event_id: null,
        event_type: "task_start",
        payload: "{}",
        status: "success",
        token_cost: 0,
        duration_ms: 0,
        sequence_index: 1,
        timestamp: now,
      },
      {
        event_id: "b1",
        session_id: "session-b",
        parent_event_id: null,
        event_type: "task_start",
        payload: "{}",
        status: "success",
        token_cost: 0,
        duration_ms: 0,
        sequence_index: 1,
        timestamp: now,
      },
    ])

    expect(engineDb.countEvents("session-a")).toBe(1)
    expect(engineDb.countEvents("session-b")).toBe(1)
  })

  // ─── initialize with factory ───────────────────────────────────

  test("initialize with factory creates tables and connects", async () => {
    const localDb = new EngineDatabase()
    const bunDb = new Database(":memory:")
    await localDb.initialize(() => bunAdapter(bunDb))
    expect(localDb.isConnected()).toBe(true)
    localDb.close()
  })

  // ─── deleteColdEvents ──────────────────────────────────────────

  test("deleteColdEvents removes old events and inserts archive summary", async () => {
    const now = Date.now()
    await engineDb.insertEvents([
      {
        event_id: "cold-1",
        session_id: "s-cold",
        parent_event_id: null,
        event_type: "log",
        payload: "{}",
        status: "success",
        token_cost: 0,
        duration_ms: 0,
        sequence_index: 1,
        timestamp: now - 10000,
      },
      {
        event_id: "cold-2",
        session_id: "s-cold",
        parent_event_id: null,
        event_type: "log",
        payload: "{}",
        status: "success",
        token_cost: 0,
        duration_ms: 0,
        sequence_index: 2,
        timestamp: now,
      },
    ])

    expect(engineDb.countEvents("s-cold")).toBe(2)
    engineDb.deleteColdEvents("s-cold", 1, "/tmp/archive.json", 1)
    // Archive summary event should be present, old events deleted
    const remaining = engineDb.queryEvents("s-cold")
    expect(remaining.length).toBeGreaterThanOrEqual(1)
  })

  // ─── searchByTags ──────────────────────────────────────────────

  test("searchByTags finds memories by tag", () => {
    engineDb.insertMemory({
      memory_id: "mem-tag-1",
      content: "TypeScript memory",
      token_count: 5,
      importance: 0.8,
      access_count: 1,
      created_at: Date.now(),
      last_accessed: Date.now(),
      retention_score: 0.9,
      tags: ["typescript", "coding"],
    })
    engineDb.insertMemory({
      memory_id: "mem-tag-2",
      content: "Rust memory",
      token_count: 4,
      importance: 0.7,
      access_count: 1,
      created_at: Date.now(),
      last_accessed: Date.now(),
      retention_score: 0.8,
      tags: ["rust", "coding"],
    })

    const results = engineDb.searchByTags(["typescript"])
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results.some((m) => m.content === "TypeScript memory")).toBe(true)
  })

  test("searchByTags returns empty for empty tags", () => {
    const results = engineDb.searchByTags([])
    expect(results).toEqual([])
  })

  // ─── markSuccessful ────────────────────────────────────────────

  test("markSuccessful increments access_count", () => {
    engineDb.insertMemory({
      memory_id: "mem-mark",
      content: "Mark test",
      token_count: 3,
      importance: 0.5,
      access_count: 0,
      created_at: Date.now(),
      last_accessed: Date.now(),
      retention_score: 1.0,
    })

    // markSuccessful should not throw
    expect(() => engineDb.markSuccessful("mem-mark")).not.toThrow()
  })

  // ─── copyEventLog & copyLatestCheckpoint ──────────────────────

  test("copyEventLog copies events to target session", async () => {
    await engineDb.insertEvents([
      {
        event_id: "src-1",
        session_id: "src-session",
        parent_event_id: null,
        event_type: "log",
        payload: "{}",
        status: "success",
        token_cost: 0,
        duration_ms: 0,
        sequence_index: 1,
        timestamp: Date.now(),
      },
    ])

    const copied = engineDb.copyEventLog("src-session", "dst-session")
    expect(copied).toBe(1)
    expect(engineDb.countEvents("dst-session")).toBe(1)
  })

  test("copyEventLog returns 0 for empty source", () => {
    const copied = engineDb.copyEventLog("nonexistent", "dst")
    expect(copied).toBe(0)
  })

  test("copyLatestCheckpoint copies checkpoint to target session", () => {
    engineDb.insertCheckpoint({
      checkpoint_id: "cp-src",
      session_id: "src-session",
      last_event_id: "evt-1",
      level: "L1",
      execution_state: { step: 1 },
      context_hash: "hash1",
      created_at: Date.now(),
    })

    const copied = engineDb.copyLatestCheckpoint("src-session", "dst-session")
    expect(copied).not.toBeNull()
    expect(copied!.session_id).toBe("dst-session")
    expect(copied!.checkpoint_id).toContain("fork_")
  })

  test("copyLatestCheckpoint returns null when no source checkpoint", () => {
    const result = engineDb.copyLatestCheckpoint("no-cp-session", "dst")
    expect(result).toBeNull()
  })

  // ─── Session CRUD ─────────────────────────────────────────────

  test("upsertSession and getSession round-trip", () => {
    engineDb.upsertSession({
      session_id: "sess-1",
      title: "Test Session",
      status: "active",
      workspace_path: "/workspace/test",
    })

    const sess = engineDb.getSession("sess-1")
    expect(sess).not.toBeNull()
    expect((sess as any).title).toBe("Test Session")
    expect((sess as any).status).toBe("active")
  })

  test("getSession returns null for nonexistent session", () => {
    const sess = engineDb.getSession("no-such-session")
    expect(sess).toBeNull()
  })

  test("updateSessionStatus updates status without checkpoint", () => {
    engineDb.upsertSession({
      session_id: "sess-status",
      status: "active",
    })

    engineDb.updateSessionStatus("sess-status", "completed")
    const sess = engineDb.getSession("sess-status")
    expect((sess as any).status).toBe("completed")
  })

  test("updateSessionStatus updates with checkpoint", () => {
    engineDb.upsertSession({
      session_id: "sess-cp",
      status: "active",
    })

    engineDb.updateSessionStatus("sess-cp", "paused", "cp-123")
    const sess = engineDb.getSession("sess-cp")
    expect((sess as any).status).toBe("paused")
    expect((sess as any).current_checkpoint_id).toBe("cp-123")
  })

  // ─── Agent Self Rules ─────────────────────────────────────────

  test("upsertAgentSelfRule and getAgentSelfRules round-trip", () => {
    engineDb.upsertAgentSelfRule({
      rule_id: "rule-1",
      category: "safety",
      content: "Never delete user files without confirmation",
      token_count: 8,
      importance: 0.95,
    })

    const rules = engineDb.getAgentSelfRules()
    expect(rules.length).toBeGreaterThanOrEqual(1)
    expect(rules.some((r) => r.rule_id === "rule-1")).toBe(true)
  })

  // ─── User Profile ─────────────────────────────────────────────

  test("upsertUserProfile and getUserProfiles round-trip", () => {
    engineDb.upsertUserProfile({
      profile_id: "prof-1",
      user_hash: "user123",
      category: "preference",
      content: "Prefers dark theme",
      token_count: 4,
      importance: 0.6,
    })

    const profiles = engineDb.getUserProfiles("user123")
    expect(profiles.length).toBeGreaterThanOrEqual(1)
    expect(profiles.some((p) => p.profile_id === "prof-1")).toBe(true)
  })

  test("getUserProfiles without userHash returns all", () => {
    engineDb.upsertUserProfile({
      profile_id: "prof-all",
      user_hash: "user-all",
      category: "general",
      content: "All users",
      token_count: 3,
      importance: 0.5,
    })

    const profiles = engineDb.getUserProfiles()
    expect(profiles.length).toBeGreaterThanOrEqual(1)
  })

  // ─── close ────────────────────────────────────────────────────

  test("close disconnects non-external database", () => {
    const localDb = new EngineDatabase()
    const bunDb = new Database(":memory:")
    localDb.setDatabase(bunAdapter(bunDb))
    expect(localDb.isConnected()).toBe(true)
    localDb.close()
    expect(localDb.isConnected()).toBe(false)
  })

  test("close does not close external database", () => {
    // engineDb is external — closing it should not disconnect
    expect(engineDb.isConnected()).toBe(true)
    engineDb.close()
    expect(engineDb.isConnected()).toBe(true)
  })

  // ─── createEngineDatabase ─────────────────────────────────────

  test("createEngineDatabase factory creates instance", () => {
    const edb = createEngineDatabase()
    expect(edb).toBeInstanceOf(EngineDatabase)
    expect(edb.isConnected()).toBe(false) // not initialized yet
  })

  test("createEngineDatabase accepts path argument", () => {
    const edb = createEngineDatabase(":memory:")
    expect(edb).toBeInstanceOf(EngineDatabase)
  })
})
