import { describe, expect, test } from "bun:test"
import {
  CheckpointManager,
  type Checkpoint,
  type CheckpointDatabase,
  type L1Snapshot,
  type L2Snapshot,
  type L3Snapshot,
} from "../src/index"

function makeL1(overrides?: Partial<L1Snapshot>): L1Snapshot {
  return {
    state_machine: { current_state: "EXECUTING", previous_state: "PLANNING", transition_count: 4 },
    dag_progress: {
      version: 1,
      total_nodes: 3,
      completed_nodes: 1,
      failed_nodes: 0,
      node_statuses: { a: "completed", b: "running", c: "pending" },
    },
    pending_queue: ["b", "c"],
    workspace_hash: "hash-1",
    ...overrides,
  }
}

function makeL2(): L2Snapshot {
  return {
    l1_data: makeL1(),
    context_summary: {
      system_prompt_ref: "sp-1",
      key_conclusions: [{ text: "conclusion", confidence: 0.9 }],
      recent_messages: [{ event_id: "e1", sequence_index: 0, summary: "msg", token_count: 10 }],
      file_contexts: [{ file_path: "a.ts", content_hash: "h", relevant_lines: [1, 10], summary: "file" }],
    },
    dag_full: { nodes: [] },
    memory_pointers: [{ memory_id: "m1", memory_type: "session", relevance_score: 0.8 }],
  }
}

function makeL3(): L3Snapshot {
  return {
    l2_data: makeL2(),
    archive_reference: { archive_path: "/tmp/archive", event_count: 100, sequence_range: [0, 99] },
    session_metadata: {
      title: "t", goal: "g", total_events: 100, total_tokens: 5000,
      duration_ms: 60000, created_at: Date.now(),
    },
  }
}

/** In-memory fake database */
class FakeDB implements CheckpointDatabase {
  inserted: Checkpoint[] = []
  connected = true
  insertCheckpoint(cp: Checkpoint): void { this.inserted.push(cp) }
  getLatestCheckpoint(sessionId: string, level?: string): Checkpoint | null {
    const matches = this.inserted.filter(
      (cp) => cp.session_id === sessionId && (!level || cp.level === level),
    )
    return matches.at(-1) ?? null
  }
  getCheckpoints(sessionId: string): Checkpoint[] {
    return this.inserted.filter((cp) => cp.session_id === sessionId)
  }
  isConnected(): boolean { return this.connected }
}

describe("checkpoint creation", () => {
  test("createL1 stores snapshot with metadata", () => {
    const mgr = new CheckpointManager()
    const cp = mgr.createL1("s1", makeL1(), "ctx-hash", "evt-9")
    expect(cp.level).toBe("L1")
    expect(cp.session_id).toBe("s1")
    expect(cp.last_event_id).toBe("evt-9")
    expect(cp.context_hash).toBe("ctx-hash")
    expect(cp.checkpoint_id).toContain("_L1")
    expect((cp.execution_state as unknown as L1Snapshot).workspace_hash).toBe("hash-1")
  })

  test("createL2 records git head hash", () => {
    const mgr = new CheckpointManager()
    const cp = mgr.createL2("s1", makeL2(), "ctx", "git-abc", "evt-1")
    expect(cp.level).toBe("L2")
    expect(cp.git_head_hash).toBe("git-abc")
  })

  test("createL3 has empty last_event_id by design", () => {
    const mgr = new CheckpointManager()
    const cp = mgr.createL3("s1", makeL3(), "ctx")
    expect(cp.level).toBe("L3")
    expect(cp.last_event_id).toBe("")
  })
})

describe("size validation", () => {
  test("getCheckpointSize measures serialized bytes", () => {
    const mgr = new CheckpointManager()
    const snapshot = makeL1()
    const size = mgr.getCheckpointSize(snapshot)
    expect(size).toBe(new TextEncoder().encode(JSON.stringify(snapshot)).length)
    expect(size).toBeGreaterThan(0)
  })

  test("validateSize passes under the limit", () => {
    const mgr = new CheckpointManager()
    const result = mgr.validateSize("L1", 1024)
    expect(result.ok).toBe(true)
    expect(result.limitBytes).toBe(CheckpointManager.L1_MAX_BYTES)
    expect(result.warning).toBeUndefined()
  })

  test("validateSize warns when exceeding per-level limits", () => {
    const mgr = new CheckpointManager()
    const l1 = mgr.validateSize("L1", CheckpointManager.L1_MAX_BYTES + 1)
    expect(l1.ok).toBe(false)
    expect(l1.warning).toContain("L1")

    const l3 = mgr.validateSize("L3", CheckpointManager.L3_MAX_BYTES + 1)
    expect(l3.ok).toBe(false)
  })

  test("L3 limit is smaller than L1 and L2 limits", () => {
    expect(CheckpointManager.L3_MAX_BYTES).toBeLessThan(CheckpointManager.L1_MAX_BYTES)
    expect(CheckpointManager.L1_MAX_BYTES).toBeLessThan(CheckpointManager.L2_MAX_BYTES)
  })
})

