/**
 * Incremental Parsing State Machine
 *
 * Manages incremental code graph updates when files change:
 * - Content hash comparison to detect real changes
 * - Stale set marking for affected entities and their 1-hop neighbors
 * - Partial re-extraction of stale regions
 * - Transactional DB update (delete stale → insert fresh)
 * - Cross-file repair queue for unresolved references
 *
 * @module codegraph/incremental
 */

import { readFile } from "node:fs/promises"
import { existsSync, statSync } from "node:fs"
import { relative } from "node:path"
import { CodeGraph } from "./graph"
import { CallSiteStore, createCallSite } from "./callsite"
import type { StaleMarker, IncrementalParseResult, CodeGraphNode, CallSite } from "./types"
import { extractFromFile, type ExtractResult } from "./extractor"
import { hashString, hashesEqual, signatureChanged } from "./hashing"

export interface IncrementalEdit {
  filePath: string
  editType: "add" | "modify" | "delete"
  /** Byte range of the edit in the source */
  editRange?: [number, number]
  /** New source content (for add/modify) */
  source?: string
}

export class IncrementalParser {
  private graph: CodeGraph
  private callSites: CallSiteStore
  private rootDir: string
  private tokenizerName: string
  /** Entities marked as stale, keyed by entity ID */
  private staleEntities = new Map<string, StaleMarker>()
  /** Entities pending cross-file resolution */
  private unresolvedRefs = new Set<string>()
  /** Source content cache keyed by filePath */
  private sourceCache = new Map<string, string>()

  constructor(graph: CodeGraph, callSites: CallSiteStore, rootDir: string, tokenizerName?: string) {
    this.graph = graph
    this.callSites = callSites
    this.rootDir = rootDir
    this.tokenizerName = tokenizerName ?? "simple"
  }

  /**
   * Process an incremental edit.
   * Returns the re-parsed entities and call sites.
   */
  async processEdit(edit: IncrementalEdit): Promise<IncrementalParseResult> {
    const relPath = relative(this.rootDir, edit.filePath).replace(/\\/g, "/")

    if (edit.editType === "delete") {
      return this.handleDelete(relPath, edit)
    }

    return this.handleModify(relPath, edit)
  }

  private async handleDelete(
    relPath: string,
    edit: IncrementalEdit,
  ): Promise<IncrementalParseResult> {
    const editRange: [number, number] = [0, 0]

    const removedEntityIds = this.graph.removeFileNodes(relPath)
    this.callSites.removeByFile(relPath)
    this.sourceCache.delete(relPath)

    const now = Date.now()
    for (const entityId of removedEntityIds) {
      this.staleEntities.set(entityId, {
        entityId,
        editRange,
        markedAt: now,
        neighborsMarked: false,
      })
    }

    const resolvedMarkers: StaleMarker[] = []
    for (const entityId of removedEntityIds) {
      const marker = this.staleEntities.get(entityId)
      if (marker) {
        resolvedMarkers.push(marker)
      }
    }

    return {
      entities: [],
      callSites: [],
      removedEntityIds,
      resolvedMarkers,
      editRange,
    }
  }

