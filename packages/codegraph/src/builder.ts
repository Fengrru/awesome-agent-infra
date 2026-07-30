import { readFile } from "node:fs/promises"
import { existsSync, statSync, readdirSync } from "node:fs"
import { join, relative, extname } from "node:path"
import { CodeGraph } from "./graph"
import { type CodeGraphNode, type CodeGraphEdge, type CodeGraphConfig, type BuildEvent, type BuildObserver, DEFAULT_CODEGRAPH_CONFIG, type FileMetadata, type SymbolMetadata } from "./types"
import { extractFromFile, type ExtractResult } from "./extractor"

export type DiscoverFilesFn = (config: CodeGraphConfig) => Promise<string[]>

function defaultDiscoverFiles(config: CodeGraphConfig): Promise<string[]> {
  const { include, exclude = [], rootDir } = config
  if (!include || include.length === 0) return Promise.resolve([])
  const includeExts = new Set<string>()
  const excludeSet = new Set(exclude.map((p) => p.replace(/^\*\*/, "").replace(/\/\*$/, "")))
  for (const pattern of include) {
    const ext = pattern.replace(/^\*\*\//, "").replace(/^\*\//, "").replace(/^\*\./, ".")
    includeExts.add(ext)
  }
  const files: string[] = []
  function walk(dir: string) {
    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = join(dir, entry.name)
        const relPath = relative(rootDir, fullPath).replace(/\\/g, "/")
        if (excludeSet.has(entry.name) || relPath.startsWith(".")) continue
        if (entry.isDirectory()) {
          if (entry.name !== "node_modules" && entry.name !== ".git" && !entry.name.startsWith(".")) {
            walk(fullPath)
          }
        } else if (entry.isFile()) {
          const ext = extname(entry.name)
          if (includeExts.has(ext) || includeExts.has("*.*") || includeExts.has("*")) {
            files.push(fullPath)
          }
        }
      }
    } catch { /* skip inaccessible directories */ }
  }
  walk(rootDir)
  return Promise.resolve(files)
}

export interface CodeGraphBuilderOptions {
  discoverFiles?: DiscoverFilesFn
}

export class CodeGraphBuilder {
  readonly graph: CodeGraph
  private config: CodeGraphConfig
  private discoverFilesFn: DiscoverFilesFn
  private observers: BuildObserver[] = []
  private startedAt = 0

  constructor(config: CodeGraphConfig, options?: CodeGraphBuilderOptions) {
    this.config = { ...DEFAULT_CODEGRAPH_CONFIG, ...config }
    this.discoverFilesFn = options?.discoverFiles ?? defaultDiscoverFiles
    this.graph = new CodeGraph()
    this.graph.addObserver((event) => this.notify(event))
  }

  addObserver(observer: BuildObserver): void {
    this.observers.push(observer)
  }

  private notify(event: BuildEvent): void {
    for (const obs of this.observers) {
      try { obs(event) } catch (e) { console.warn("[CodeGraph] observer notification failed:", e) }
    }
  }

  private async discoverFiles(): Promise<string[]> {
    const result = await this.discoverFilesFn(this.config)
    this.notify({ type: "discover", phase: "discover", message: `Found ${result.length} files matching patterns`, nodeCount: result.length })
    return result
  }

