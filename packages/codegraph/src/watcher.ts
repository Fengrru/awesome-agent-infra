/**
 * CodeGraph Watcher — Incremental Update Mechanism
 *
 * Monitors file changes and updates the code graph incrementally:
 * - File modified: re-extract symbols, update edges
 * - File added: extract and link into graph
 * - File deleted: remove associated nodes and edges
 *
 * @module codegraph/watcher
 */

import { readFile } from "node:fs/promises"
import { existsSync, statSync } from "node:fs"
import { relative } from "node:path"
import { CodeGraph } from "./graph"
import type { CodeGraphEdge } from "./types"

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
  private rootDir: string
  private extractor: ExtractorFn | null = null

  constructor(graph: CodeGraph, rootDir: string) {
    this.graph = graph
    this.rootDir = rootDir
  }

  /** Set the extractor function for parsing file sources */
  setExtractor(fn: ExtractorFn): void {
    this.extractor = fn
  }

  async applyChanges(
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

      const result = await this.extractor(filePath, source, mtime)
      if (result.symbols.length === 0) return { nodesAdded: 0, edgesAdded: 0 }

      let nodesAdded = 0
      let edgesAdded = 0

      // Create file node
      const fileId = `file:${relPath}`
      this.graph.addNode({
        id: fileId,
        type: "file",
        name: relPath,
        filePath: relPath,
        startLine: 1,
        endLine: 0,
        metadata: {
          language: filePath.split(".").pop() ?? "",
          size: source.length,
          imports: result.imports,
          exports: result.exports,
        },
        mtime,
      })
      nodesAdded++

      // Add symbol nodes
      for (const sym of result.symbols) {
        this.graph.addNode({
          id: sym.id,
          type: "symbol",
          symbolType: (sym.symbolType as never) ?? "unknown",
          name: sym.name,
          filePath: relPath,
          startLine: sym.startLine,
          endLine: sym.endLine,
          metadata: sym.metadata as never,
          mtime,
        })
        nodesAdded++

        // File→symbol defines
        this.graph.addEdge({
          sourceId: fileId,
          targetId: sym.id,
          relation: "defines",
        })
        edgesAdded++

        if (sym.metadata.isExported) {
          this.graph.addEdge({
            sourceId: fileId,
            targetId: sym.id,
            relation: "exports",
          })
          edgesAdded++
        }
      }

      // Resolve imports
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
                this.graph.addEdge({
                  sourceId: fileId,
                  targetId: sym.id,
                  relation: "references",
                })
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
