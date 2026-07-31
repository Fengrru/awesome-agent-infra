/**
 * CodeGraph Watcher — Incremental Update Mechanism
 *
 * Monitors file changes and updates the code graph incrementally:
 * - File modified: re-extract symbols, update edges
 * - File added: extract and link into graph
 * - File deleted: remove associated nodes and edges
 *
 * Extended with:
 * - IncrementalParser integration for stale marker state machine
 * - Content hash comparison to skip unchanged files
 * - Batch transactional updates with rollback support
 *
 * @module codegraph/watcher
 */

import { readFile } from "node:fs/promises"
import { existsSync, statSync } from "node:fs"
import { relative } from "node:path"
import { CodeGraph } from "./graph"
import { CallSiteStore, createCallSite } from "./callsite"
import { IncrementalParser, type IncrementalEdit } from "./incremental"
import type { CodeGraphEdge, IncrementalParseResult, StaleMarker } from "./types"

export type FileChangeType = "add" | "modify" | "delete"

export interface FileChange {
  filePath: string
  type: FileChangeType
}

/**
 * Minimal extraction result for incremental updates.
 * Implement extractFromFile with your own parser (Tree-sitter, regex, etc.).
 */
export interface ExtractResult {
  symbols: Array<{
    id: string
    name: string
    symbolType?: string
    filePath: string
    startLine: number
    endLine: number
    metadata: Record<string, unknown>
    mtime: number
  }>
  imports: Array<{ source: string; names: string[] }>
  exports: string[]
}

export type ExtractorFn = (
  filePath: string,
  source: string,
  mtime: number,
) => Promise<ExtractResult>

export class CodeGraphWatcher {
  private graph: CodeGraph
  private callSites: CallSiteStore
  private rootDir: string
  private extractor: ExtractorFn | null = null
  private incrementalParser: IncrementalParser
  private tokenizerName: string

  constructor(graph: CodeGraph, rootDir: string, callSites?: CallSiteStore, tokenizerName?: string) {
    this.graph = graph
    this.rootDir = rootDir
    this.callSites = callSites ?? new CallSiteStore()
    this.tokenizerName = tokenizerName ?? "simple"
    this.incrementalParser = new IncrementalParser(graph, this.callSites, rootDir, this.tokenizerName)
  }

  /** Set the extractor function for parsing file sources */
  setExtractor(fn: ExtractorFn): void {
    this.extractor = fn
  }

  /** Get the incremental parser for stale marker inspection */
  getIncrementalParser(): IncrementalParser {
    return this.incrementalParser
  }

  /** Get current stale entities */
  getStaleEntities(): StaleMarker[] {
    return this.incrementalParser.getStaleEntities()
  }

  /** Check if an entity is stale */
  isStale(entityId: string): boolean {
    return this.incrementalParser.isStale(entityId)
  }

  /** Clear all stale markers */
  clearStale(): void {
    this.incrementalParser.clearStale()
  }

  /**
   * Apply file changes with incremental parsing and stale tracking.
   */
  async applyChanges(
    changes: FileChange[],
  ): Promise<{ nodesAdded: number; nodesRemoved: number; edgesAdded: number; staleCount: number }> {
    if (this.extractor) {
      const legacy = await this.applyChangesLegacy(changes)
      return { ...legacy, staleCount: 0 }
    }

    let totalNodesAdded = 0
    let totalNodesRemoved = 0
    let totalEdgesAdded = 0
    let totalStaleCount = 0

    for (const change of changes) {
      const edit: IncrementalEdit = {
        filePath: change.filePath,
        editType: change.type === "delete" ? "delete" : "modify",
      }

      const result = await this.incrementalParser.processEdit(edit)

      totalNodesAdded += result.entities.length
      totalNodesRemoved += result.removedEntityIds.length
      totalEdgesAdded += result.callSites.length
      totalStaleCount += result.resolvedMarkers.length
    }

    return {
      nodesAdded: totalNodesAdded,
      nodesRemoved: totalNodesRemoved,
      edgesAdded: totalEdgesAdded,
      staleCount: totalStaleCount,
    }
  }

