/**
 * TxnFS — Transactional Filesystem with Three-Way Merge
 *
 * Git-style file transactions with TOCTOU validation, three-way merge,
 * conflict detection, and rollback. Supports both in-memory and real
 * filesystem backends.
 *
 * ## Features
 * - FileTransaction: snapshot baseline → validate → commit/rollback
 * - Three-way merge: base/ours/theirs diff-based merging
 * - TOCTOU race detection at commit time
 * - Event callbacks for commit/rollback integration
 * - Real FS backend with optional Git integration
 *
 * ## Use Cases
 * - AI agent file modifications with safety guarantees
 * - Multi-agent file conflict resolution
 * - Crash-safe file operations
 *
 * @module txn-fs
 */

import { createHash } from "node:crypto"
import { join } from "node:path"

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FileTransaction {
  id: string
  sessionId: string
  baselineHash: Record<string, string>
  baselineGitHead: string
  affectedFiles: string[]
  status: "active" | "validated" | "committed" | "rolled_back" | "conflict"
}

export interface ValidationResult {
  valid: boolean
  file?: string
  reason?: string
}

export interface CommitResult {
  status: "SUCCESS" | "CONFLICT" | "MERGE_CONFLICT"
  file?: string
  reason?: string
  conflictMarkers?: string[]
  suggestion?: string
}

export interface MergeResult {
  content: string
  hasConflicts: boolean
  markers: string[]
}

// ─── Pluggable Filesystem Interface ─────────────────────────────────────────

/** Filesystem abstraction for RealGitTransactionManager */
export interface IFileSystem {
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  exists(path: string): Promise<boolean>
  isGitRepo(): boolean
  getGitHead(): Promise<string>
  getGitBlob(commit: string, file: string): Promise<string>
  execGit(args: string[]): Promise<{ exitCode: number; stdout: string }>
}

// ─── Minimal Line-Diff Implementation ───────────────────────────────────────

interface DiffChunk {
  value: string[]
  count: number
  added?: boolean
  removed?: boolean
}

/**
 * Minimal Myers-like line diff. Returns chunks with added/removed markers.
 * Replaces the `diff` npm library dependency for standalone operation.
 */
function diffArrays(base: string[], target: string[]): DiffChunk[] {
  const chunks: DiffChunk[] = []
  const m = base.length
  const n = target.length

  // Compute LCS (Longest Common Subsequence) table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (base[i - 1] === target[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!)
      }
    }
  }

  // Backtrack to build diff
  let i = m
  let j = n
  const operations: Array<"keep" | "remove" | "add"> = []

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && base[i - 1] === target[j - 1]) {
      operations.push("keep")
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      operations.push("add")
      j--
    } else {
      operations.push("remove")
      i--
    }
  }
  operations.reverse()

  // Group consecutive operations into chunks
  let ci = 0
  let cj = 0
  for (const op of operations) {
    switch (op) {
      case "keep":
        if (chunks.length > 0 && !chunks[chunks.length - 1]!.added && !chunks[chunks.length - 1]!.removed) {
          chunks[chunks.length - 1]!.value.push(base[ci]!)
          chunks[chunks.length - 1]!.count++
        } else {
          chunks.push({ value: [base[ci]!], count: 1 })
        }
        ci++
        cj++
        break
      case "remove":
        if (chunks.length > 0 && chunks[chunks.length - 1]!.removed) {
          chunks[chunks.length - 1]!.value.push(base[ci]!)
          chunks[chunks.length - 1]!.count++
        } else {
          chunks.push({ value: [base[ci]!], count: 1, removed: true })
        }
        ci++
        break
      case "add":
        if (chunks.length > 0 && chunks[chunks.length - 1]!.added) {
          chunks[chunks.length - 1]!.value.push(target[cj]!)
          chunks[chunks.length - 1]!.count++
        } else {
          chunks.push({ value: [target[cj]!], count: 1, added: true })
        }
        cj++
        break
    }
  }

  return chunks
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex")
}

