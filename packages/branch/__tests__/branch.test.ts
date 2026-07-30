import { describe, expect, test } from "bun:test"
import {
  BranchManager,
  type BranchDatabase,
  type SessionBranch,
  type BranchStatus,
} from "../src/index"

function makeDB(): BranchDatabase & { copyLogCalls: number; copyCheckpointCalls: number } {
  return {
    copyLogCalls: 0,
    copyCheckpointCalls: 0,
    async copyEventLog(_src: string, _tgt: string) {
      this.copyLogCalls++
    },
    async copyLatestCheckpoint(_src: string, _tgt: string) {
      this.copyCheckpointCalls++
    },
  }
}

describe("BranchManager", () => {
  // ── fork ───────────────────────────────────────────────────────────────

  test("fork creates a branch with active status", async () => {
    const manager = new BranchManager()
    const branch = await manager.fork("main")
    expect(branch.status).toBe("active")
    expect(branch.sessionId).toBe("session_main")
    expect(branch.branchId).toMatch(/^branch_/)
    expect(branch.createdAt).toBeGreaterThan(0)
  })

  test("fork creates branches with unique IDs", async () => {
    const manager = new BranchManager()
    const a = await manager.fork("main")
    const b = await manager.fork("main")
    expect(a.branchId).not.toBe(b.branchId)
  })

  test("fork with metadata preserves metadata", async () => {
    const manager = new BranchManager()
    const branch = await manager.fork("main", null, { priority: "high", tags: ["experiment"] })
    expect(branch.metadata).toEqual({ priority: "high", tags: ["experiment"] })
  })

  test("fork with parent branch ID stores the parent", async () => {
    const manager = new BranchManager()
    const parent = await manager.fork("main")
    const child = await manager.fork("main", parent.branchId)
    expect(child.parentBranchId).toBe(parent.branchId)
  })

  test("fork calls database copy methods when database is set", async () => {
    const db = makeDB()
    const manager = new BranchManager(db)
    const branch = await manager.fork("main")
    expect(db.copyLogCalls).toBe(1)
    expect(db.copyCheckpointCalls).toBe(1)
  })

  // ── getBranch / listBranches ───────────────────────────────────────────

  test("getBranch retrieves a branch by ID", async () => {
    const manager = new BranchManager()
    const created = await manager.fork("main")
    const retrieved = manager.getBranch(created.branchId)
    expect(retrieved).toBeDefined()
    expect(retrieved!.branchId).toBe(created.branchId)
  })

  test("getBranch returns undefined for unknown ID", () => {
    const manager = new BranchManager()
    expect(manager.getBranch("nonexistent")).toBeUndefined()
  })

  test("listBranches filters by sessionId", async () => {
    const manager = new BranchManager()
    await manager.fork("alpha")
    await manager.fork("alpha")
    await manager.fork("beta")

    const alphaBranches = manager.listBranches("alpha")
    expect(alphaBranches.length).toBe(2)
    const betaBranches = manager.listBranches("beta")
    expect(betaBranches.length).toBe(1)
  })

  test("listBranches filters by status", async () => {
    const manager = new BranchManager()
    const a = await manager.fork("main")
    const b = await manager.fork("main")
    manager.abandonBranch(b.branchId)

    const active = manager.listBranches("main", "active")
    expect(active.length).toBe(1)
    expect(active[0]!.branchId).toBe(a.branchId)

    const abandoned = manager.listBranches("main", "abandoned")
    expect(abandoned.length).toBe(1)
    expect(abandoned[0]!.branchId).toBe(b.branchId)
  })

  // ── mergeBranch / abandonBranch ────────────────────────────────────────

  test("mergeBranch changes status to merged and sets mergedAt", async () => {
    const manager = new BranchManager()
    const branch = await manager.fork("main")
    const merged = manager.mergeBranch(branch.branchId)
    expect(merged).toBeDefined()
    expect(merged!.status).toBe("merged")
    expect(merged!.mergedAt).toBeGreaterThan(0)
  })

  test("mergeBranch returns undefined for already merged branch", async () => {
    const manager = new BranchManager()
    const branch = await manager.fork("main")
    manager.mergeBranch(branch.branchId)
    const doubleMerge = manager.mergeBranch(branch.branchId)
    expect(doubleMerge).toBeUndefined()
  })

  test("abandonBranch changes status to abandoned and sets abandonedAt", async () => {
    const manager = new BranchManager()
    const branch = await manager.fork("main")
    const abandoned = manager.abandonBranch(branch.branchId)
    expect(abandoned).toBeDefined()
    expect(abandoned!.status).toBe("abandoned")
    expect(abandoned!.abandonedAt).toBeGreaterThan(0)
  })

  test("abandonBranch returns undefined for non-active branch", async () => {
    const manager = new BranchManager()
    const branch = await manager.fork("main")
    manager.abandonBranch(branch.branchId)
    const doubleAbandon = manager.abandonBranch(branch.branchId)
    expect(doubleAbandon).toBeUndefined()
  })

  // ── getActiveBranches ──────────────────────────────────────────────────

  test("getActiveBranches returns only active branches", async () => {
    const manager = new BranchManager()
    const a = await manager.fork("main")
    const b = await manager.fork("main")
    const c = await manager.fork("main")

    manager.mergeBranch(b.branchId)
    manager.abandonBranch(c.branchId)

    const active = manager.getActiveBranches("main")
    expect(active.length).toBe(1)
    expect(active[0]!.branchId).toBe(a.branchId)
  })

  test("getActiveBranches without sessionId returns all active branches across sessions", async () => {
    const manager = new BranchManager()
    await manager.fork("alpha")
    await manager.fork("beta")
    const c = await manager.fork("gamma")
    manager.mergeBranch(c.branchId)

    const active = manager.getActiveBranches()
    expect(active.length).toBe(2)
  })

  // ── count ──────────────────────────────────────────────────────────────

  test("count tracks total branches", async () => {
    const manager = new BranchManager()
    expect(manager.count()).toBe(0)
    await manager.fork("main")
    expect(manager.count()).toBe(1)
    await manager.fork("main")
    expect(manager.count()).toBe(2)
  })
})