  private async handleModify(
    relPath: string,
    edit: IncrementalEdit,
  ): Promise<IncrementalParseResult> {
    const filePath = edit.filePath

    if (!existsSync(filePath)) {
      return this.handleDelete(relPath, edit)
    }

    const source = edit.source ?? (await this.safeRead(filePath))
    if (!source) {
      return { entities: [], callSites: [], removedEntityIds: [], resolvedMarkers: [], editRange: [0, 0] }
    }

    this.sourceCache.set(relPath, source)

    const prevEntities = this.graph.getNodesForFile(relPath)
    const prevContentHash = this.computeFileContentHash(prevEntities)

    const prevSource = this.sourceCache.get(relPath)
    if (prevSource) {
      const newHash = hashString(source)
      const defaultEditRange: [number, number] = [0, source.length]
      if (hashesEqual(prevContentHash, newHash)) {
        return {
          entities: [],
          callSites: [],
          removedEntityIds: [],
          resolvedMarkers: [],
          editRange: edit.editRange ?? defaultEditRange,
        }
      }
    }

    const mtime = statSync(filePath).mtimeMs
    const extractResult = await extractFromFile(filePath, source, mtime, undefined, this.tokenizerName)

    const removedEntityIds = this.graph.removeFileNodes(relPath)
    this.callSites.removeByFile(relPath)

    const staleIds = new Set<string>(removedEntityIds)

    const neighbors = new Set<string>()
    for (const entityId of removedEntityIds) {
      const callers = this.graph.getCallersOf(entityId)
      for (const caller of callers) {
        neighbors.add(caller.id)
      }
      const overridden = this.graph.getOverriddenBy(entityId)
      for (const ov of overridden) {
        neighbors.add(ov.id)
      }
      const typeUsers = this.graph.getTypeUsersOf(entityId)
      for (const tu of typeUsers) {
        neighbors.add(tu.id)
      }
    }

    const editRange: [number, number] = edit.editRange ?? [0, source.length]
    const now = Date.now()

    for (const entityId of staleIds) {
      this.staleEntities.set(entityId, {
        entityId,
        editRange,
        markedAt: now,
        neighborsMarked: false,
      })
    }

    for (const neighborId of neighbors) {
      if (!staleIds.has(neighborId)) {
        this.staleEntities.set(neighborId, {
          entityId: neighborId,
          editRange,
          markedAt: now,
          neighborsMarked: true,
        })
      }
    }

    const newEntities: CodeGraphNode[] = []
    const newCallSites: CallSite[] = []

    for (const sym of extractResult.symbols) {
      sym.filePath = relPath
      this.graph.addNode(sym)
      newEntities.push(sym)
    }

    const fileId = `file:${relPath}`
    const fileNode: CodeGraphNode = {
      id: fileId,
      type: "file",
      name: relPath,
      filePath: relPath,
      startLine: 1,
      endLine: 0,
      startByte: 0,
      endByte: 0,
      startToken: 0,
      endToken: 0,
      tokenizerName: this.tokenizerName,
      metadata: {
        language: relPath.split(".").pop() ?? "",
        size: source.length,
        imports: extractResult.imports,
        exports: extractResult.exports,
      },
      mtime,
    }
    this.graph.addNode(fileNode)
    newEntities.push(fileNode)

    for (const sym of extractResult.symbols) {
      this.graph.addEdge({ sourceId: fileId, targetId: sym.id, relation: "defines" })
      if ((sym.metadata as Record<string, unknown>).isExported) {
        this.graph.addEdge({ sourceId: fileId, targetId: sym.id, relation: "exports" })
      }
    }

    for (const imp of extractResult.imports) {
      const resolved = this.resolveImportSimple(imp.source, relPath)
      if (resolved) {
        this.graph.addEdge({ sourceId: fileId, targetId: `file:${resolved}`, relation: "imports" })
        for (const name of imp.names) {
          const symbols = this.graph.findNodes(
            (n) => n.type === "symbol" && n.name === name && n.filePath === resolved,
          )
          for (const sym of symbols) {
            this.graph.addEdge({ sourceId: fileId, targetId: sym.id, relation: "references" })
          }
        }
      }
    }

    const tName = this.tokenizerName

    const callerByName = new Map<string, CodeGraphNode>()
    for (const sym of extractResult.symbols) {
      if (sym.symbolType === "function" || sym.symbolType === "method") {
        if (!callerByName.has(sym.name)) {
          callerByName.set(sym.name, sym)
        }
      }
    }

    for (const call of extractResult.calls) {
      const caller = callerByName.get(call.callerName)
      if (!caller) continue

      const candidates = this.graph.findNodes(
        (n) => n.type === "symbol" && n.name === call.calleeName &&
          (n.symbolType === "function" || n.symbolType === "method" || n.symbolType === "class"),
      )

      const dedupeSet = new Set<string>()
      for (const callee of candidates) {
        if (callee.id === caller.id) continue
        const dedupeKey = `${caller.id}->${callee.id}`
        if (dedupeSet.has(dedupeKey)) continue
        dedupeSet.add(dedupeKey)

        this.graph.addEdge({ sourceId: caller.id, targetId: callee.id, relation: "calls" })
        const cs = createCallSite({
          callerId: caller.id,
          calleeName: callee.name,
          calleeId: callee.id,
          filePath: relPath,
          startByte: call.startByte,
          endByte: call.endByte,
          startToken: 0,
          endToken: 0,
          startLine: call.startLine,
          endLine: call.endLine,
          argCount: call.argCount,
          keywordArgs: call.keywordArgNames,
          hasStarArgs: call.hasSpread,
          hasKwargs: call.hasSpread,
          tokenizerName: tName,
        })
        this.callSites.add(cs)
        newCallSites.push(cs)
      }
    }

    const resolvedMarkers: StaleMarker[] = []
    for (const entityId of staleIds) {
      if (this.graph.hasNode(entityId)) {
        const marker = this.staleEntities.get(entityId)
        if (marker) {
          resolvedMarkers.push(marker)
          this.staleEntities.delete(entityId)
        }
      }
    }

    return {
      entities: newEntities,
      callSites: newCallSites,
      removedEntityIds,
      resolvedMarkers,
      editRange,
    }
  }

  /**
   * Get entities currently marked as stale.
   */
  getStaleEntities(): StaleMarker[] {
    return Array.from(this.staleEntities.values())
  }

  /**
   * Check if a specific entity is stale.
   */
  isStale(entityId: string): boolean {
    return this.staleEntities.has(entityId)
  }

  /**
   * Check if an entity's signature has changed based on hash comparison.
   */
  hasSignatureChanged(entityId: string, newSignatureHash: string): boolean {
    const entity = this.graph.getNode(entityId)
    if (!entity) return true
    const meta = entity.metadata as { signatureHash?: string }
    return signatureChanged(meta.signatureHash, newSignatureHash)
  }

  /**
   * Clear all stale markers.
   */
  clearStale(): void {
    this.staleEntities.clear()
    this.unresolvedRefs.clear()
    this.sourceCache.clear()
  }

  private computeFileContentHash(entities: CodeGraphNode[]): string | undefined {
    const hashes = entities
      .map((e) => {
        const meta = e.metadata as { contentHash?: string; signatureHash?: string }
        return meta.contentHash ?? meta.signatureHash
      })
      .filter(Boolean)
      .sort()
      .join("|")
    return hashes ? hashString(hashes) : undefined
  }

  private async safeRead(filePath: string): Promise<string | null> {
    try {
      return await readFile(filePath, "utf-8")
    } catch {
      return null
    }
  }

  private resolveImportSimple(importSource: string, currentFile: string): string | null {
    if (!importSource.startsWith(".") && !importSource.startsWith("/")) return null
    const dir = currentFile.includes("/")
      ? currentFile.substring(0, currentFile.lastIndexOf("/"))
      : ""
    const extensions = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs"]
    for (const ext of extensions) {
      const candidate = `${dir ? dir + "/" : ""}${importSource}${ext}`
      if (this.graph.hasNode(`file:${candidate}`)) return candidate
    }
    for (const ext of [".ts", ".js", ".tsx", ".jsx"]) {
      const candidate = `${dir ? dir + "/" : ""}${importSource}/index${ext}`
      if (this.graph.hasNode(`file:${candidate}`)) return candidate
    }
    return null
  }
}
