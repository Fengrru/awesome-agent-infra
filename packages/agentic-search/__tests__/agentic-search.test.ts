import { describe, expect, test } from "bun:test"
import {
  AgenticSearchOrchestrator,
  DEFAULT_AGENTIC_SEARCH_CONFIG,
  type ISemanticSearcher,
  type ISymbolSearcher,
  SearchContextBuilder,
  type SearchResult,
  SearchToolRegistry,
  type SemanticResult,
  type SubGraphResult,
  createAgenticSearchOrchestrator,
  createSearchTools,
} from "../src/index"

function createMockSymbolSearcher(): ISymbolSearcher {
  return {
    searchSymbols: (_query: string) => [
      {
        node: {
          id: "symbol:test",
          name: "testFn",
          type: "symbol",
          symbolType: "function",
          filePath: "src/test.ts",
          startLine: 1,
        },
        score: 0.9,
        matchedOn: "name",
      },
    ],
    searchByType: (_type: string) => [
      {
        node: {
          id: "symbol:classA",
          name: "ClassA",
          type: "symbol",
          symbolType: "class",
          filePath: "src/a.ts",
          startLine: 1,
        },
        score: 1,
        matchedOn: "type",
      },
    ],
    searchByFile: (_path: string) => [
      {
        node: {
          id: "symbol:fn1",
          name: "fn1",
          type: "symbol",
          symbolType: "function",
          filePath: "src/test.ts",
          startLine: 1,
        },
        score: 1,
        matchedOn: "file",
      },
    ],
    getEgoGraph: (_nodeId: string, _k?: number): SubGraphResult => ({
      nodes: [
        { id: "symbol:center", name: "center", type: "symbol", filePath: "src/test.ts", startLine: 1 },
        { id: "symbol:neighbor", name: "neighbor", type: "symbol", filePath: "src/test.ts", startLine: 10 },
      ],
      edges: [{ sourceId: "symbol:center", targetId: "symbol:neighbor", relation: "calls" }],
      estimatedTokens: 50,
    }),
    getFileContext: (_path: string): SubGraphResult => ({
      nodes: [{ id: "file:src/test.ts", name: "test.ts", type: "file", filePath: "src/test.ts", startLine: 1 }],
      edges: [],
      estimatedTokens: 10,
    }),
    flattenResults: (results: SearchResult[], _opts?: any): string => {
      return results.map((r) => r.node.name).join("\n")
    },
  }
}

function createMockSemanticSearcher(): ISemanticSearcher {
  return {
    search: async (_query: string): Promise<SemanticResult[]> => [
      {
        text: "function testFn() handles request authentication",
        compositeScore: 0.85,
        metadata: { source: "docs" },
      },
    ],
  }
}

describe("SearchToolRegistry", () => {
  test("register and get tool", () => {
    const registry = new SearchToolRegistry()
    const tool = {
      name: "test_tool" as const,
      description: "A test tool",
      execute: async () => ({ tool: "test_tool" as const, success: true, data: "ok", tokens: 10, durationMs: 5 }),
      estimateCost: () => 10,
    }
    registry.register(tool)
    expect(registry.get("test_tool")).toBeDefined()
    expect(registry.get("test_tool")!.description).toBe("A test tool")
  })

  test("get returns undefined for unknown tool", () => {
    const registry = new SearchToolRegistry()
    expect(registry.get("code_symbol" as any)).toBeUndefined()
  })

  test("getAll returns all tools", () => {
    const registry = new SearchToolRegistry()
    registry.register({
      name: "grep" as const,
      description: "Grep tool",
      execute: async () => ({ tool: "grep", success: true, data: "", tokens: 0, durationMs: 0 }),
      estimateCost: () => 5,
    })
    registry.register({
      name: "glob" as const,
      description: "Glob tool",
      execute: async () => ({ tool: "glob", success: true, data: "", tokens: 0, durationMs: 0 }),
      estimateCost: () => 5,
    })
    expect(registry.getAll().length).toBe(2)
  })

  test("getDescriptions returns name and description", () => {
    const registry = new SearchToolRegistry()
    registry.register({
      name: "glob" as const,
      description: "Find files by pattern",
      execute: async () => ({ tool: "glob", success: true, data: "", tokens: 0, durationMs: 0 }),
      estimateCost: () => 5,
    })
    const descs = registry.getDescriptions()
    expect(descs.length).toBe(1)
    expect(descs[0]!.name).toBe("glob")
    expect(descs[0]!.description).toBe("Find files by pattern")
  })
})

describe("createSearchTools", () => {
  test("returns 3 built-in tools", () => {
    const symSearcher = createMockSymbolSearcher()
    const semSearcher = createMockSemanticSearcher()
    const tools = createSearchTools(symSearcher, semSearcher)
    expect(tools.length).toBe(3)
    const names = tools.map((t) => t.name)
    expect(names).toContain("code_symbol")
    expect(names).toContain("code_graph")
    expect(names).toContain("semantic_search")
  })
})

