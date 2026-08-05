import { beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type BuildEvent,
  CodeGraphBuilder,
  type CodeGraphConfig,
  type CodeGraphNode,
  createCodeGraphBuilder,
  extractFromFile,
  setExtractorDependencies,
} from "../src/index.js"

// Ensure the fallback (regex) parser path is used — prevents module-level
// state from other test files (tree-sitter.test.ts) leaking via _deps/_parserInit.
beforeEach(() => {
  setExtractorDependencies({})
})

/** Typed access to CodeGraphBuilder private members for white-box tests. */
interface BuilderInternals {
  buildTypeUsageEdges(symbols: CodeGraphNode[]): void
  buildInheritanceEdges(symbols: CodeGraphNode[]): void
  buildDataFlowEdges(symbols: CodeGraphNode[]): void
  buildTestCoverEdges(symbols: CodeGraphNode[]): void
  resolveImportPath(sourceFile: string, importSource: string): string | null
}

function internals(builder: CodeGraphBuilder): BuilderInternals {
  return builder as unknown as BuilderInternals
}

const UTIL_SOURCE = `export function add(a: number, b: number): number {
  return a + b
}

export function sub(a: number, b: number): number {
  return a - b
}
`

const MAIN_SOURCE = `import { add } from "./util"

export function main(): number {
  return add(1, 2)
}
`

async function makeFixture(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "codegraph-"))
  await writeFile(join(dir, "util.ts"), UTIL_SOURCE, "utf-8")
  await writeFile(join(dir, "main.ts"), MAIN_SOURCE, "utf-8")
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

// ─── extractFromFile ────────────────────────────────────────────────────────

describe("extractFromFile", () => {
  test("extracts function symbols and imports from TypeScript source", async () => {
    setExtractorDependencies({})
    const result = await extractFromFile("main.ts", MAIN_SOURCE, Date.now())
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    expect(result.imports.some((i) => i.source === "./util")).toBe(true)
    const names = result.symbols.map((s) => s.name)
    expect(names).toContain("main")
  })

  test("extracts multiple functions from a single file", async () => {
    setExtractorDependencies({})
    const result = await extractFromFile("util.ts", UTIL_SOURCE, Date.now())
    const names = result.symbols.map((s) => s.name)
    expect(names).toContain("add")
    expect(names).toContain("sub")
  })

  test("returns an empty result for empty source", async () => {
    setExtractorDependencies({})
    const result = await extractFromFile("empty.ts", "", Date.now())
    expect(result.symbols).toEqual([])
    expect(result.imports).toEqual([])
  })
})

// ─── CodeGraphBuilder ───────────────────────────────────────────────────────

