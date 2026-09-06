import { Database } from "bun:sqlite"
import { describe, expect, test } from "bun:test"
import { DataCorruptionError, type NewKnowledgeObject, SqliteSelfStore } from "../src/index.js"

function makeStore(): SqliteSelfStore {
  return new SqliteSelfStore(new Database(":memory:"))
}

function newMemory(content: unknown, evidence: string[] = []): NewKnowledgeObject {
  return {
    kind: "memory",
    content,
    provenance: { source: "human", refs: [], created: 0 },
    evidence,
    verification: { status: "unverified", check: null, lastVerifiedAt: null },
    ttl: null,
    state: "draft",
    metrics: { uses: 0, successes: 0, lastUsedAt: null },
  }
}

describe("SqliteSelfStore", () => {
  test("add assigns content-hash id and version 1", () => {
    const store = makeStore()
    const obj = store.add("project:rules", newMemory({ a: 1 }))
    expect(obj.version).toBe(1)
    expect(obj.name).toBe("project:rules")
    expect(obj.parentId).toBeNull()
  })

  test("re-adding identical content is idempotent", () => {
    const store = makeStore()
    const v1 = store.add("k", newMemory({ a: 1 }))
    const again = store.add("k", newMemory({ a: 1 }))
    expect(again.id).toBe(v1.id)
    expect(again.version).toBe(1)
    expect(store.history("memory", "k")).toHaveLength(1)
  })

  test("second add creates a new version linked by parentId", () => {
    const store = makeStore()
    const v1 = store.add("k", newMemory({ a: 1 }))
    const v2 = store.add("k", newMemory({ a: 2 }))
    expect(v2.version).toBe(2)
    expect(v2.parentId).toBe(v1.id)
    expect(v2.id).not.toBe(v1.id)
  })

  test("history returns newest-first", () => {
    const store = makeStore()
    store.add("k", newMemory("v1"))
    store.add("k", newMemory("v2"))
    store.add("k", newMemory("v3"))
    expect(store.history("memory", "k").map((h) => h.version)).toEqual([3, 2, 1])
  })

  test("get returns latest version and preserves old versions", () => {
    const store = makeStore()
    store.add("k", newMemory("v1"))
    store.add("k", newMemory("v2"))
    expect(store.get("memory", "k")?.content).toBe("v2")
    expect(store.history("memory", "k")).toHaveLength(2)
  })

  test("findById returns a stored object or null", () => {
    const store = makeStore()
    const v1 = store.add("k", newMemory("x"))
    expect(store.findById(v1.id)?.content).toBe("x")
    expect(store.findById("missing")).toBeNull()
  })

  test("evidence is preserved across versions", () => {
    const store = makeStore()
    store.add("k", newMemory("v1", ["e1"]))
    const v2 = store.add("k", newMemory("v2", ["e2", "e3"]))
    expect(v2.evidence).toEqual(["e2", "e3"])
  })

  test("recordOutcome updates metrics on the latest version only", () => {
    const store = makeStore()
    const v1 = store.add("k", newMemory("v1"))
    store.add("k", newMemory("v2"))
    store.recordOutcome("memory", "k", true)
    store.recordOutcome("memory", "k", false)
    const latest = store.get("memory", "k")!
    const first = store.history("memory", "k").at(-1)!
    expect(latest.metrics.uses).toBe(2)
    expect(latest.metrics.successes).toBe(1)
    expect(first.id).toBe(v1.id)
    expect(first.metrics.uses).toBe(0)
  })

  test("touch updates uses and lastUsedAt", () => {
    const store = makeStore()
    store.add("k", newMemory("v1"))
    store.touch("memory", "k")
    const latest = store.get("memory", "k")!
    expect(latest.metrics.uses).toBe(1)
    expect(latest.metrics.lastUsedAt).toBeGreaterThan(0)
  })

  test("setVerification persists status and timestamp", () => {
    const store = makeStore()
    store.add("k", newMemory("v1"))
    store.setVerification("memory", "k", "verified", 1234)
    const obj = store.get("memory", "k")!
    expect(obj.verification.status).toBe("verified")
    expect(obj.verification.lastVerifiedAt).toBe(1234)
  })

  test("setState persists state", () => {
    const store = makeStore()
    store.add("k", newMemory("v1"))
    store.setState("memory", "k", "active")
    const obj = store.get("memory", "k")!
    expect(obj.state).toBe("active")
  })

  test("dependentsOf follows derivation edges", () => {
    const store = makeStore()
    const upstream = store.add("parent", newMemory("parent"))
    const derived: NewKnowledgeObject = {
      ...newMemory("child"),
      provenance: { source: "human", refs: [{ knowledgeId: upstream.id }], created: 0 },
    }
    const child = store.add("child", derived)
    expect(store.dependentsOf(upstream.id)).toEqual([child.id])
    expect(store.dependentsOf("orphan")).toEqual([])
  })

  test("all returns every version of every entry", () => {
    const store = makeStore()
    store.add("a", newMemory("a1"))
    store.add("a", newMemory("a2"))
    store.add("b", newMemory("b1"))
    expect(store.all()).toHaveLength(3)
  })

  test("latest returns the newest version per entry", () => {
    const store = makeStore()
    store.add("a", newMemory("a1"))
    store.add("a", newMemory("a2"))
    store.add("b", newMemory("b1"))
    const latest = store.latest()
    expect(latest).toHaveLength(2)
    expect(latest.map((o) => o.content as string).sort()).toEqual(["a2", "b1"])
  })

  test("latestTrusted omits draft-only entries", () => {
    const store = makeStore()
    store.add("draft-only", newMemory("x"))
    store.add("trusted", newMemory("t"))
    store.setState("memory", "trusted", "active")
    const trusted = store.latestTrusted()
    expect(trusted).toHaveLength(1)
    expect(trusted[0].name).toBe("trusted")
  })

  test("throws DataCorruptionError on malformed row", () => {
    const db = new Database(":memory:")
    const store = new SqliteSelfStore(db)
    store.add("k", newMemory("v1"))
    db.query("UPDATE knowledge SET verification_status = ? WHERE id = (SELECT id FROM knowledge LIMIT 1)").run(
      "not-a-status",
    )
    expect(() => store.get("memory", "k")).toThrow(DataCorruptionError)
  })

  test("survives constructing on a database that already has the schema", () => {
    const db = new Database(":memory:")
    const first = new SqliteSelfStore(db)
    first.add("k", newMemory("v1"))
    const second = new SqliteSelfStore(db)
    expect(second.get("memory", "k")?.content).toBe("v1")
  })

  test("warns when the unique index cannot be created due to legacy duplicates", () => {
    const db = new Database(":memory:")
    const first = new SqliteSelfStore(db)
    first.add("k", newMemory("v1"))
    db.query("DROP INDEX IF EXISTS knowledge_kind_name_version").run()
    db.query(
      `INSERT INTO knowledge (id,name,kind,version,parent_id,content,source,refs,evidence,verification_status,verification_check,last_verified_at,ttl,state,uses,successes,last_used_at,created)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      "dup",
      "k",
      "memory",
      1,
      null,
      JSON.stringify({}),
      "human",
      "[]",
      "[]",
      "unverified",
      null,
      null,
      null,
      "draft",
      0,
      0,
      null,
      0,
    )
    expect(() => new SqliteSelfStore(db)).not.toThrow()
  })
})
