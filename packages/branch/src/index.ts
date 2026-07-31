/**
 * @fengru/branch — Session Forking & Branching Manager
 *
 * Manages session branches for AI agent sessions. Supports forking a session
 * to create parallel exploration branches, merging successful branches back,
 * and abandoning dead-end branches.
 *
 * Design:
 *   - SessionBranch tracks parent, status, creation timestamp, and metadata
 *   - BranchDatabase is an abstract interface for persistence (injectable)
 *   - BranchManager orchestrates fork/merge/abandon lifecycle
 *   - UUID generation via crypto.randomUUID() with fallback to Math.random
 *
 * Zero runtime dependencies.
 *
 * @module branch
 */

// ── UUID Generation ─────────────────────────────────────────────────────────

function generateUUID(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  // Fallback: RFC4122 v4 UUID
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === "x" ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// ── Types ───────────────────────────────────────────────────────────────────

export type BranchStatus = "active" | "merged" | "abandoned"

export interface SessionBranch {
  branchId: string
  parentBranchId: string | null
  sessionId: string
  status: BranchStatus
  createdAt: number
  mergedAt?: number
  abandonedAt?: number
  metadata?: Record<string, unknown>
}

export interface BranchDatabase {
  copyEventLog(sourceSessionId: string, targetSessionId: string): Promise<void>
  copyLatestCheckpoint(sourceSessionId: string, targetSessionId: string): Promise<void>
}

// ── BranchManager ───────────────────────────────────────────────────────────

export class BranchManager {
  private branches = new Map<string, SessionBranch>()
  private database: BranchDatabase | null

  constructor(database?: BranchDatabase) {
    this.database = database ?? null
  }

  setDatabase(db: BranchDatabase): void {
    this.database = db
  }

  async fork(
    sessionId: string,
    parentBranchId: string | null = null,
    metadata?: Record<string, unknown>,
  ): Promise<SessionBranch> {
    const branchId = generateUUID()
    const branch: SessionBranch = {
      branchId: `branch_${branchId}`,
      parentBranchId,
      sessionId: `session_${sessionId}`,
      status: "active",
      createdAt: Date.now(),
      metadata,
    }

    if (this.database) {
      await this.database.copyEventLog(sessionId, branch.sessionId)
      await this.database.copyLatestCheckpoint(sessionId, branch.sessionId)
    }

    this.branches.set(branch.branchId, branch)
    return { ...branch }
  }

  getBranch(branchId: string): SessionBranch | undefined {
    const branch = this.branches.get(branchId)
    return branch ? { ...branch } : undefined
  }

  listBranches(sessionId?: string, status?: BranchStatus): SessionBranch[] {
    const results: SessionBranch[] = []
    for (const branch of this.branches.values()) {
      if (sessionId && branch.sessionId !== `session_${sessionId}`) continue
      if (status && branch.status !== status) continue
      results.push({ ...branch })
    }
    return results.sort((a, b) => a.createdAt - b.createdAt)
  }

  mergeBranch(branchId: string): SessionBranch | undefined {
    const branch = this.branches.get(branchId)
    if (!branch) return undefined
    if (branch.status !== "active") return undefined

    branch.status = "merged"
    branch.mergedAt = Date.now()
    this.branches.set(branchId, branch)
    return { ...branch }
  }

  abandonBranch(branchId: string): SessionBranch | undefined {
    const branch = this.branches.get(branchId)
    if (!branch) return undefined
    if (branch.status !== "active") return undefined

    branch.status = "abandoned"
    branch.abandonedAt = Date.now()
    this.branches.set(branchId, branch)
    return { ...branch }
  }

  getActiveBranches(sessionId?: string): SessionBranch[] {
    return this.listBranches(sessionId, "active")
  }

  count(): number {
    return this.branches.size
  }
}

/**
 * Create a {@link BranchManager} instance.
 *
 * @param args - Constructor arguments forwarded to {@link BranchManager}.
 * @returns A new {@link BranchManager}.
 */
export function createBranchManager(...args: ConstructorParameters<typeof BranchManager>): BranchManager {
  return new BranchManager(...args)
}
