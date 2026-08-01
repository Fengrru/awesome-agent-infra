import { beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type BuildEvent,
  CodeGraphBuilder,
  type CodeGraphConfig,
  createCodeGraphBuilder,
  extractFromFile,
  setExtractorDependencies,
} from "../src/index.js"

// Ensure the fallback (regex) parser path is used — prevents module-level
// state from other test files (tree-sitter.test.ts) leaking via _deps/_parserInit.
beforeEach(() => {
  setExtractorDependencies({})
})

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

  test("createCodeGraphBuilder forwards constructor arguments", () => {
    const builder = createCodeGraphBuilder({ rootDir: "." })
    expect(builder).toBeInstanceOf(CodeGraphBuilder)
    expect(builder.graph.nodeCount).toBe(0)
  })
})