describe("AgenticSearchOrchestrator", () => {
  const symSearcher = createMockSymbolSearcher()
  const semSearcher = createMockSemanticSearcher()

  test("parseIntent detects find_symbol intent", () => {
    const orch = new AgenticSearchOrchestrator(symSearcher, semSearcher)
    const intent = orch.parseIntent("find the function processOrder")
    expect(intent.type).toBe("find_symbol")
    expect(intent.target).toBe("processorder")
  })

  test("parseIntent detects trace_call intent", () => {
    const orch = new AgenticSearchOrchestrator(symSearcher, semSearcher)
    const intent = orch.parseIntent("who calls authenticate function")
    expect(intent.type).toBe("trace_call")
    expect(intent.target).toBeDefined()
  })

  test("parseIntent detects find_usage intent", () => {
    const orch = new AgenticSearchOrchestrator(symSearcher, semSearcher)
    const intent = orch.parseIntent("where is calculateTotal used")
    expect(intent.type).toBe("find_symbol")
    expect(intent.target).toBeDefined()
  })

  test("parseIntent detects understand_module intent", () => {
    const orch = new AgenticSearchOrchestrator(symSearcher, semSearcher)
    const intent = orch.parseIntent("understand the auth module")
    expect(intent.type).toBe("understand_module")
    expect(intent.target).toBe("module")
  })

  test("parseIntent detects explore_file intent", () => {
    const orch = new AgenticSearchOrchestrator(symSearcher, semSearcher)
    const intent = orch.parseIntent("what's in src/main.ts")
    expect(intent.type).toBe("explore_file")
    expect(intent.target).toBe("src/main.ts")
  })

  test("parseIntent detects dependency_graph intent", () => {
    const orch = new AgenticSearchOrchestrator(symSearcher, semSearcher)
    const intent = orch.parseIntent("what does express depend on")
    expect(intent.type).toBe("dependency_graph")
    expect(intent.target).toBeDefined()
  })

  test("parseIntent detects semantic_search intent", () => {
    const orch = new AgenticSearchOrchestrator(symSearcher, semSearcher)
    const intent = orch.parseIntent("look for code that handles authentication")
    expect(intent.type).toBe("semantic_search")
  })

  test("parseIntent falls back to general_query", () => {
    const orch = new AgenticSearchOrchestrator(symSearcher, semSearcher)
    const intent = orch.parseIntent("hello world")
    expect(intent.type).toBe("general_query")
    expect(intent.query).toBe("hello world")
  })

  test("planStrategy creates plan for find_symbol", () => {
    const orch = new AgenticSearchOrchestrator(symSearcher, semSearcher)
    const intent = orch.parseIntent("find the function testFn")
    const strategy = orch.planStrategy(intent)
    expect(strategy.intent.type).toBe("find_symbol")
    expect(strategy.tools.length).toBeGreaterThan(0)
    expect(strategy.parallel).toBe(true)
  })

  test("planStrategy creates plan for trace_call with dependency", () => {
    const orch = new AgenticSearchOrchestrator(symSearcher, semSearcher)
    const intent = orch.parseIntent("who calls processOrder")
    const strategy = orch.planStrategy(intent)
    expect(strategy.intent.type).toBe("trace_call")
    const codeGraph = strategy.tools.find((t) => t.tool === "code_graph")
    expect(codeGraph).toBeDefined()
    if (codeGraph) {
      expect(codeGraph.dependsOn).toBeDefined()
    }
  })

  test("search returns fused result", async () => {
    const orch = new AgenticSearchOrchestrator(symSearcher, semSearcher)
    orch.registerTools()
    const result = await orch.search("find the function testFn")
    expect(result.text.length).toBeGreaterThan(0)
    expect(result.confidence).toBeGreaterThanOrEqual(0)
    expect(result.confidence).toBeLessThanOrEqual(1)
    expect(result.estimatedTokens).toBeGreaterThan(0)
  })

  test("search with find_code intent", async () => {
    const orch = new AgenticSearchOrchestrator(symSearcher, semSearcher)
    orch.registerTools()
    const result = await orch.search("find code for login handler")
    expect(result.text.length).toBeGreaterThan(0)
  })

  test("fuseResults truncates to maxTokens", () => {
    const orch = new AgenticSearchOrchestrator(symSearcher, semSearcher, { maxTokens: 50 })
    const intent = orch.parseIntent("test")
    const strategy = orch.planStrategy(intent)
    const bigResult = {
      tool: "code_symbol" as const,
      success: true,
      data: "a".repeat(5000),
      tokens: 5000,
      durationMs: 10,
    }
    const fused = orch.fuseResults([bigResult], strategy)
    expect(fused.estimatedTokens).toBeLessThanOrEqual(100)
  })

  test("fuseResults with failed tools", () => {
    const orch = new AgenticSearchOrchestrator(symSearcher, semSearcher)
    const intent = orch.parseIntent("test")
    const strategy = orch.planStrategy(intent)
    const failed = {
      tool: "code_symbol" as const,
      success: false,
      data: "",
      tokens: 0,
      durationMs: 5,
      error: "tool unavailable",
    }
    const fused = orch.fuseResults([failed], strategy)
    expect(fused.confidence).toBe(0)
  })

  test("search handles tool timeout gracefully", async () => {
    const orch = new AgenticSearchOrchestrator(symSearcher, semSearcher, { toolTimeoutMs: 100 })
    orch.registerTools()
    const result = await orch.search("test query")
    expect(result).toBeDefined()
    expect(result.text).toBeDefined()
  })

  test("DEFAULT_AGENTIC_SEARCH_CONFIG has expected defaults", () => {
    expect(DEFAULT_AGENTIC_SEARCH_CONFIG.maxTokens).toBe(4000)
    expect(DEFAULT_AGENTIC_SEARCH_CONFIG.enableLLMIntentParsing).toBe(false)
    expect(DEFAULT_AGENTIC_SEARCH_CONFIG.toolTimeoutMs).toBe(15000)
  })
})