describe("CodeGraphBuilder", () => {
  test("build creates file nodes, symbol nodes, and defines edges", async () => {
    setExtractorDependencies({})
    const { dir, cleanup } = await makeFixture()
    try {
      const config: CodeGraphConfig = { rootDir: dir, include: ["**/*.ts"] }
      const builder = new CodeGraphBuilder(config, {
        discoverFiles: async () => [join(dir, "util.ts"), join(dir, "main.ts")],
      })
      const graph = await builder.build()

      const fileNodes = graph.findNodes((n) => n.type === "file")
      expect(fileNodes.map((f) => f.name).sort()).toEqual(["main.ts", "util.ts"])

      const symbolNodes = graph.findNodes((n) => n.type === "symbol")
      const symbolNames = symbolNodes.map((s) => s.name)
      expect(symbolNames).toContain("add")
      expect(symbolNames).toContain("main")

      const utilFile = fileNodes.find((f) => f.name === "util.ts")!
      const defined = graph.getOutgoing(utilFile.id, "defines")
      expect(defined.length).toBeGreaterThan(0)
    } finally {
      await cleanup()
    }
  })

  test("default file discovery walks the root directory", async () => {
    const { dir, cleanup } = await makeFixture()
    try {
      const builder = new CodeGraphBuilder({ rootDir: dir, include: ["**/*.ts"] })
      const graph = await builder.build()
      expect(graph.fileCount).toBe(2)
    } finally {
      await cleanup()
    }
  })

  test("notifies observers through the build phases", async () => {
    const { dir, cleanup } = await makeFixture()
    try {
      const builder = new CodeGraphBuilder({ rootDir: dir, include: ["**/*.ts"] })
      const events: BuildEvent[] = []
      builder.addObserver((event) => events.push(event))
      await builder.build()

      const phases = new Set(events.map((e) => e.phase))
      expect(phases.has("discover")).toBe(true)
      expect(phases.has("extract")).toBe(true)
      expect(phases.has("build")).toBe(true)
      expect(events.some((e) => e.type === "complete")).toBe(true)
    } finally {
      await cleanup()
    }
  })

  test("build with no matching files completes with an empty graph", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codegraph-empty-"))
    try {
      const builder = new CodeGraphBuilder({ rootDir: dir, include: ["**/*.ts"] })
      const graph = await builder.build()
      expect(graph.nodeCount).toBe(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("forwards graph events to builder observers", () => {
    const builder = new CodeGraphBuilder({ rootDir: "." })
    const events: BuildEvent[] = []
    builder.addObserver((event) => events.push(event))
    // Graph-level events (e.g. future addNode/removeNode notifications) are
    // forwarded to builder observers via the constructor-registered hook.
    ;(builder.graph as unknown as { notify(event: BuildEvent): void }).notify({
      type: "index",
      phase: "index",
      message: "manual",
      nodeCount: 1,
      edgeCount: 0,
    })
    expect(events.length).toBe(1)
    expect(events[0]!.type).toBe("index")
  })

  test("createCodeGraphBuilder forwards constructor arguments", () => {
    const builder = createCodeGraphBuilder({ rootDir: "." })
    expect(builder).toBeInstanceOf(CodeGraphBuilder)
    expect(builder.graph.nodeCount).toBe(0)
  })

  test("persistState writes state to disk when persistToDb enabled", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codegraph-persist-"))
    try {
      const persistDir = join(dir, ".codegraph")
      const builder = new CodeGraphBuilder({
        rootDir: dir,
        include: ["**/*.ts"],
        persistToDb: true,
        persistDir,
      })
      await builder.persistState()
      // No error thrown = success
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("extractBaseType handles complex type annotations", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codegraph-basetype-"))
    try {
      const src = `interface User { name: string }
export function createUser(): Promise<User> {
  return Promise.resolve({ name: "test" })
}
export function processUsers(users: Array<User>): void {}
`
      await writeFile(join(dir, "user.ts"), src, "utf-8")
      const builder = new CodeGraphBuilder({ rootDir: dir, include: ["**/*.ts"] })
      const graph = await builder.build()
      expect(graph.nodeCount).toBeGreaterThan(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("buildTypeUsageEdges normalizes nested generic types", () => {
    const dir = mkdtempSync(join(tmpdir(), "codegraph-typeuse-"))
    const builder = new CodeGraphBuilder({ rootDir: dir })
    const node = (overrides: Partial<CodeGraphNode>): CodeGraphNode => ({
      id: "symbol:x",
      type: "symbol",
      symbolType: "function",
      name: "x",
      filePath: "src/x.ts",
      startLine: 1,
      endLine: 1,
      startByte: 0,
      endByte: 0,
      startToken: 0,
      endToken: 0,
      tokenizerName: "simple",
      metadata: {},
      mtime: 1700000000000,
      ...overrides,
    })

    const typeEnt = node({ id: "symbol:User", symbolType: "interface", name: "User" })
    const user = node({
      id: "symbol:createUser",
      name: "createUser",
      metadata: {
        returnType: "Optional[Array[Promise<User[] | null>]]",
        parameters: [{ name: "users", type: "User" }],
      },
    })
    internals(builder).buildTypeUsageEdges([typeEnt, user])
    const edges = builder.graph.getEdges(undefined, "type_uses")
    expect(edges.some((e) => e.sourceId === "symbol:User" && e.targetId === "symbol:createUser")).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test("exclude patterns are honored during discovery", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codegraph-exclude-"))
    try {
      await writeFile(join(dir, "keep.ts"), "export function keep() {}\n", "utf-8")
      await writeFile(join(dir, "skip.ts"), "export function skip() {}\n", "utf-8")
      const builder = new CodeGraphBuilder({
        rootDir: dir,
        include: ["**/*.ts"],
        exclude: ["skip.ts"],
      })
      const graph = await builder.build()
      const names = graph.findNodes((n) => n.type === "file").map((f) => f.name)
      expect(names).toContain("keep.ts")
      expect(names).not.toContain("skip.ts")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("buildInheritanceEdges links overrides between same-name classes", () => {
    const builder = new CodeGraphBuilder({ rootDir: "." })
    const node = (overrides: Partial<CodeGraphNode>): CodeGraphNode => ({
      id: "symbol:x",
      type: "symbol",
      symbolType: "function",
      name: "x",
      filePath: "src/x.ts",
      startLine: 1,
      endLine: 1,
      startByte: 0,
      endByte: 0,
      startToken: 0,
      endToken: 0,
      tokenizerName: "simple",
      metadata: {},
      mtime: 1700000000000,
      ...overrides,
    })

    const baseA = node({ id: "symbol:class:Base:a", symbolType: "class", name: "Base" })
    const baseB = node({ id: "symbol:class:Base:b", symbolType: "class", name: "Base" })
    const greetA = node({
      id: "symbol:method:greet:a",
      symbolType: "method",
      name: "greet",
      metadata: { parentId: "symbol:class:Base:a" },
    })
    const greetB = node({
      id: "symbol:method:greet:b",
      symbolType: "method",
      name: "greet",
      metadata: { parentId: "symbol:class:Base:b" },
    })
    internals(builder).buildInheritanceEdges([baseA, baseB, greetA, greetB])
    const edges = builder.graph.getEdges(undefined, "overrides")
    expect(edges.some((e) => e.sourceId === "symbol:method:greet:a" && e.targetId === "symbol:method:greet:b")).toBe(
      true,
    )
  })

  test("buildDataFlowEdges links variables to function parameters", () => {
    const builder = new CodeGraphBuilder({ rootDir: "." })
    const node = (overrides: Partial<CodeGraphNode>): CodeGraphNode => ({
      id: "symbol:x",
      type: "symbol",
      symbolType: "function",
      name: "x",
      filePath: "src/x.ts",
      startLine: 1,
      endLine: 1,
      startByte: 0,
      endByte: 0,
      startToken: 0,
      endToken: 0,
      tokenizerName: "simple",
      metadata: {},
      mtime: 1700000000000,
      ...overrides,
    })

    const v = node({
      id: "symbol:var:users",
      symbolType: "variable",
      name: "users",
      filePath: "src/a.ts",
      startToken: 5,
    })
    const f = node({
      id: "symbol:func:process",
      symbolType: "function",
      name: "process",
      filePath: "src/a.ts",
      startToken: 10,
      metadata: { parameters: [{ name: "users", type: "User[]" }] },
    })
    internals(builder).buildDataFlowEdges([v, f])
    const edges = builder.graph.getEdges(undefined, "data_flow")
    expect(edges.some((e) => e.sourceId === "symbol:var:users" && e.targetId === "symbol:func:process")).toBe(true)
  })

  test("buildTestCoverEdges links test functions to source symbols", () => {
    const builder = new CodeGraphBuilder({ rootDir: "." })
    const node = (overrides: Partial<CodeGraphNode>): CodeGraphNode => ({
      id: "symbol:x",
      type: "symbol",
      symbolType: "function",
      name: "x",
      filePath: "src/x.ts",
      startLine: 1,
      endLine: 1,
      startByte: 0,
      endByte: 0,
      startToken: 0,
      endToken: 0,
      tokenizerName: "simple",
      metadata: {},
      mtime: 1700000000000,
      ...overrides,
    })

    const testFile = node({
      id: "file:tests/foo.test.ts",
      type: "file",
      name: "tests/foo.test.ts",
      filePath: "tests/foo.test.ts",
    })
    const testFunc = node({
      id: "symbol:testHelper",
      symbolType: "function",
      name: "testHelper",
      filePath: "src/child.ts",
      startToken: 0,
      endToken: 100,
    })
    const srcFunc = node({
      id: "symbol:helper",
      symbolType: "function",
      name: "helper",
      filePath: "src/child.ts",
      startToken: 0,
      endToken: 50,
    })
    builder.graph.addNode(testFile)
    builder.graph.addNode(testFunc)
    builder.graph.addNode(srcFunc)
    internals(builder).buildTestCoverEdges([testFunc, srcFunc])
    const edges = builder.graph.getEdges(undefined, "test_covers")
    expect(edges.some((e) => e.sourceId === "symbol:testHelper" && e.targetId === "symbol:helper")).toBe(true)
  })

  test("resolveImportPath falls back to known file nodes", () => {
    const builder = new CodeGraphBuilder({ rootDir: join(tmpdir(), "codegraph-import-nowhere") })
    builder.graph.addNode({
      id: "file:src/util/helper.ts",
      type: "file",
      name: "src/util/helper.ts",
      filePath: "src/util/helper.ts",
      startLine: 1,
      endLine: 0,
      startByte: 0,
      endByte: 0,
      startToken: 0,
      endToken: 0,
      tokenizerName: "simple",
      metadata: {},
      mtime: 1700000000000,
    })

    const resolved = internals(builder).resolveImportPath("src/main.ts", "/util/helper")
    expect(resolved).toBe("src/util/helper.ts")
  })
})
