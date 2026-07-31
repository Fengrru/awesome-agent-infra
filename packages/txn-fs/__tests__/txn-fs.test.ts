import { beforeEach, describe, expect, test } from "bun:test"
import { type FileTransaction, GitTransactionManager, threeWayMerge } from "../src/index"

describe("GitTransactionManager (in-memory)", () => {
  let txm: GitTransactionManager

  beforeEach(() => {
    txm = new GitTransactionManager()
  })

  // ─── Basic Lifecycle ───────────────────────────────────────────────────────

  test("begin creates active transaction with baseline hashes", () => {
    const tx = txm.begin("session-1", [
      { path: "a.ts", content: "const a = 1" },
      { path: "b.ts", content: "const b = 2" },
    ])
    expect(tx.status).toBe("active")
    expect(tx.sessionId).toBe("session-1")
    expect(tx.affectedFiles).toEqual(["a.ts", "b.ts"])
    expect(Object.keys(tx.baselineHash)).toHaveLength(2)
  })

  test("propose updates staging content", () => {
    const tx = txm.begin("s1", [{ path: "a.ts", content: "original" }])
    txm.propose("a.ts", "modified")
    const result = txm.validate(tx)
    expect(result.valid).toBe(false)
  })

  test("validate passes when workspace unchanged", () => {
    const tx = txm.begin("s1", [{ path: "a.ts", content: "hello" }])
    const result = txm.validate(tx)
    expect(result.valid).toBe(true)
    expect(tx.status).toBe("validated")
  })

  test("validate fails when workspace was modified (TOCTOU)", () => {
    const tx = txm.begin("s1", [{ path: "a.ts", content: "hello" }])
    txm.propose("a.ts", "someone else changed it")
    const result = txm.validate(tx)
    expect(result.valid).toBe(false)
    expect(result.reason).toBe("WORKSPACE_MODIFIED")
  })

  test("commit succeeds when workspace unchanged", () => {
    const tx = txm.begin("s1", [{ path: "a.ts", content: "original" }])
    txm.propose("a.ts", "new content")
    const result = txm.commit(tx, () => "original")
    expect(result.status).toBe("SUCCESS")
    expect(tx.status).toBe("committed")
  })

  test("commit detects TOCTOU race when file changed externally", () => {
    const tx = txm.begin("s1", [{ path: "a.ts", content: "original" }])
    txm.propose("a.ts", "our change")
    const result = txm.commit(tx, () => "externally modified")
    expect(result.status).toBe("CONFLICT")
    expect(result.reason).toBe("TOCTOU_RACE_DETECTED")
    expect(tx.status).toBe("conflict")
  })

  test("rollback clears staging and resets transaction", () => {
    const tx = txm.begin("s1", [{ path: "a.ts", content: "hello" }])
    txm.propose("a.ts", "changed")
    txm.rollback(tx)
    expect(tx.status).toBe("rolled_back")
    expect(txm.getActiveTransaction()).toBeNull()
  })

  // ─── Three-Way Merge ──────────────────────────────────────────────────────

  test("clean merge: only ours changed", () => {
    const result = threeWayMerge("base\n", "ours\n", "base\n")
    expect(result.hasConflicts).toBe(false)
    expect(result.content).toBe("ours\n")
  })

  test("clean merge: only theirs changed", () => {
    const result = threeWayMerge("base\n", "base\n", "theirs\n")
    expect(result.hasConflicts).toBe(false)
    expect(result.content).toBe("theirs\n")
  })

  test("clean merge: both identical", () => {
    const result = threeWayMerge("base\n", "same\n", "same\n")
    expect(result.hasConflicts).toBe(false)
    expect(result.content).toBe("same\n")
  })

  test("conflict: both sides modify same lines", () => {
    const result = threeWayMerge("line1\nline2\nline3\n", "line1\nours-line2\nline3\n", "line1\ntheirs-line2\nline3\n")
    expect(result.hasConflicts).toBe(true)
    expect(result.markers.length).toBeGreaterThan(0)
    expect(result.content).toContain("<<<<<<< OUR")
    expect(result.content).toContain(">>>>>>> THEIR")
  })

  test("clean merge: different regions modified", () => {
    const base = "line1\nline2\nline3\nline4\nline5\n"
    const ours = "line1\nours-2\nline3\nline4\nline5\n"
    const theirs = "line1\nline2\nline3\nline4\ntheirs-5\n"
    const result = threeWayMerge(base, ours, theirs)
    expect(result.hasConflicts).toBe(false)
    expect(result.content).toContain("ours-2")
    expect(result.content).toContain("theirs-5")
  })

  // ─── Boundary Cases ────────────────────────────────────────────────────────

  test("empty file content", () => {
    const tx = txm.begin("s1", [{ path: "empty.ts", content: "" }])
    const result = txm.validate(tx)
    expect(result.valid).toBe(true)
  })

  test("multiple files in single transaction", () => {
    const files = [
      { path: "a.ts", content: "a" },
      { path: "b.ts", content: "b" },
      { path: "c.ts", content: "c" },
    ]
    const tx = txm.begin("s1", files)
    txm.propose("a.ts", "new-a")
    txm.propose("b.ts", "new-b")
    txm.propose("c.ts", "new-c")

    const contentMap = { "a.ts": "a", "b.ts": "b", "c.ts": "c" }
    const result = txm.commit(tx, (f) => contentMap[f as keyof typeof contentMap])
    expect(result.status).toBe("SUCCESS")
  })

  test("transaction ID is unique across calls", () => {
    const tx1 = txm.begin("s1", [{ path: "a.ts", content: "a" }])
    txm.rollback(tx1)
    const tx2 = txm.begin("s1", [{ path: "a.ts", content: "a" }])
    expect(tx1.id).not.toBe(tx2.id)
  })

  test("getActiveTransaction returns current transaction", () => {
    expect(txm.getActiveTransaction()).toBeNull()
    const tx = txm.begin("s1", [{ path: "a.ts", content: "a" }])
    expect(txm.getActiveTransaction()).toBe(tx)
    txm.rollback(tx)
    expect(txm.getActiveTransaction()).toBeNull()
  })
})