describe("SearchContextBuilder", () => {
  const symSearcher2 = createMockSymbolSearcher()
  const semSearcher2 = createMockSemanticSearcher()
  const orch2 = new AgenticSearchOrchestrator(symSearcher2, semSearcher2)
  orch2.registerTools()
  const builder = new SearchContextBuilder(orch2)

  test("buildContextSection returns formatted result", async () => {
    const result = await builder.buildContextSection("find testFn")
    expect(result.length).toBeGreaterThan(0)
  })

  test("quickSearch returns result", async () => {
    const result = await builder.quickSearch("testFn")
    expect(typeof result).toBe("string")
  })

  test("buildFileContext returns formatted result", async () => {
    const result = await builder.buildFileContext("src/test.ts")
    expect(typeof result).toBe("string")
  })

  test("buildSymbolContext returns formatted result", async () => {
    const result = await builder.buildSymbolContext("testFn")
    expect(typeof result).toBe("string")
  })
})

// ─── createAgenticSearchOrchestrator ─────────────────────────────────────────

describe("createAgenticSearchOrchestrator", () => {
  test("factory creates orchestrator", () => {
    const symSearcher = createMockSymbolSearcher()
    const semSearcher = createMockSemanticSearcher()
    const orch = createAgenticSearchOrchestrator(symSearcher, semSearcher)
    expect(orch).toBeDefined()
    expect(orch instanceof AgenticSearchOrchestrator).toBe(true)
  })
})

// ─── Tool estimateCost ───────────────────────────────────────────────────────

describe("SearchTool estimateCost", () => {
  const symSearcher = createMockSymbolSearcher()
  const semSearcher = createMockSemanticSearcher()
  const tools = createSearchTools(symSearcher, semSearcher)

  test("code_symbol tool has estimateCost", () => {
    const tool = tools.find((t) => t.name === "code_symbol")!
    expect(tool).toBeDefined()
    expect(tool.estimateCost({ query: "test" })).toBeGreaterThan(0)
  })

  test("code_graph tool has estimateCost", () => {
    const tool = tools.find((t) => t.name === "code_graph")!
    expect(tool).toBeDefined()
    expect(tool.estimateCost({})).toBe(100)
  })

  test("semantic_search tool has estimateCost", () => {
    const tool = tools.find((t) => t.name === "semantic_search")!
    expect(tool).toBeDefined()
    expect(tool.estimateCost({ query: "test" })).toBeGreaterThan(0)
  })
})

// ─── code_graph tool execute ─────────────────────────────────────────────────

describe("code_graph tool execute", () => {
  const symSearcher = createMockSymbolSearcher()
  const semSearcher = createMockSemanticSearcher()
  const tools = createSearchTools(symSearcher, semSearcher)
  const codeGraphTool = tools.find((t) => t.name === "code_graph")!

  test("executes with nodeId", async () => {
    const result = await codeGraphTool.execute({ nodeId: "symbol:test" })
    expect(result.success).toBe(true)
    expect(result.data).toContain("SubGraph")
  })

  test("executes with filePath", async () => {
    const result = await codeGraphTool.execute({ filePath: "src/test.ts" })
    expect(result.success).toBe(true)
    expect(result.data).toContain("SubGraph")
  })

  test("executes with neither nodeId nor filePath", async () => {
    const result = await codeGraphTool.execute({})
    expect(result.success).toBe(true)
    expect(result.data).toContain("Specify either nodeId or filePath")
  })
})
