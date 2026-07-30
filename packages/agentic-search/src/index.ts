/**
 * Agentic Search — Four-Layer Code Search Orchestrator
 *
 * Unlike traditional RAG with a fixed pipeline, Agentic Search dynamically
 * plans which tools to use based on query intent, supports parallel execution,
 * and fuses results from multiple search sources.
 *
 * ## Four-Layer Architecture
 * 1. Intent Layer (What): Parse natural language query into structured intent
 * 2. Strategy Layer (How): Plan which tools to use and in what order
 * 3. Execution Layer (Do): Invoke tools respecting dependencies + parallelism
 * 4. Fusion Layer (Merge): Deduplicate, rank, trim to token budget
 *
 * ## Integration
 * Inject your own CodeGraph searcher and HybridSearch implementation via
 * the ISymbolSearcher and ISemanticSearcher interfaces.
 *
 * @module agentic-search
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type SearchIntentType =
  | "find_symbol"
  | "find_code"
  | "understand_module"
  | "trace_call"
  | "find_usage"
  | "explore_file"
  | "dependency_graph"
  | "semantic_search"
  | "general_query"

export interface SearchIntent {
  type: SearchIntentType
  query: string
  target?: string
  scope?: string
}

export type ToolName =
  | "code_symbol"
  | "code_graph"
  | "semantic_search"
  | "grep"
  | "glob"
  | "memory_retrieve"
  | "file_read"

export interface ToolPlan {
  tool: ToolName
  params: Record<string, unknown>
  priority: number
  dependsOn?: string[]
}

export interface SearchStrategy {
  intent: SearchIntent
  tools: ToolPlan[]
  parallel: boolean
  maxTokens: number
}

export interface ToolResult {
  tool: ToolName
  success: boolean
  data: string
  tokens: number
  durationMs: number
  error?: string
}

export interface FusedResult {
  text: string
  estimatedTokens: number
  contributions: ToolResult[]
  confidence: number
}

export interface AgenticSearchConfig {
  maxTokens: number
  enableLLMIntentParsing: boolean
  toolTimeoutMs: number
}

export const DEFAULT_AGENTIC_SEARCH_CONFIG: AgenticSearchConfig = {
  maxTokens: 4000,
  enableLLMIntentParsing: false,
  toolTimeoutMs: 15000,
}

// ─── Injected Interfaces ────────────────────────────────────────────────────

/** Symbol search result from CodeGraph or similar */
export interface SymbolResult {
  node: {
    id: string
    name: string
    type: string
    symbolType?: string
    filePath: string
    startLine: number
    metadata?: Record<string, unknown>
  }
  score: number
  matchedOn: string
  context?: SubGraphResult
}

export interface SubGraphResult {
  nodes: Array<{ id: string; name: string; type: string; filePath: string; startLine: number }>
  edges: Array<{ sourceId: string; targetId: string; relation: string }>
  estimatedTokens: number
}

/** Pluggable symbol searcher (e.g., CodeGraphSearcher) */
export interface ISymbolSearcher {
  searchSymbols(query: string, options?: { maxResults?: number; kHop?: number }): SymbolResult[]
  searchByType(symbolType: string, options?: { maxResults?: number; kHop?: number }): SymbolResult[]
  searchByFile(filePath: string, options?: { kHop?: number }): SymbolResult[]
  getEgoGraph(nodeId: string, k?: number): SubGraphResult
  getFileContext(filePath: string): SubGraphResult
  flattenResults(results: SymbolResult[], options?: { includeDocComments?: boolean }): string
}

/** Semantic search result */
export interface SemanticResult {
  text: string
  compositeScore: number
  metadata: Record<string, unknown>
}

/** Pluggable semantic searcher (e.g., HybridSearch) */
export interface ISemanticSearcher {
  search(query: string): Promise<SemanticResult[]>
}

// ─── SearchTool Interface ───────────────────────────────────────────────────

export interface SearchTool {
  name: ToolName
  description: string
  execute(params: Record<string, unknown>): Promise<ToolResult>
  estimateCost(params: Record<string, unknown>): number
}

// ─── SearchToolRegistry ─────────────────────────────────────────────────────

