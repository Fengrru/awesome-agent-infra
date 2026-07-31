import { describe, expect, test } from "bun:test"
import { extractFromFile } from "../src/index.js"

const MOCK_TIME = 1_700_000_000_000

const TS_SOURCE = `import { createHash } from "node:crypto"
import * as fs from "node:fs"
import logger from "./logger"

export async function processItem(item: string): Promise<string> {
  const hash = createHash("sha256").update(item).digest("hex")
  return hash
}

export abstract class BaseWorker {
  protected retries = 3
  async run(task: unknown): Promise<void> {
    logger.info("starting")
  }
}

interface Config {
  retries: number
}

export type Result = { ok: boolean }

const timeout = 5000
let counter = 0

export { processItem, BaseWorker }
`

// ─── fallback extraction (no tree-sitter deps injected) ────────────────────

describe("extractFromFile (fallback parser)", () => {
  test("extracts functions, classes, interfaces, variables and imports", async () => {
    const result = await extractFromFile("src/worker.ts", TS_SOURCE, MOCK_TIME)

    const names = result.symbols.map((s) => `${s.symbolType}:${s.name}`)
    expect(names).toContain("function:processItem")
    expect(names).toContain("class:BaseWorker")
    expect(names).toContain("interface:Config")
    expect(names).toContain("type:Result")
    expect(names).toContain("variable:timeout")
    expect(names).toContain("variable:counter")

    const processItem = result.symbols.find((s) => s.name === "processItem")
    expect(processItem?.metadata).toHaveProperty("isExported", true)
    expect(processItem?.filePath).toBe("src/worker.ts")
    expect(processItem?.mtime).toBe(MOCK_TIME)
    expect(processItem?.startLine).toBeGreaterThan(0)
    expect(processItem?.endByte).toBeGreaterThan(processItem?.startByte ?? 0)

    const baseWorker = result.symbols.find((s) => s.name === "BaseWorker")
    expect(baseWorker?.metadata).toHaveProperty("isExported", true)

    expect(result.imports.map((i) => i.source)).toEqual(["node:crypto", "node:fs", "./logger"])
    expect(result.exports).toEqual(["processItem", "BaseWorker"])
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  test("non-exported symbols are flagged correctly", async () => {
    const source = `function helper() {}\nexport class Public {}\n`
    const result = await extractFromFile("src/a.ts", source, MOCK_TIME)

    const helper = result.symbols.find((s) => s.name === "helper")
    expect(helper?.metadata).toHaveProperty("isExported", false)
    const pub = result.symbols.find((s) => s.name === "Public")
    expect(pub?.metadata).toHaveProperty("isExported", true)
  })

  test("handles empty source", async () => {
    const result = await extractFromFile("src/empty.ts", "", MOCK_TIME)
    expect(result.symbols).toEqual([])
    expect(result.imports).toEqual([])
    expect(result.exports).toEqual([])
  })

  test("non-ts extensions still extract via the same fallback rules", async () => {
    // fallback is language-agnostic: extension does not matter, source syntax does
    const result = await extractFromFile("src/module.py", "function handler() {}\n", MOCK_TIME)
    expect(result.symbols.some((s) => s.symbolType === "function" && s.name === "handler")).toBe(true)
  })

  test("no tree-sitter dependency means fallback is always used", async () => {
    const result = await extractFromFile("src/x.js", "const a = 1", MOCK_TIME)
    expect(result.symbols.some((s) => s.symbolType === "variable" && s.name === "a")).toBe(true)
    // fallback never extracts call sites
    expect(result.calls).toEqual([])
  })

  test("custom tokenizer name is recorded", async () => {
    const result = await extractFromFile("src/x.ts", "export function f() {}", MOCK_TIME, undefined, "cl100k")
    expect(result.symbols[0]?.tokenizerName).toBe("cl100k")
  })
})

// ─── token-level indexing helpers ───────────────────────────────────────────

describe("fallback symbol metadata", () => {
  test("startToken/endToken are valid indices", async () => {
    const result = await extractFromFile("src/t.ts", "export function alpha() {}", MOCK_TIME)
    const sym = result.symbols[0]
    expect(sym).toBeDefined()
    expect(sym!.startToken).toBeGreaterThanOrEqual(0)
    expect(sym!.endToken).toBeGreaterThanOrEqual(sym!.startToken)
    expect(sym!.id).toContain("alpha")
  })

  test("multiline source computes correct line numbers", async () => {
    const source = `// comment\n\n\nexport function deep() {\n}\n`
    const result = await extractFromFile("src/d.ts", source, MOCK_TIME)
    const sym = result.symbols[0]
    expect(sym?.name).toBe("deep")
    expect(sym?.startLine).toBe(4)
  })
})
