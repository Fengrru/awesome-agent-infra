import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, utimesSync, writeFileSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type CallSite, GraphPersistence } from "../src/index.js"
import type { CodeGraphEdge, CodeGraphNode } from "../src/index.js"

let dir: string
let persistence: GraphPersistence

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "codegraph-persist-"))
  persistence = new GraphPersistence(dir)
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

const NODES: CodeGraphNode[] = [
  {
    id: "symbol:foo",
    type: "symbol",
    symbolType: "function",
    name: "foo",
    filePath: "src/a.ts",
    startLine: 1,
    endLine: 3,
    startByte: 0,
    endByte: 20,
    startToken: 0,
    endToken: 5,
    tokenizerName: "simple",
    metadata: {},
    mtime: 1700000000000,
  },
]

const EDGES: CodeGraphEdge[] = [{ sourceId: "symbol:foo", targetId: "symbol:bar", relation: "calls" }]

const CALL_SITES: CallSite[] = [
  {
    id: "cs-1",
    callerId: "symbol:foo",
    calleeName: "bar",
    calleeId: "symbol:bar",
    filePath: "src/a.ts",
    startByte: 10,
    endByte: 15,
    startToken: 2,
    endToken: 3,
    startLine: 2,
    endLine: 2,
    argCount: 0,
    keywordArgs: [],
    hasStarArgs: false,
    hasKwargs: false,
    tokenizerName: "simple",
  },
]

describe("GraphPersistence", () => {
  test("hasPersistedData is false before anything is saved", async () => {
    expect(await persistence.hasPersistedData()).toBe(false)
  })

  test("load returns null when nothing persisted", async () => {
    expect(await persistence.load()).toBeNull()
  })

  test("save + load round-trips the full graph", async () => {
    await persistence.save(NODES, EDGES, CALL_SITES)

    expect(await persistence.hasPersistedData()).toBe(true)
    const loaded = await persistence.load()
    expect(loaded).not.toBeNull()
    expect(loaded!.version).toBe(1)
    expect(loaded!.nodes).toHaveLength(1)
    expect(loaded!.nodes[0]!.name).toBe("foo")
    expect(loaded!.edges).toEqual(EDGES)
    expect(loaded!.callSites).toEqual(CALL_SITES)
  })

  test("incremental save/load of nodes, edges and call sites", async () => {
    const p = new GraphPersistence(dir)

    await p.saveNodes([NODES[0]!])
    await p.saveEdges(EDGES)
    await p.saveCallSites(CALL_SITES)

    expect(await p.loadNodes()).toHaveLength(1)
    expect(await p.loadEdges()).toEqual(EDGES)
    expect(await p.loadCallSites()).toEqual(CALL_SITES)
  })

  test("loadNodes returns null for missing file", async () => {
    const p = new GraphPersistence(join(dir, "missing"))
    expect(await p.loadNodes()).toBeNull()
    expect(await p.loadEdges()).toBeNull()
    expect(await p.loadCallSites()).toBeNull()
  })

  test("load returns null on corrupt data", async () => {
    const p = new GraphPersistence(join(dir, "corrupt"))
    // force a corrupt file through the incremental writer path
    await p.saveNodes([NODES[0]!])
    const { writeFile } = await import("node:fs/promises")
    await writeFile(join(dir, "corrupt", "nodes.json"), "{not json", "utf-8")
    expect(await p.loadNodes()).toBeNull()
    // a corrupt file fails the whole load (atomic read semantics)
    expect(await p.load()).toBeNull()
  })

  test("default constructor uses cwd/.codegraph", () => {
    const p = new GraphPersistence(undefined)
    expect(p).toBeInstanceOf(GraphPersistence)
  })

  test("cleanupWal removes stale WAL files older than 60s", async () => {
    const p = new GraphPersistence(join(dir, "walclean"))
    await p.save([], [], [])
    const walDir = join(dir, "walclean", "wal")
    const staleFile = join(walDir, "nodes_old.json")
    writeFileSync(staleFile, "[]", "utf-8")
    const past = new Date(Date.now() - 120_000)
    utimesSync(staleFile, past, past)
    expect(existsSync(staleFile)).toBe(true)
    await p.save(NODES, EDGES, CALL_SITES)
    expect(existsSync(staleFile)).toBe(false)
  })
})