export class SearchToolRegistry {
  private tools = new Map<ToolName, SearchTool>()

  register(tool: SearchTool): void {
    this.tools.set(tool.name, tool)
  }

  get(name: ToolName): SearchTool | undefined {
    return this.tools.get(name)
  }

  getAll(): SearchTool[] {
    return Array.from(this.tools.values())
  }

  getDescriptions(): Array<{ name: string; description: string }> {
    return this.getAll().map((t) => ({ name: t.name, description: t.description }))
  }
}

// ─── Tool Factory ───────────────────────────────────────────────────────────

export function createSearchTools(
  symbolSearcher: ISymbolSearcher,
  semanticSearcher: ISemanticSearcher,
): SearchTool[] {
  return [
    createCodeSymbolTool(symbolSearcher),
    createCodeGraphTool(symbolSearcher),
    createSemanticSearchTool(semanticSearcher),
  ]
}

function createCodeSymbolTool(searcher: ISymbolSearcher): SearchTool {
  return {
    name: "code_symbol",
    description:
      "Search for code symbols (functions, classes, interfaces) by name. Use when the user asks about a specific symbol or where something is defined.",
    async execute(params) {
      const query = String(params.query ?? "")
      const maxResults = Number(params.maxResults ?? 10)
      const kHop = Number(params.kHop ?? 1)

      const results = searcher.searchSymbols(query, { maxResults, kHop })
      const text = searcher.flattenResults(results, { includeDocComments: true })

      return {
        tool: "code_symbol",
        success: true,
        data: text,
        tokens: Math.ceil(text.length / 4),
        durationMs: 0,
      }
    },
    estimateCost(params) {
      const query = String(params.query ?? "")
      return Math.ceil(query.length / 4) + 50
    },
  }
}

function createCodeGraphTool(searcher: ISymbolSearcher): SearchTool {
  return {
    name: "code_graph",
    description:
      "Explore the code structure graph around a symbol or file. Shows callers, callees, imports, and dependencies. Use for understanding how things connect.",
    async execute(params) {
      const nodeId = String(params.nodeId ?? "")
      const filePath = String(params.filePath ?? "")
      const k = Number(params.k ?? 1)

      let text: string
      if (nodeId) {
        const sg = searcher.getEgoGraph(nodeId, k)
        text =
          sg.nodes.length > 0
            ? formatSubGraph(sg)
            : `No graph data found for node: ${nodeId}`
      } else if (filePath) {
        const sg = searcher.getFileContext(filePath)
        text =
          sg.nodes.length > 0
            ? formatSubGraph(sg)
            : `No graph data found for file: ${filePath}`
      } else {
        text = "Specify either nodeId or filePath"
      }

      return {
        tool: "code_graph",
        success: true,
        data: text,
        tokens: Math.ceil(text.length / 4),
        durationMs: 0,
      }
    },
    estimateCost() {
      return 100
    },
  }
}

function formatSubGraph(sg: SubGraphResult): string {
  const lines: string[] = []
  lines.push(`# SubGraph (${sg.nodes.length} nodes, ${sg.edges.length} edges)`)
  lines.push("")
  for (const node of sg.nodes) {
    lines.push(`- [${node.type}] ${node.name}  (${node.filePath}:${node.startLine})`)
  }
  lines.push("")
  lines.push("## Relations")
  for (const edge of sg.edges) {
    lines.push(`  ${edge.sourceId} --[${edge.relation}]--> ${edge.targetId}`)
  }
  return lines.join("\n")
}

function createSemanticSearchTool(hybridSearch: ISemanticSearcher): SearchTool {
  return {
    name: "semantic_search",
    description:
      "Semantic code search using vector similarity. Best for finding code by concept/meaning rather than exact name. Use when the user describes what the code does rather than its name.",
    async execute(params) {
      const query = String(params.query ?? "")
      const topK = Number(params.topK ?? 10)

      const results = await hybridSearch.search(query)
      const lines: string[] = ["# Semantic Search Results", ""]

      for (let i = 0; i < Math.min(results.length, topK); i++) {
        const r = results[i]!
        const meta = r.metadata
        lines.push(
          `${i + 1}. ${r.text}  (score=${r.compositeScore.toFixed(3)})  [${meta.type ?? meta.filePath ?? ""}]`,
        )
      }

      const text = lines.join("\n")
      return {
        tool: "semantic_search",
        success: true,
        data: text,
        tokens: Math.ceil(text.length / 4),
        durationMs: 0,
      }
    },
    estimateCost(params) {
      const query = String(params.query ?? "")
      return Math.ceil(query.length / 4) + 30
    },
  }
}

