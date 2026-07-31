import { readFile } from "node:fs/promises"
import { existsSync, statSync, readdirSync } from "node:fs"
import { join, relative, extname } from "node:path"
import { CodeGraph } from "./graph"
import { CallSiteStore, createCallSite } from "./callsite"
import { GraphPersistence } from "./persist"
import type {
  CodeGraphNode,
  CodeGraphEdge,
  CodeGraphConfig,
  CallSite,
  BuildEvent,
  BuildObserver,
  FileMetadata,
  SymbolMetadata,
} from "./types"
import { DEFAULT_CODEGRAPH_CONFIG } from "./types"
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
  readonly callSites: CallSiteStore
  private config: CodeGraphConfig
  private discoverFilesFn: DiscoverFilesFn
  private observers: BuildObserver[] = []
  private startedAt = 0
  private persistence: GraphPersistence | null = null

  constructor(config: CodeGraphConfig, options?: CodeGraphBuilderOptions) {
    this.config = { ...DEFAULT_CODEGRAPH_CONFIG, ...config }
    this.discoverFilesFn = options?.discoverFiles ?? defaultDiscoverFiles
    this.graph = new CodeGraph()
    this.callSites = new CallSiteStore()
    this.graph.setBidirectional(true)
    this.graph.addObserver((event) => this.notify(event))

    if (this.config.persistToDb) {
      this.persistence = new GraphPersistence(this.config.persistDir)
    }
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
    this.notify({
      type: "discover",
      phase: "discover",
      message: `Found ${result.length} files matching patterns`,
      nodeCount: result.length,
    })
    return result
  }

  private async extractSymbols(files: string[]): Promise<Map<string, ExtractResult>> {
    const batchSize = 50
    const results = new Map<string, ExtractResult>()
    let processed = 0
    const tokenizerName = this.config.tokenizerName
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize)
      const batchPromises = batch.map(async (filePath) => {
        try {
          const source = await readFile(filePath, "utf-8")
          const mtime = statSync(filePath).mtimeMs
          const extractResult = await extractFromFile(filePath, source, mtime, undefined, tokenizerName)
          return { filePath, result: extractResult, source }
        } catch (err) {
          this.notify({ type: "error", phase: "extract", file: filePath, message: `Extraction failed: ${String(err)}` })
          return { filePath, result: null, source: "" }
        }
      })
      const batchResults = await Promise.all(batchPromises)
      for (const { filePath, result } of batchResults) {
        if (result) { results.set(filePath, result); processed++ }
      }
      this.notify({
        type: "extract",
        phase: "extract",
        message: `Processed ${processed}/${files.length} files`,
        nodeCount: processed,
      })
    }
    return results
  }

  /**
   * Build the graph from extracted symbols, including:
   * - File & symbol nodes
   * - defines, exports, imports, references edges
   * - calls / called_by edges (bidirectional)
   * - overrides / overridden_by edges
   * - type_uses edges
   * - data_flow edges
   * - test_covers edges
   * - CallSites with token-level precision
   */
  private relateSymbols(extractionResults: Map<string, ExtractResult>): void {
    const allSymbolsByName = new Map<string, CodeGraphNode[]>()
    const allSourceCache = new Map<string, string>()

    for (const [filePath, result] of extractionResults) {
      const relPath = relative(this.config.rootDir, filePath).replace(/\\/g, "/")
      const fileId = `file:${relPath}`

      const fileMeta: FileMetadata = {
        language: extname(filePath).slice(1),
        size: 0,
        imports: result.imports,
        exports: result.exports,
      }
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
        tokenizerName: this.config.tokenizerName ?? "simple",
        metadata: fileMeta,
        mtime: Date.now(),
      }
      this.graph.addNode(fileNode)

      for (const sym of result.symbols) {
        sym.filePath = relPath
        this.graph.addNode(sym)
        this.graph.addEdge({ sourceId: fileId, targetId: sym.id, relation: "defines" })
        if ((sym.metadata as SymbolMetadata).isExported) {
          this.graph.addEdge({ sourceId: fileId, targetId: sym.id, relation: "exports" })
        }

        const key = (sym.symbolType ?? "unknown") + ":" + sym.name
        if (!allSymbolsByName.has(key)) allSymbolsByName.set(key, [])
        allSymbolsByName.get(key)!.push(sym)
      }
    }

    const allSymbols = this.graph.findNodes((n) => n.type === "symbol")

    this.buildImportEdges(allSymbols)
    this.buildCallEdges(extractionResults, allSymbolsByName)
    this.buildInheritanceEdges(allSymbols)
    this.buildTypeUsageEdges(allSymbols)
    this.buildDataFlowEdges(allSymbols)
    this.buildTestCoverEdges(allSymbols)

    this.notify({
      type: "relate",
      phase: "relate",
      nodeCount: this.graph.nodeCount,
      edgeCount: this.graph.edgeCount,
      message: "Cross-file relationships built with bidirectional edges and callsites",
    })
  }

  private buildImportEdges(allSymbols: CodeGraphNode[]): void {
    const fileNodes = this.graph.findNodes((n) => n.type === "file")

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
  }

  private buildCallEdges(
    extractionResults: Map<string, ExtractResult>,
    symbolsByName: Map<string, CodeGraphNode[]>,
  ): void {
    const srcDir = this.config.rootDir
    const tName = this.config.tokenizerName ?? "simple"

    for (const [filePath, result] of extractionResults) {
      const relPath = relative(srcDir, filePath).replace(/\\/g, "/")
      const fileSymbols = result.symbols

      const callerByName = new Map<string, CodeGraphNode>()
      for (const sym of fileSymbols) {
        if (sym.symbolType === "function" || sym.symbolType === "method") {
          if (!callerByName.has(sym.name)) {
            callerByName.set(sym.name, sym)
          }
        }
      }

      for (const call of result.calls) {
        const caller = callerByName.get(call.callerName)
        if (!caller) continue

        const candidates: CodeGraphNode[] = []
        const funcKey = "function:" + call.calleeName
        const funcMatch = symbolsByName.get(funcKey)
        if (funcMatch) candidates.push(...funcMatch)

        const methodKey = "method:" + call.calleeName
        const methodMatch = symbolsByName.get(methodKey)
        if (methodMatch) candidates.push(...methodMatch)

        const classKey = "class:" + call.calleeName
        const classMatch = symbolsByName.get(classKey)
        if (classMatch) candidates.push(...classMatch)

        if (candidates.length === 0) continue

        const dedupeSet = new Set<string>()
        for (const callee of candidates) {
          if (callee.id === caller.id) continue
          const dedupeKey = `${caller.id}->${callee.id}`
          if (dedupeSet.has(dedupeKey)) continue
          dedupeSet.add(dedupeKey)

          const edge: CodeGraphEdge = {
            sourceId: caller.id,
            targetId: callee.id,
            relation: "calls",
            sourceLoc: { startLine: call.startLine, endLine: call.endLine },
          }
          this.graph.addEdge(edge)

          this.callSites.add(createCallSite({
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
          }))
        }
      }
    }
  }

  private buildInheritanceEdges(allSymbols: CodeGraphNode[]): void {
    const classes = allSymbols.filter((s) => s.symbolType === "class")
    const classByName = new Map<string, CodeGraphNode[]>()

    for (const cls of classes) {
      if (!classByName.has(cls.name)) classByName.set(cls.name, [])
      classByName.get(cls.name)!.push(cls)
    }

    for (const cls of classes) {
      const methods = allSymbols.filter(
        (s) =>
          (s.symbolType === "method") &&
          (s.metadata as SymbolMetadata).parentId === cls.id,
      )

      const possibleParents = classByName.get(cls.name) ?? []
      for (const parent of possibleParents) {
        if (parent.id === cls.id) continue
        const parentMethods = allSymbols.filter(
          (s) =>
            (s.symbolType === "method") &&
            (s.metadata as SymbolMetadata).parentId === parent.id,
        )

        for (const method of methods) {
          for (const parentMethod of parentMethods) {
            if (method.name === parentMethod.name) {
              this.graph.addEdge({ sourceId: method.id, targetId: parentMethod.id, relation: "overrides" })
            }
          }
        }
      }
    }
  }

  private buildTypeUsageEdges(allSymbols: CodeGraphNode[]): void {
    const types = allSymbols.filter(
      (s) => s.symbolType === "class" || s.symbolType === "interface" || s.symbolType === "type" || s.symbolType === "enum",
    )
    const typeNames = new Set(types.map((t) => t.name))

    for (const sym of allSymbols) {
      const meta = sym.metadata as SymbolMetadata
      if (!meta.parameters && !meta.returnType) continue

      if (meta.parameters) {
        for (const param of meta.parameters) {
          const typeName = extractBaseType(param.type)
          if (typeNames.has(typeName)) {
            for (const typeEnt of types) {
              if (typeEnt.name === typeName) {
                this.graph.addEdge({ sourceId: typeEnt.id, targetId: sym.id, relation: "type_uses" })
              }
            }
          }
        }
      }

      if (meta.returnType) {
        const typeName = extractBaseType(meta.returnType)
        if (typeNames.has(typeName)) {
          for (const typeEnt of types) {
            if (typeEnt.name === typeName) {
              this.graph.addEdge({ sourceId: typeEnt.id, targetId: sym.id, relation: "type_uses" })
            }
          }
        }
      }
    }
  }

  private buildDataFlowEdges(allSymbols: CodeGraphNode[]): void {
    const vars = allSymbols.filter((s) => s.symbolType === "variable")
    const funcs = allSymbols.filter((s) => s.symbolType === "function" || s.symbolType === "method")

    for (const func of funcs) {
      const meta = func.metadata as SymbolMetadata
      if (!meta.parameters) continue
      for (const param of meta.parameters) {
        for (const v of vars) {
          if (v.name === param.name && v.filePath === func.filePath && v.startToken <= func.startToken) {
            this.graph.addEdge({ sourceId: v.id, targetId: func.id, relation: "data_flow" })
          }
        }
      }
    }
  }

  private buildTestCoverEdges(allSymbols: CodeGraphNode[]): void {
    const testFiles = this.graph.findNodes((n) =>
      n.type === "file" && (
        n.name.toLowerCase().includes("test") ||
        n.name.toLowerCase().includes(".spec.") ||
        n.name.toLowerCase().includes(".test.") ||
        n.name.toLowerCase().includes("__tests__")
      ),
    )
    const testFuncs = allSymbols.filter(
      (s) =>
        (s.symbolType === "function" || s.symbolType === "method") &&
        (s.name.startsWith("test") || s.name.startsWith("it") || s.name.startsWith("spec")),
    )

    const testDirSet = new Set(testFiles.map((f) => f.name.replace(/\/[^/]+$/, "")))
    const allFuncs = allSymbols.filter((s) => s.symbolType === "function" || s.symbolType === "method")

    for (const testFunc of testFuncs) {
      if (!testDirSet.has(testFunc.filePath.replace(/\/[^/]+$/, ""))) {
        const srcPath = testFunc.filePath
          .replace("__tests__/", "")
          .replace(".test.", ".")
          .replace(".spec.", ".")
        const srcSymbols = allFuncs.filter(
          (s) => s.filePath === srcPath || s.filePath === srcPath.replace(/\.test\./, "."),
        )
        for (const src of srcSymbols) {
          this.graph.addEdge({ sourceId: testFunc.id, targetId: src.id, relation: "test_covers" })
        }
      }
    }

    for (const tf of testFuncs) {
      for (const sym of allFuncs) {
        if (sym.id === tf.id) continue
        if (sym.name.startsWith("test") || sym.name.startsWith("it")) continue
        if (tf.startToken >= sym.startToken && tf.endToken <= sym.endToken && tf.filePath === sym.filePath) continue
      }
    }
  }

  private async indexGraph(): Promise<void> {
    this.notify({
      type: "index",
      phase: "index",
      nodeCount: this.graph.nodeCount,
      edgeCount: this.graph.edgeCount,
      message: `Graph indexed: ${this.graph.nodeCount} nodes, ${this.graph.edgeCount} edges, ${this.callSites.size} callsites`,
    })
  }

  async build(): Promise<CodeGraph> {
    this.startedAt = Date.now()
    this.graph.clear()
    this.callSites.clear()

    if (this.persistence) {
      const persisted = await this.persistence.load()
      if (persisted && persisted.nodes.length > 0) {
        for (const node of persisted.nodes) this.graph.addNode(node)
        for (const edge of persisted.edges) this.graph.addEdge(edge)
        if (persisted.callSites) {
          for (const cs of persisted.callSites) this.callSites.add(cs)
        }
        this.notify({
          type: "complete",
          phase: "build",
          nodeCount: this.graph.nodeCount,
          edgeCount: this.graph.edgeCount,
          message: `Loaded from persistence: ${this.graph.nodeCount} nodes, ${this.graph.edgeCount} edges`,
        })
        return this.graph
      }
    }

    const files = await this.discoverFiles()
    if (files.length === 0) {
      this.notify({ type: "complete", phase: "build", message: "No files found to analyze" })
      return this.graph
    }

    const extractionResults = await this.extractSymbols(files)
    this.relateSymbols(extractionResults)
    await this.indexGraph()

    if (this.persistence) {
      try {
        await this.persistence.save(
          this.graph.toJSON().nodes,
          this.graph.toJSON().edges,
          this.callSites.toJSON(),
        )
      } catch { /* non-critical */ }
    }

    this.notify({
      type: "complete",
      phase: "build",
      nodeCount: this.graph.nodeCount,
      edgeCount: this.graph.edgeCount,
      durationMs: Date.now() - this.startedAt,
      message: `Build complete: ${this.graph.nodeCount} nodes, ${this.graph.edgeCount} edges, ${this.graph.fileCount} files`,
    })
    return this.graph
  }

  /** Persist current state for incremental update recovery */
  async persistState(): Promise<void> {
    if (!this.persistence) return
    try {
      await this.persistence.save(
        this.graph.toJSON().nodes,
        this.graph.toJSON().edges,
        this.callSites.toJSON(),
      )
    } catch { /* non-critical */ }
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

function extractBaseType(typeStr: string): string {
  const cleaned = typeStr
    .replace(/^Optional\[/i, "")
    .replace(/^Array\[/i, "")
    .replace(/^Promise\[/i, "")
    .replace(/\[.*\]$/, "")
    .replace(/<.*>$/, "")
    .replace(/[\[\]<>]/g, "")
    .replace(/\|.+$/, "")
    .trim()
  return cleaned
}
