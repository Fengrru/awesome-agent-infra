import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type FileTransaction,
  type IFileSystem,
  RealGitTransactionManager,
  createRealGitTransactionManager,
} from "../src/index.js"

// ─── In-memory IFileSystem mock ─────────────────────────────────────────────

class MemFS implements IFileSystem {
  files = new Map<string, string>()
  head = "commit-1"
  blobs = new Map<string, string>()

  async readFile(path: string): Promise<string> {
    return this.files.get(path) ?? ""
  }
  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content)
  }
  async exists(path: string): Promise<boolean> {
    return this.files.has(path)
  }
  isGitRepo(): boolean {
    return true
  }
  async getGitHead(): Promise<string> {
    return this.head
  }
  async getGitBlob(commit: string, file: string): Promise<string> {
    return this.blobs.get(`${commit}:${file}`) ?? ""
  }
  async execGit(_args: string[]): Promise<{ exitCode: number; stdout: string }> {
    return { exitCode: 0, stdout: "" }
  }
}

function makeManager(): { manager: RealGitTransactionManager; fs: MemFS } {
  const fs = new MemFS()
  const manager = new RealGitTransactionManager("/repo")
  manager.setFileSystem(fs)
  return { manager, fs }
}

// ─── RealGitTransactionManager (mock backend) ───────────────────────────────

describe("RealGitTransactionManager", () => {
  test("begin snapshots baseline hashes and git head", async () => {
    const { manager, fs } = makeManager()
    fs.files.set("a.txt", "hello")

    const tx = await manager.begin("session-1", ["a.txt"])
    expect(tx.status).toBe("active")
    expect(tx.sessionId).toBe("session-1")
    expect(tx.baselineGitHead).toBe("commit-1")
    expect(tx.affectedFiles).toEqual(["a.txt"])
    expect(tx.baselineHash["a.txt"]).toMatch(/^[0-9a-f]{64}$/)
    expect(manager.getActiveTransaction()).toBe(tx)
  })

  test("validate passes when files are untouched", async () => {
    const { manager, fs } = makeManager()
    fs.files.set("a.txt", "hello")

    const tx = await manager.begin("s", ["a.txt"])
    const result = await manager.validate(tx)
    expect(result.valid).toBe(true)
    expect(tx.status).toBe("validated")
  })

  test("validate detects external modification", async () => {
    const { manager, fs } = makeManager()
    fs.files.set("a.txt", "hello")

    const tx = await manager.begin("s", ["a.txt"])
    fs.files.set("a.txt", "tampered")

    const result = await manager.validate(tx)
    expect(result.valid).toBe(false)
    expect(result.file).toBe("a.txt")
    expect(result.reason).toBe("WORKSPACE_MODIFIED")
  })

  test("commit writes proposed content and fires onCommit", async () => {
    const { manager, fs } = makeManager()
    fs.files.set("a.txt", "hello")
    let committed: FileTransaction | null = null
    manager.setEventCallbacks({ onCommit: (tx) => void (committed = tx) })

    const tx = await manager.begin("s", ["a.txt"])
    manager.propose("a.txt", "updated")

    const result = await manager.commit(tx)
    expect(result.status).toBe("SUCCESS")
    expect(tx.status).toBe("committed")
    expect(fs.files.get("a.txt")).toBe("updated")
    expect(committed).toBe(tx)
  })

  test("commit detects TOCTOU race", async () => {
    const { manager, fs } = makeManager()
    fs.files.set("a.txt", "hello")

    const tx = await manager.begin("s", ["a.txt"])
    manager.propose("a.txt", "updated")
    fs.files.set("a.txt", "raced")

    const result = await manager.commit(tx)
    expect(result.status).toBe("CONFLICT")
    expect(result.reason).toBe("TOCTOU_RACE_DETECTED")
    expect(tx.status).toBe("conflict")
    expect(fs.files.get("a.txt")).toBe("raced")
  })

  test("commit three-way merges non-overlapping edits against git blob base", async () => {
    const { manager, fs } = makeManager()
    // Base in git: a/b/c. Workspace already appended "d" before the transaction began.
    fs.blobs.set("commit-1:a.txt", "a\nb\nc")
    fs.files.set("a.txt", "a\nb\nc\nd")

    const tx = await manager.begin("s", ["a.txt"])
    manager.propose("a.txt", "A\nb\nc") // our edit: change first line of base

    const result = await manager.commit(tx)
    expect(result.status).toBe("SUCCESS")
    expect(fs.files.get("a.txt")).toBe("A\nb\nc\nd")
  })

  test("commit reports MERGE_CONFLICT with markers on overlapping edits", async () => {
    const { manager, fs } = makeManager()
    fs.blobs.set("commit-1:a.txt", "original")
    fs.files.set("a.txt", "their edit")

    const tx = await manager.begin("s", ["a.txt"])
    manager.propose("a.txt", "our edit")

    const result = await manager.commit(tx)
    expect(result.status).toBe("MERGE_CONFLICT")
    expect(result.file).toBe("a.txt")
    expect(result.conflictMarkers?.length).toBeGreaterThan(0)
    expect(result.conflictMarkers?.[0]).toContain("<<<<<<< OUR")
  })

  test("rollback restores baseline content and fires onRollback", async () => {
    const { manager, fs } = makeManager()
    fs.files.set("a.txt", "hello")
    let rolledBack: FileTransaction | null = null
    manager.setEventCallbacks({ onRollback: (tx) => void (rolledBack = tx) })

    const tx = await manager.begin("s", ["a.txt"])
    fs.files.set("a.txt", "tampered")

    await manager.rollback(tx)
    expect(fs.files.get("a.txt")).toBe("hello")
    expect(tx.status).toBe("rolled_back")
    expect(rolledBack).toBe(tx)
    expect(manager.getActiveTransaction()).toBeNull()
  })

  test("merge delegates to threeWayMerge", () => {
    const { manager } = makeManager()
    const merged = manager.merge("base", "base", "theirs")
    expect(merged.hasConflicts).toBe(false)
    expect(merged.content).toBe("theirs")
  })
})

// ─── Default node:fs backend ────────────────────────────────────────────────

describe("RealGitTransactionManager (real filesystem)", () => {
  test("commits a new file to disk without an injected backend", async () => {
    const dir = await mkdtemp(join(tmpdir(), "txn-fs-"))
    try {
      const manager = createRealGitTransactionManager(dir)
      const tx = await manager.begin("s", ["notes.txt"])
      manager.propose("notes.txt", "persisted content")

      const result = await manager.commit(tx)
      expect(result.status).toBe("SUCCESS")
      expect(await readFile(join(dir, "notes.txt"), "utf-8")).toBe("persisted content")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("createRealGitTransactionManager", () => {
  test("returns a RealGitTransactionManager instance", () => {
    expect(createRealGitTransactionManager()).toBeInstanceOf(RealGitTransactionManager)
  })
})