// ─── AgenticSearchOrchestrator ──────────────────────────────────────────────

export class AgenticSearchOrchestrator {
  private config: AgenticSearchConfig
  private toolRegistry: SearchToolRegistry
  private symbolSearcher: ISymbolSearcher
  private semanticSearcher: ISemanticSearcher

  constructor(
    symbolSearcher: ISymbolSearcher,
    semanticSearcher: ISemanticSearcher,
    config?: Partial<AgenticSearchConfig>,
  ) {
    this.config = { ...DEFAULT_AGENTIC_SEARCH_CONFIG, ...config }
    this.symbolSearcher = symbolSearcher
    this.semanticSearcher = semanticSearcher
    this.toolRegistry = new SearchToolRegistry()
  }

  /**
   * Full search pipeline: Intent → Strategy → Execution → Fusion
   */
  async search(query: string): Promise<FusedResult> {
    const intent = this.parseIntent(query)
    const strategy = this.planStrategy(intent)
    const toolResults = await this.executeStrategy(strategy)
    return this.fuseResults(toolResults, strategy)
  }

  // ── Layer 1: Intent Parsing ──────────────────────────────────────────

  /**
   * Parse natural language query into a structured SearchIntent.
   * Uses rule-based parsing by default; can be upgraded to LLM-based.
   */
  parseIntent(query: string): SearchIntent {
    const q = query.toLowerCase().trim()

    if (this.matchPattern(q, /^(where|find|show)\s+(is|me)?\s*(the\s+)?(\w[\w.]*)/)) {
      return { type: "find_symbol", query, target: this.extractTarget(q), scope: "all" }
    }

    if (this.matchPattern(q, /^(who|what)\s+(calls|uses|references)\s+(\w[\w.]*)/)) {
      return { type: "trace_call", query, target: this.extractTargetByIndex(q, 3), scope: "all" }
    }

    if (this.matchPattern(q, /^(how|explain|describe|understand)\s+(does\s+)?(the\s+)?(\w[\w./]*)/)) {
      return { type: "understand_module", query, target: this.extractTargetByIndex(q, 4), scope: "all" }
    }

    if (this.matchPattern(q, /^(what|which)\s+(does|are)\s+(\w[\w./]*)\s+(depend|import|use)/)) {
      return { type: "dependency_graph", query, target: this.extractTargetByIndex(q, 3), scope: "all" }
    }

    if (this.matchPattern(q, /^(what's|what is|show|list)\s+in\s+(\w[\w./]*)/)) {
      return { type: "explore_file", query, target: this.extractTargetByIndex(q, 2), scope: "file" }
    }

    if (this.matchPattern(q, /(find|search|look for)\s+(code|functionality)\s+(that|which|about|to)\s+(.+)/)) {
      return { type: "semantic_search", query, target: this.extractTargetByIndex(q, 4), scope: "all" }
    }

    return { type: "general_query", query, target: query, scope: "all" }
  }

  // ── Layer 2: Strategy Planning ───────────────────────────────────────

  planStrategy(intent: SearchIntent): SearchStrategy {
    const target = intent.target ?? intent.query

    switch (intent.type) {
      case "find_symbol":
        return {
          intent,
          tools: [
            { tool: "code_symbol", params: { query: target, maxResults: 10, kHop: 1 }, priority: 0 },
            { tool: "semantic_search", params: { query: intent.query, topK: 5 }, priority: 1 },
          ],
          parallel: true,
          maxTokens: this.config.maxTokens,
        }

      case "trace_call":
        return {
          intent,
          tools: [
            { tool: "code_symbol", params: { query: target, maxResults: 5, kHop: 0 }, priority: 0 },
            { tool: "code_graph", params: { nodeId: ``, k: 2 }, priority: 1, dependsOn: ["code_symbol"] },
          ],
          parallel: false,
          maxTokens: this.config.maxTokens,
        }

      case "understand_module":
        return {
          intent,
          tools: [
            { tool: "code_symbol", params: { query: target, maxResults: 20, kHop: 1 }, priority: 0 },
            { tool: "code_graph", params: { filePath: target, k: 1 }, priority: 1 },
          ],
          parallel: true,
          maxTokens: this.config.maxTokens,
        }

      case "dependency_graph":
        return {
          intent,
          tools: [
            { tool: "code_graph", params: { filePath: target, k: 1 }, priority: 0 },
            { tool: "code_symbol", params: { query: target, maxResults: 10, kHop: 0 }, priority: 1 },
          ],
          parallel: true,
          maxTokens: this.config.maxTokens,
        }

      case "explore_file":
        return {
          intent,
          tools: [
            { tool: "code_graph", params: { filePath: target, k: 1 }, priority: 0 },
            { tool: "code_symbol", params: { query: target, maxResults: 50, kHop: 0 }, priority: 1 },
          ],
          parallel: true,
          maxTokens: this.config.maxTokens,
        }

      case "semantic_search":
        return {
          intent,
          tools: [{ tool: "semantic_search", params: { query: intent.query, topK: 15 }, priority: 0 }],
          parallel: false,
          maxTokens: this.config.maxTokens,
        }

      case "general_query":
      default:
        return {
          intent,
          tools: [
            { tool: "semantic_search", params: { query: intent.query, topK: 10 }, priority: 0 },
            { tool: "code_symbol", params: { query: target, maxResults: 10, kHop: 0 }, priority: 1 },
          ],
          parallel: true,
          maxTokens: this.config.maxTokens,
        }
    }
  }

  // ── Layer 3: Execution ───────────────────────────────────────────────

  private async executeStrategy(strategy: SearchStrategy): Promise<ToolResult[]> {
    const results: ToolResult[] = []
    const completed = new Map<string, ToolResult>()

    const sorted = this.topologicalSort(strategy.tools)

    for (const plan of sorted) {
      if (plan.dependsOn) {
        const allMet = plan.dependsOn.every((dep) => completed.has(dep))
        if (!allMet) {
          results.push({
            tool: plan.tool,
            success: false,
            data: `Skipped: missing dependency ${plan.dependsOn.filter((d) => !completed.has(d)).join(", ")}`,
            tokens: 0,
            durationMs: 0,
          })
          continue
        }

        if (plan.tool === "code_graph" && !plan.params.nodeId) {
          const depResult = completed.get(plan.dependsOn[0]!)
          if (depResult?.success) {
            const match = depResult.data.match(/\[(\d+)\]\s+([\w.]+)/)
            if (match) {
              plan.params.query = match[2]
            }
          }
        }
      }

      const tool = this.toolRegistry.get(plan.tool)
      if (!tool) {
        results.push({
          tool: plan.tool,
          success: false,
          data: `Tool not registered: ${plan.tool}`,
          tokens: 0,
          durationMs: 0,
        })
        continue
      }

      const result = await this.executeWithTimeout(tool, plan.params)
      results.push(result)
      completed.set(plan.tool, result)
    }

    return results
  }

  private async executeWithTimeout(
    tool: SearchTool,
    params: Record<string, unknown>,
  ): Promise<ToolResult> {
    const timeout = this.config.toolTimeoutMs
    const startTime = Date.now()

    try {
      const result = await Promise.race([
        tool.execute(params),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Tool ${tool.name} timed out after ${timeout}ms`)),
            timeout,
          ),
        ),
      ])

      return { ...result, durationMs: Date.now() - startTime }
    } catch (err) {
      return {
        tool: tool.name,
        success: false,
        data: `Error: ${String(err)}`,
        tokens: 0,
        durationMs: Date.now() - startTime,
      }
    }
  }

  // ── Layer 4: Fusion ──────────────────────────────────────────────────

  fuseResults(results: ToolResult[], strategy: SearchStrategy): FusedResult {
    const sections: string[] = []
    let totalTokens = 0
    const maxTokens = strategy.maxTokens

    const successfulResults = results.filter((r) => r.success)

    if (successfulResults.length === 0) {
      const errors = results
        .filter((r) => !r.success)
        .map((r) => r.error)
        .filter(Boolean)
      return {
        text:
          errors.length > 0
            ? `Search completed with errors:\n${errors.join("\n")}`
            : "No results found.",
        estimatedTokens: 50,
        contributions: results,
        confidence: 0,
      }
    }

    for (const result of successfulResults) {
      const header = `## Tool: ${result.tool}`
      const section = `${header}\n\n${result.data}\n`
      const sectionTokens = Math.ceil(section.length / 4)

      if (totalTokens + sectionTokens > maxTokens) {
        const truncated = result.data.slice(0, (maxTokens - totalTokens) * 4)
        sections.push(`${header}\n\n${truncated}\n\n[...truncated]`)
        totalTokens = maxTokens
        break
      }

      sections.push(section)
      totalTokens += sectionTokens
    }

    const text = sections.join("\n---\n")
    const successRate = successfulResults.length / results.length
    const dataRichness = Math.min(1, totalTokens / 1000)
    const confidence = successRate * 0.6 + dataRichness * 0.4

    return { text, estimatedTokens: totalTokens, contributions: results, confidence }
  }

  // ─── Register Tools ──────────────────────────────────────────────────

  registerTools(): void {
    const tools = createSearchTools(this.symbolSearcher, this.semanticSearcher)
    for (const tool of tools) {
      this.toolRegistry.register(tool)
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  private matchPattern(query: string, regex: RegExp): boolean {
    return regex.test(query)
  }

  private extractTarget(query: string): string {
    const match = query.match(/(\w[\w.]*)$/)
    return match?.[1] ?? query
  }

  private extractTargetByIndex(_query: string, _groupIndex: number): string {
    const match = _query.match(/(\w[\w./]*)$/)
    return match?.[1] ?? _query
  }

  private topologicalSort(tools: ToolPlan[]): ToolPlan[] {
    const visited = new Set<string>()
    const sorted: ToolPlan[] = []
    const toolMap = new Map(tools.map((t) => [t.tool, t]))

    function visit(tool: ToolPlan): void {
      if (visited.has(tool.tool)) return
      visited.add(tool.tool)

      if (tool.dependsOn) {
        for (const dep of tool.dependsOn) {
          const depTool = toolMap.get(dep as ToolName)
          if (depTool) visit(depTool)
        }
      }
      sorted.push(tool)
    }

    for (const tool of tools) {
      visit(tool)
    }

    return sorted
  }
}

// ─── SearchContextBuilder ───────────────────────────────────────────────────

export class SearchContextBuilder {
  private orchestrator: AgenticSearchOrchestrator

  constructor(orchestrator: AgenticSearchOrchestrator) {
    this.orchestrator = orchestrator
  }

  async buildContextSection(query: string, maxTokens: number = 3000): Promise<string> {
    const result = await this.orchestrator.search(query)
    return this.formatContextSection(result, maxTokens)
  }

  async buildFileContext(filePath: string, maxTokens: number = 2000): Promise<string> {
    const query = `what's in ${filePath}`
    const result = await this.orchestrator.search(query)
    return this.formatContextSection(result, maxTokens)
  }

  async buildSymbolContext(symbolName: string, maxTokens: number = 2000): Promise<string> {
    const query = `find ${symbolName}`
    const result = await this.orchestrator.search(query)
    return this.formatContextSection(result, maxTokens)
  }

  async quickSearch(query: string): Promise<string> {
    const result = await this.orchestrator.search(query)
    if (result.estimatedTokens === 0) return ""
    return result.text.slice(0, 2000)
  }

  private formatContextSection(result: FusedResult, maxTokens: number): string {
    if (result.estimatedTokens === 0 || result.confidence < 0.1) {
      return "<!-- CodeGraph context: no relevant code structure found -->"
    }

    const header = "<!-- CodeGraph context: auto-resolved code structure -->"
    let body = result.text

    const bodyTokens = Math.ceil(body.length / 4)
    if (bodyTokens > maxTokens) {
      body = body.slice(0, maxTokens * 4) + "\n... [truncated]"
    }

    return `${header}\n\n${body}`
  }
}
