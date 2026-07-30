import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { Database } from "bun:sqlite"
import {
  EngineDatabase,
  type ISQLiteDatabase,
  type ISQLiteStatement,
} from "../src/index"

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
      (db.run as any)(sql, ...params)
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
})