  private async extractSymbols(files: string[]): Promise<Map<string, ExtractResult>> {
    const batchSize = 50
    const results = new Map<string, ExtractResult>()
    let processed = 0
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize)
      const batchPromises = batch.map(async (filePath) => {
        try {
          const source = await readFile(filePath, "utf-8")
          const mtime = statSync(filePath).mtimeMs
          const extractResult = await extractFromFile(filePath, source, mtime)
          return { filePath, result: extractResult }
        } catch (err) {
          this.notify({ type: "error", phase: "extract", file: filePath, message: `Extraction failed: ${String(err)}` })
          return { filePath, result: null }
        }
      })
      const batchResults = await Promise.all(batchPromises)
      for (const { filePath, result } of batchResults) {
        if (result) { results.set(filePath, result); processed++ }
      }
      this.notify({ type: "extract", phase: "extract", message: `Processed ${processed}/${files.length} files`, nodeCount: processed })
    }
    return results
  }

  private relateSymbols(extractionResults: Map<string, ExtractResult>): void {
    for (const [filePath, result] of extractionResults) {
      const relPath = relative(this.config.rootDir, filePath)
      const fileId = `file:${relPath}`
      this.graph.addNode({
        id: fileId, type: "file", name: relPath, filePath: relPath,
        startLine: 1, endLine: 0,
        metadata: { language: extname(filePath).slice(1), size: 0, imports: result.imports, exports: result.exports } satisfies FileMetadata,
        mtime: Date.now(),
      })
      for (const sym of result.symbols) {
        sym.filePath = relPath
        this.graph.addNode(sym)
        this.graph.addEdge({ sourceId: fileId, targetId: sym.id, relation: "defines" })
        if ((sym.metadata as SymbolMetadata).isExported) {
          this.graph.addEdge({ sourceId: fileId, targetId: sym.id, relation: "exports" })
        }
      }
    }

    const fileNodes = this.graph.findNodes((n) => n.type === "file")
    const allSymbols = this.graph.findNodes((n) => n.type === "symbol")

    for (const fileNode of fileNodes) {
      const meta = fileNode.metadata as FileMetadata
      if (!meta.imports) continue
      for (const imp of meta.imports) {
        const resolvedPath = this.resolveImportPath(fileNode.name, imp.source)
        if (!resolvedPath) continue
        this.graph.addEdge({ sourceId: fileNode.id, targetId: `file:${resolvedPath}`, relation: "imports" })
        if (imp.names.includes("*")) {
          const targetExports = this.graph.getOutgoing(`file:${resolvedPath}`, "exports")
          for (const exp of targetExports) {
            this.graph.addEdge({ sourceId: fileNode.id, targetId: exp.id, relation: "references" })
          }
        }
        for (const name of imp.names) {
          if (name === "*") continue
          const matchingSymbols = allSymbols.filter((s) => s.name === name && s.filePath === resolvedPath)
          for (const sym of matchingSymbols) {
            this.graph.addEdge({ sourceId: fileNode.id, targetId: sym.id, relation: "references" })
          }
        }
      }
    }

    this.notify({ type: "relate", phase: "relate", nodeCount: this.graph.nodeCount, edgeCount: this.graph.edgeCount, message: "Cross-file relationships built" })
  }

  private async indexGraph(): Promise<{ nodes: CodeGraphNode[]; edges: CodeGraphEdge[] }> {
    const serialized = this.graph.toJSON()
    this.notify({ type: "index", phase: "index", nodeCount: serialized.nodes.length, edgeCount: serialized.edges.length, message: `Graph indexed: ${serialized.nodes.length} nodes, ${serialized.edges.length} edges` })
    return serialized
  }

  async build(): Promise<CodeGraph> {
    this.startedAt = Date.now()
    this.graph.clear()
    const files = await this.discoverFiles()
    if (files.length === 0) {
      this.notify({ type: "complete", phase: "build", message: "No files found to analyze" })
      return this.graph
    }
    const extractionResults = await this.extractSymbols(files)
    this.relateSymbols(extractionResults)
    await this.indexGraph()
    this.notify({
      type: "complete", phase: "build", nodeCount: this.graph.nodeCount, edgeCount: this.graph.edgeCount,
      durationMs: Date.now() - this.startedAt,
      message: `Build complete: ${this.graph.nodeCount} nodes, ${this.graph.edgeCount} edges, ${this.graph.fileCount} files`,
    })
    return this.graph
  }

  private resolveImportPath(sourceFile: string, importSource: string): string | null {
    if (!importSource.startsWith(".") && !importSource.startsWith("/")) return null
    const sourceDir = join(this.config.rootDir, sourceFile, "..")
    const rootDir = this.config.rootDir
    const resolved = join(sourceDir, importSource)
    const extensions = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", "/index.ts", "/index.js"]
    for (const ext of extensions) {
      const candidate = resolved + ext
      if (existsSync(candidate)) return relative(rootDir, candidate).replace(/\\/g, "/")
    }
    const knownFiles = this.graph.findNodes((n) => n.type === "file")
    const normalizedImport = importSource.replace(/\\/g, "/").replace(/\.\w+$/, "")
    for (const file of knownFiles) {
      const normalizedFile = file.name.replace(/\.\w+$/, "")
      if (normalizedFile.endsWith(normalizedImport) || normalizedFile === normalizedImport) return file.name
    }
    return null
  }
}