describe("count limits", () => {
  test("L1 retains at most 10 checkpoints", () => {
    const mgr = new CheckpointManager()
    for (let i = 0; i < 12; i++) mgr.createL1("s1", makeL1(), `ctx-${i}`, `evt-${i}`)
    const l1s = mgr.getAllCheckpoints().filter((cp) => cp.level === "L1")
    expect(l1s.length).toBe(10)
    // oldest were dropped
    expect(l1s[0]!.context_hash).toBe("ctx-2")
  })

  test("L2 retains at most 5 checkpoints", () => {
    const mgr = new CheckpointManager()
    for (let i = 0; i < 7; i++) mgr.createL2("s1", makeL2(), `ctx-${i}`, "git", `evt-${i}`)
    expect(mgr.getAllCheckpoints().filter((cp) => cp.level === "L2").length).toBe(5)
  })
})

describe("getLatest", () => {
  test("returns most recent checkpoint for a session", () => {
    const mgr = new CheckpointManager()
    mgr.createL1("s1", makeL1(), "first", "e1")
    mgr.createL1("s1", makeL1(), "second", "e2")
    expect(mgr.getLatest("s1")!.context_hash).toBe("second")
  })

  test("filters by level", () => {
    const mgr = new CheckpointManager()
    mgr.createL1("s1", makeL1(), "l1-hash", "e1")
    mgr.createL2("s1", makeL2(), "l2-hash", "git", "e2")
    expect(mgr.getLatest("s1", "L1")!.context_hash).toBe("l1-hash")
    expect(mgr.getLatest("s1", "L2")!.context_hash).toBe("l2-hash")
    expect(mgr.getLatest("s1", "L3")).toBeNull()
  })

  test("isolates sessions", () => {
    const mgr = new CheckpointManager()
    mgr.createL1("s1", makeL1(), "ctx", "e1")
    expect(mgr.getLatest("other")).toBeNull()
  })

  test("falls back to database when memory is empty", () => {
    const mgr = new CheckpointManager()
    const db = new FakeDB()
    db.inserted.push({
      checkpoint_id: "cp-db", session_id: "s1", last_event_id: "e0",
      level: "L1", execution_state: {}, context_hash: "from-db", created_at: 1,
    })
    mgr.setDatabase(db)
    expect(mgr.getLatest("s1")!.context_hash).toBe("from-db")
  })
})

describe("database persistence", () => {
  test("checkpoints are persisted to a connected database", () => {
    const mgr = new CheckpointManager()
    const db = new FakeDB()
    mgr.setDatabase(db)
    mgr.createL1("s1", makeL1(), "ctx", "e1")
    expect(db.inserted.length).toBe(1)
    expect(db.inserted[0]!.session_id).toBe("s1")
  })

  test("disconnected database is skipped without error", () => {
    const mgr = new CheckpointManager()
    const db = new FakeDB()
    db.connected = false
    mgr.setDatabase(db)
    mgr.createL1("s1", makeL1(), "ctx", "e1")
    expect(db.inserted.length).toBe(0)
  })
})

describe("clear and cache accounting", () => {
  test("clear removes all checkpoints and cache bytes", () => {
    const mgr = new CheckpointManager()
    mgr.createL1("s1", makeL1(), "ctx", "e1")
    expect(mgr.getAllCheckpoints().length).toBe(1)
    expect(mgr.getCacheMemoryBytes()).toBeGreaterThan(0)
    mgr.clear()
    expect(mgr.getAllCheckpoints()).toEqual([])
    expect(mgr.getCacheMemoryBytes()).toBe(0)
  })
})