  /**
   * Legacy applyChanges fallback that uses the extractor function directly.
   * Used when the incremental parser can't handle a change (e.g., pre-built graph
   * without call sites).
   */
  async applyChangesLegacy(
    changes: FileChange[],
  ): Promise<{ nodesAdded: number; nodesRemoved: number; edgesAdded: number }> {
    let nodesAdded = 0
    let nodesRemoved = 0
    let edgesAdded = 0

    for (const change of changes) {
      switch (change.type) {
        case "delete":
          nodesRemoved += this.handleDelete(change.filePath)
          break
        case "add":
        case "modify": {
          if (change.type === "modify") {
            nodesRemoved += this.handleDelete(change.filePath)
          }
          const added = await this.handleAddOrModify(change.filePath)
          nodesAdded += added.nodesAdded
          edgesAdded += added.edgesAdded
          break
        }
      }
    }

    return { nodesAdded, nodesRemoved, edgesAdded }
  }

  private handleDelete(filePath: string): number {
    const relPath = relative(this.rootDir, filePath).replace(/\\/g, "/")
    const fileNodes = this.graph.getNodesForFile(relPath)
    let removed = 0

    for (const node of fileNodes) {
      this.graph.removeNode(node.id)
      removed++
    }

    const fileNodeId = `file:${relPath}`
    if (this.graph.hasNode(fileNodeId)) {
      this.graph.removeNode(fileNodeId)
      removed++
    }

    this.callSites.removeByFile(relPath)

    return removed
  }

  private async handleAddOrModify(
    filePath: string,
  ): Promise<{ nodesAdded: number; edgesAdded: number }> {
    if (!this.extractor) return { nodesAdded: 0, edgesAdded: 0 }

    try {
      if (!existsSync(filePath)) return { nodesAdded: 0, edgesAdded: 0 }

      const source = await readFile(filePath, "utf-8")
      const mtime = statSync(filePath).mtimeMs
      const relPath = relative(this.rootDir, filePath).replace(/\\/g, "/")
      const tName = this.tokenizerName

      const result = await this.extractor(filePath, source, mtime)
      if (result.symbols.length === 0) return { nodesAdded: 0, edgesAdded: 0 }

      let nodesAdded = 0
      let edgesAdded = 0

      const fileId = `file:${relPath}`
      this.graph.addNode({
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
        tokenizerName: tName,
        metadata: {
          language: filePath.split(".").pop() ?? "",
          size: source.length,
          imports: result.imports,
          exports: result.exports,
        },
        mtime,
      })
      nodesAdded++

      for (const sym of result.symbols) {
        this.graph.addNode({
          id: sym.id,
          type: "symbol",
          symbolType: (sym.symbolType as never) ?? "unknown",
          name: sym.name,
          filePath: relPath,
          startLine: sym.startLine,
          endLine: sym.endLine,
          startByte: 0,
          endByte: 0,
          startToken: 0,
          endToken: 0,
          tokenizerName: tName,
          metadata: sym.metadata as never,
          mtime,
        })
        nodesAdded++

        this.graph.addEdge({ sourceId: fileId, targetId: sym.id, relation: "defines" })
        edgesAdded++

        if (sym.metadata.isExported) {
          this.graph.addEdge({ sourceId: fileId, targetId: sym.id, relation: "exports" })
          edgesAdded++
        }
      }

      const allSymbols = this.graph.findNodes((n) => n.type === "symbol")
      for (const imp of result.imports) {
        const resolvedPath = this.resolveImportSimple(imp.source, relPath)
        if (resolvedPath) {
          const edge: CodeGraphEdge = {
            sourceId: fileId,
            targetId: `file:${resolvedPath}`,
            relation: "imports",
          }
          this.graph.addEdge(edge)
          edgesAdded++

          for (const name of imp.names) {
            if (name === "*") continue
            for (const sym of allSymbols) {
              if (sym.name === name && sym.filePath === resolvedPath) {
                this.graph.addEdge({ sourceId: fileId, targetId: sym.id, relation: "references" })
                edgesAdded++
              }
            }
          }
        }
      }

      return { nodesAdded, edgesAdded }
    } catch {
      return { nodesAdded: 0, edgesAdded: 0 }
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
