/**
 * CallSite store — token-level precise call site tracking.
 *
 * Records every call site with:
 * - Token-level positioning (startToken, endToken)
 * - Argument info for signature compatibility checks
 * - Caller/callee entity IDs for impact analysis
 *
 * Supports both in-memory and persistent modes.
 *
 * @module codegraph/callsite
 */

import type { CallSite } from "./types"

let _nextId = 0

function generateId(): string {
  _nextId++
  return `cs_${_nextId}_${Date.now().toString(36)}`
}

export class CallSiteStore {
  private _byId = new Map<string, CallSite>()
  private _byCaller = new Map<string, Set<string>>()
  private _byCallee = new Map<string, Set<string>>()
  private _byCalleeName = new Map<string, Set<string>>()
  private _byFile = new Map<string, Set<string>>()
  private _byTokenRange = new Map<string, Set<string>>()

  /** Add a call site to the store */
  add(callSite: CallSite): void {
    const id = callSite.id || generateId()
    const cs: CallSite = { ...callSite, id }

    this._byId.set(id, cs)

    if (!this._byCaller.has(cs.callerId)) {
      this._byCaller.set(cs.callerId, new Set())
    }
    this._byCaller.get(cs.callerId)!.add(id)

    if (cs.calleeId) {
      if (!this._byCallee.has(cs.calleeId)) {
        this._byCallee.set(cs.calleeId, new Set())
      }
      this._byCallee.get(cs.calleeId)!.add(id)
    }

    const nameKey = cs.calleeName.toLowerCase()
    if (!this._byCalleeName.has(nameKey)) {
      this._byCalleeName.set(nameKey, new Set())
    }
    this._byCalleeName.get(nameKey)!.add(id)

    if (!this._byFile.has(cs.filePath)) {
      this._byFile.set(cs.filePath, new Set())
    }
    this._byFile.get(cs.filePath)!.add(id)

    const tokenKey = `${cs.filePath}:${cs.startToken}:${cs.endToken}`
    if (!this._byTokenRange.has(tokenKey)) {
      this._byTokenRange.set(tokenKey, new Set())
    }
    this._byTokenRange.get(tokenKey)!.add(id)
  }

  /** Get a call site by ID */
  get(id: string): CallSite | undefined {
    return this._byId.get(id)
  }

  /** Get call sites where the given entity is the caller */
  getByCaller(callerId: string): CallSite[] {
    const ids = this._byCaller.get(callerId)
    if (!ids) return []
    return Array.from(ids)
      .map((id) => this._byId.get(id)!)
      .filter(Boolean)
  }

  /** Get call sites targeting the given callee entity ID */
  getByCallee(calleeId: string): CallSite[] {
    const ids = this._byCallee.get(calleeId)
    if (!ids) return []
    return Array.from(ids)
      .map((id) => this._byId.get(id)!)
      .filter(Boolean)
  }

  /** Get call sites targeting a symbol by name (for dynamic/unresolved calls) */
  getByCalleeName(calleeName: string): CallSite[] {
    const ids = this._byCalleeName.get(calleeName.toLowerCase())
    if (!ids) return []
    return Array.from(ids)
      .map((id) => this._byId.get(id)!)
      .filter(Boolean)
  }

  /** Get all call sites in a file */
  getByFile(filePath: string): CallSite[] {
    const ids = this._byFile.get(filePath)
    if (!ids) return []
    return Array.from(ids)
      .map((id) => this._byId.get(id)!)
      .filter(Boolean)
  }

  /** Get call sites overlapping a token range in a file */
  getByTokenRange(filePath: string, startToken: number, endToken: number): CallSite[] {
    const result: CallSite[] = []
    for (const cs of this._byId.values()) {
      if (cs.filePath !== filePath) continue
      if (cs.startToken <= endToken && cs.endToken >= startToken) {
        result.push(cs)
      }
    }
    return result
  }

  /** Get call sites that would break if the callee's signature changes */
  getStaleCallSites(
    calleeId: string,
    _newParamCount: number,
    newRequiredParamCount: number,
    newParamNames: string[],
  ): CallSite[] {
    const existing = this.getByCallee(calleeId)
    const stale: CallSite[] = []

    for (const cs of existing) {
      if (cs.argCount < newRequiredParamCount) {
        stale.push(cs)
        continue
      }
      for (const kw of cs.keywordArgs) {
        if (!newParamNames.includes(kw)) {
          stale.push(cs)
          break
        }
      }
    }

    return stale
  }

  /** Remove call sites by file path (for incremental updates) */
  removeByFile(filePath: string): number {
    const ids = this._byFile.get(filePath)
    if (!ids) return 0
    let removed = 0
    for (const id of Array.from(ids)) {
      this.remove(id)
      removed++
    }
    return removed
  }

  /** Remove a single call site by ID */
  remove(id: string): boolean {
    const cs = this._byId.get(id)
    if (!cs) return false

    this._byId.delete(id)
    this._byCaller.get(cs.callerId)?.delete(id)
    if (cs.calleeId) this._byCallee.get(cs.calleeId)?.delete(id)
    this._byCalleeName.get(cs.calleeName.toLowerCase())?.delete(id)
    this._byFile.get(cs.filePath)?.delete(id)
    const tokenKey = `${cs.filePath}:${cs.startToken}:${cs.endToken}`
    this._byTokenRange.get(tokenKey)?.delete(id)

    return true
  }

  /** Get total count */
  get size(): number {
    return this._byId.size
  }

  /** Clear all call sites */
  clear(): void {
    this._byId.clear()
    this._byCaller.clear()
    this._byCallee.clear()
    this._byCalleeName.clear()
    this._byFile.clear()
    this._byTokenRange.clear()
  }

  /** Serialize all call sites for persistence */
  toJSON(): CallSite[] {
    return Array.from(this._byId.values())
  }

  /** Load call sites from serialized data */
  fromJSON(data: CallSite[]): void {
    this.clear()
    for (const cs of data) this.add(cs)
  }

  /** Iterate all call sites */
  [Symbol.iterator](): Iterator<CallSite> {
    return this._byId.values()
  }
}

/**
 * Create a call site with token-level positioning.
 */
export function createCallSite(params: {
  callerId: string
  calleeName: string
  calleeId?: string
  filePath: string
  startByte: number
  endByte: number
  startToken: number
  endToken: number
  startLine: number
  endLine: number
  argCount?: number
  keywordArgs?: string[]
  hasStarArgs?: boolean
  hasKwargs?: boolean
  tokenizerName?: string
}): CallSite {
  return {
    id: generateId(),
    callerId: params.callerId,
    calleeName: params.calleeName,
    calleeId: params.calleeId ?? "",
    filePath: params.filePath,
    startByte: params.startByte,
    endByte: params.endByte,
    startToken: params.startToken,
    endToken: params.endToken,
    startLine: params.startLine,
    endLine: params.endLine,
    argCount: params.argCount ?? 0,
    keywordArgs: params.keywordArgs ?? [],
    hasStarArgs: params.hasStarArgs ?? false,
    hasKwargs: params.hasKwargs ?? false,
    tokenizerName: params.tokenizerName ?? "simple",
  }
}