function generateUUID(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

// ─── Three-Way Merge ────────────────────────────────────────────────────────

export function threeWayMerge(
  base: string,
  ours: string,
  theirs: string,
): MergeResult {
  if (ours === theirs) return { content: ours, hasConflicts: false, markers: [] }
  if (theirs === base) return { content: ours, hasConflicts: false, markers: [] }
  if (ours === base) return { content: theirs, hasConflicts: false, markers: [] }

  const baseLines = base.split("\n")
  const oursLines = ours.split("\n")
  const theirsLines = theirs.split("\n")

  const diffOurs = diffArrays(baseLines, oursLines)
  const diffTheirs = diffArrays(baseLines, theirsLines)

  const resultLines: string[] = []
  const markers: string[] = []
  let oi = 0
  let ti = 0
  let hasConflicts = false

  while (oi < diffOurs.length && ti < diffTheirs.length) {
    const o = diffOurs[oi]!
    const t = diffTheirs[ti]!

    if (!o.added && !o.removed && !t.added && !t.removed) {
      const commonCount = Math.min(o.count, t.count)
      for (let c = 0; c < commonCount; c++) {
        resultLines.push(o.value[c]!)
      }
      o.count -= commonCount
      t.count -= commonCount
      if (o.count === 0) oi++
      if (t.count === 0) ti++
      continue
    }

    if (o.removed && t.removed) {
      const skipCount = Math.min(o.count, t.count)
      o.count -= skipCount
      t.count -= skipCount
      if (o.count === 0) oi++
      if (t.count === 0) ti++
      continue
    }

    if (o.added && !t.added && !t.removed) {
      for (let c = 0; c < o.count; c++) resultLines.push(o.value[c]!)
      oi++
      continue
    }

    if (t.added && !o.added && !o.removed) {
      for (let c = 0; c < t.count; c++) resultLines.push(t.value[c]!)
      ti++
      continue
    }

    if (o.removed && !t.removed && !t.added) { oi++; continue }
    if (t.removed && !o.removed && !o.added) { ti++; continue }

    // Conflict: both sides modified the same region
    hasConflicts = true
    const ourBlock: string[] = []
    while (oi < diffOurs.length && (diffOurs[oi]!.added || diffOurs[oi]!.removed)) {
      const ho = diffOurs[oi]!
      for (let c = 0; c < ho.count; c++) ourBlock.push(ho.value[c]!)
      oi++
    }
    const theirBlock: string[] = []
    while (ti < diffTheirs.length && (diffTheirs[ti]!.added || diffTheirs[ti]!.removed)) {
      const ht = diffTheirs[ti]!
      for (let c = 0; c < ht.count; c++) theirBlock.push(ht.value[c]!)
      ti++
    }

    const marker = `<<<<<<< OUR\n${ourBlock.join("\n")}\n=======\n${theirBlock.join("\n")}\n>>>>>>> THEIR`
    markers.push(marker)
    resultLines.push(marker)
  }

  while (oi < diffOurs.length) {
    const o = diffOurs[oi]!
    for (let c = 0; c < o.count; c++) {
      if (o.added) resultLines.push(o.value[c]!)
    }
    oi++
  }
  while (ti < diffTheirs.length) {
    const t = diffTheirs[ti]!
    for (let c = 0; c < t.count; c++) {
      if (t.added) resultLines.push(t.value[c]!)
    }
    ti++
  }

  return { content: resultLines.join("\n"), hasConflicts, markers }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GitTransactionManager — In-Memory Backend
// ═══════════════════════════════════════════════════════════════════════════════

export class GitTransactionManager {
  private staging: Map<string, string> = new Map()
  private activeTransaction: FileTransaction | null = null

  begin(sessionId: string, files: Array<{ path: string; content: string }>): FileTransaction {
    const baselineHash: Record<string, string> = {}

    for (const file of files) {
      baselineHash[file.path] = hashContent(file.content)
      this.staging.set(file.path, file.content)
    }

    this.activeTransaction = {
      id: generateUUID(),
      sessionId,
      baselineHash,
      baselineGitHead: "",
      affectedFiles: files.map((f) => f.path),
      status: "active",
    }

    return this.activeTransaction
  }

  propose(file: string, content: string): void {
    this.staging.set(file, content)
  }

  validate(tx: FileTransaction): ValidationResult {
    for (const file of tx.affectedFiles) {
      const currentContent = this.staging.get(file)
      if (currentContent) {
        const currentHash = hashContent(currentContent)
        if (currentHash !== tx.baselineHash[file]) {
          return { valid: false, file, reason: "WORKSPACE_MODIFIED" }
        }
      }
    }
    tx.status = "validated"
    return { valid: true }
  }

  commit(
    tx: FileTransaction,
    getCurrentContent: (file: string) => string,
    getBaseContent?: (file: string) => string,
  ): CommitResult {
    for (const file of tx.affectedFiles) {
      const currentContent = getCurrentContent(file)
      const currentHash = hashContent(currentContent)
      if (currentHash !== tx.baselineHash[file]) {
        return this.handleConflict(tx, file, currentHash)
      }
    }

    for (const file of tx.affectedFiles) {
      const stagedContent = this.staging.get(file)
      if (!stagedContent) continue

      const currentContent = getCurrentContent(file)
      const baseContent = getBaseContent ? getBaseContent(file) : currentContent

      if (currentContent === baseContent) {
        tx.baselineHash[file] = hashContent(stagedContent)
      } else {
        const merged = threeWayMerge(baseContent, stagedContent, currentContent)
        if (merged.hasConflicts) {
          this.rollback(tx)
          return {
            status: "MERGE_CONFLICT",
            file,
            conflictMarkers: merged.markers,
            suggestion: "Please resolve conflicts manually or rollback",
          }
        }
        tx.baselineHash[file] = hashContent(merged.content)
      }
    }

    this.staging.clear()
    tx.status = "committed"
    return { status: "SUCCESS" }
  }

  rollback(tx: FileTransaction): void {
    this.staging.clear()
    tx.status = "rolled_back"
    this.activeTransaction = null
  }

  private handleConflict(tx: FileTransaction, file: string, currentHash: string): CommitResult {
    tx.status = "conflict"
    return {
      status: "CONFLICT",
      file,
      reason: "TOCTOU_RACE_DETECTED",
      suggestion: "Workspace file was modified during transaction. Please resolve conflicts manually.",
    }
  }

  merge(
    base: string,
    ours: string,
    theirs: string,
  ): MergeResult {
    return threeWayMerge(base, ours, theirs)
  }

  getActiveTransaction(): FileTransaction | null {
    return this.activeTransaction
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// RealGitTransactionManager — Real Filesystem Backend
// ═══════════════════════════════════════════════════════════════════════════════

export class RealGitTransactionManager {
  private staging = new Map<string, string>()
  private activeTransaction: FileTransaction | null = null
  private workDir: string
  private fs: IFileSystem | null = null
  private onCommitCallback: ((tx: FileTransaction) => void | Promise<void>) | null = null
  private onRollbackCallback: ((tx: FileTransaction) => void | Promise<void>) | null = null

  constructor(workDir: string = process.cwd()) {
    this.workDir = workDir
  }

  /** Inject a custom filesystem backend (defaults to bun:fs if available) */
  setFileSystem(fs: IFileSystem): void {
    this.fs = fs
  }

  /** Register event callbacks for EventBus integration */
  setEventCallbacks(callbacks: {
    onCommit?: (tx: FileTransaction) => void | Promise<void>
    onRollback?: (tx: FileTransaction) => void | Promise<void>
  }): void {
    this.onCommitCallback = callbacks.onCommit ?? null
    this.onRollbackCallback = callbacks.onRollback ?? null
  }

  private resolvePath(relPath: string): string {
    return join(this.workDir, relPath)
  }

  private async readFile(path: string): Promise<string> {
    if (this.fs) return this.fs.readFile(path)
    const { readFile } = await import("node:fs/promises")
    try {
      return await readFile(this.resolvePath(path), "utf-8")
    } catch {
      return ""
    }
  }

  private async writeFile(path: string, content: string): Promise<void> {
    if (this.fs) return this.fs.writeFile(path, content)
    const { writeFile, mkdir } = await import("node:fs/promises")
    const fullPath = this.resolvePath(path)
    const parent = fullPath.replace(/[/\\][^/\\]+$/, "")
    if (parent !== fullPath) {
      await mkdir(parent, { recursive: true }).catch(() => {})
    }
    await writeFile(fullPath, content, "utf-8")
  }

  private async getGitHead(): Promise<string> {
    if (this.fs) return this.fs.getGitHead()
    return ""
  }

  private async getGitBlob(_commit: string, _file: string): Promise<string> {
    if (this.fs) return this.fs.getGitBlob(_commit, _file)
    return ""
  }

  async begin(sessionId: string, files: string[]): Promise<FileTransaction> {
    const baselineHash: Record<string, string> = {}

    for (const file of files) {
      const content = await this.readFile(file)
      baselineHash[file] = hashContent(content)
      this.staging.set(file, content)
    }

    this.activeTransaction = {
      id: generateUUID(),
      sessionId,
      baselineHash,
      baselineGitHead: await this.getGitHead(),
      affectedFiles: files,
      status: "active",
    }

    return this.activeTransaction
  }

  propose(file: string, content: string): void {
    this.staging.set(file, content)
  }

  async validate(tx: FileTransaction): Promise<ValidationResult> {
    for (const file of tx.affectedFiles) {
      const currentContent = await this.readFile(file)
      const currentHash = hashContent(currentContent)
      if (currentHash !== tx.baselineHash[file]) {
        return { valid: false, file, reason: "WORKSPACE_MODIFIED" }
      }
    }
    tx.status = "validated"
    return { valid: true }
  }

  async commit(tx: FileTransaction): Promise<CommitResult> {
    // Phase 1: Secondary validation (TOCTOU)
    for (const file of tx.affectedFiles) {
      const currentContent = await this.readFile(file)
      const currentHash = hashContent(currentContent)
      if (currentHash !== tx.baselineHash[file]) {
        return this.handleConflict(tx, file, currentHash)
      }
    }

    // Phase 2: Three-way merge per file
    for (const file of tx.affectedFiles) {
      const stagedContent = this.staging.get(file)
      if (!stagedContent) continue

      const currentContent = await this.readFile(file)
      const baseContent = await this.getGitBlob(tx.baselineGitHead, file)

      if (!baseContent || currentContent === baseContent) {
        await this.writeFile(file, stagedContent)
        tx.baselineHash[file] = hashContent(stagedContent)
      } else {
        const merged = threeWayMerge(baseContent, stagedContent, currentContent)
        if (merged.hasConflicts) {
          await this.rollback(tx)
          return {
            status: "MERGE_CONFLICT",
            file,
            conflictMarkers: merged.markers,
            suggestion: "Please resolve conflicts manually or rollback",
          }
        }
        await this.writeFile(file, merged.content)
        tx.baselineHash[file] = hashContent(merged.content)
      }
    }

    // Phase 3: Emit commit event
    if (this.onCommitCallback) {
      await this.onCommitCallback(tx)
    }

    // Phase 4: Cleanup
    this.staging.clear()
    tx.status = "committed"
    return { status: "SUCCESS" }
  }

  async rollback(tx: FileTransaction): Promise<void> {
    const baseFiles = tx.baselineHash
    for (const file of tx.affectedFiles) {
      const baseContent = this.staging.get(file)
      if (baseContent) {
        await this.writeFile(file, baseContent)
      }
    }

    if (this.onRollbackCallback) {
      await this.onRollbackCallback(tx)
    }

    this.staging.clear()
    tx.status = "rolled_back"
    this.activeTransaction = null
  }

  private handleConflict(tx: FileTransaction, file: string, currentHash: string): CommitResult {
    tx.status = "conflict"
    return {
      status: "CONFLICT",
      file,
      reason: "TOCTOU_RACE_DETECTED",
      suggestion: `File was modified during transaction. Baseline: ${tx.baselineHash[file]}, Current: ${currentHash}`,
    }
  }

  merge(
    base: string,
    ours: string,
    theirs: string,
  ): MergeResult {
    return threeWayMerge(base, ours, theirs)
  }

  getActiveTransaction(): FileTransaction | null {
    return this.activeTransaction
  }
}
