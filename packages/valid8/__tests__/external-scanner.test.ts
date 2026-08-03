/**
 * Tests for createDefaultExternalScanner with a mocked `node:child_process`.
 *
 * The real semgrep/bandit binaries are not available in the test environment,
 * so `spawn` is mocked via bun's `mock.module`. The mock is content-aware:
 * it only emits findings when the piped code contains a marker keyword
 * (`semgrep-hit` / `bandit-hit`), so tests in other files that exercise the
 * scanner with plain code keep passing.
 */
import { describe, expect, mock, test } from "bun:test"

interface FakeProcOptions {
  resolveOutput: (input: string) => string
  resolveClose: (input: string) => number | null
}

function makeFakeProc(options: FakeProcOptions) {
  const stdout: { on: (event: string, cb: (chunk: Buffer) => void) => void } = { on: () => {} }
  const stderr = { on: () => {} }
  let capturedInput = ""

  const proc = {
    stdout,
    stderr,
    stdin: {
      write(data: unknown) {
        capturedInput += String(data)
      },
      end() {
        // Deliver stdout data, then close, once the caller has piped input.
        const out = options.resolveOutput(capturedInput)
        const code = options.resolveClose(capturedInput)
        queueMicrotask(() => {
          const dataCb = (stdout as unknown as { dataCb?: (c: Buffer) => void }).dataCb
          if (dataCb && out) dataCb(Buffer.from(out))
        })
        queueMicrotask(() => {
          if (code !== null) {
            const closeCb = (proc as unknown as { closeCb?: (c: number) => void }).closeCb
            closeCb?.(code)
          }
        })
      },
    },
    on(event: string, cb: (arg: unknown) => void) {
      if (event === "close") {
        ;(proc as unknown as { closeCb: (c: number) => void }).closeCb = cb as (c: number) => void
      }
      return proc
    },
  }

  stdout.on = (event: string, cb: (chunk: Buffer) => void) => {
    if (event === "data") {
      ;(stdout as unknown as { dataCb: (c: Buffer) => void }).dataCb = cb
    }
  }

  return proc
}

mock.module("node:child_process", () => ({
  spawn: (command: string) => {
    if (command === "semgrep") {
      return makeFakeProc({
        resolveOutput: (input) =>
          input.includes("semgrep-hit")
            ? "rule-1: found issue A\n\u2500 decorative line\nrule-2: found issue B"
            : "",
        resolveClose: () => 0,
      })
    }
    if (command === "bandit") {
      return makeFakeProc({
        resolveOutput: (input) => (input.includes("bandit-hit") ? ">> Issue: B602\n   severity: HIGH" : ""),
        resolveClose: () => 1,
      })
    }
    return makeFakeProc({ resolveOutput: () => "", resolveClose: () => null })
  },
}))

const { createDefaultExternalScanner } = await import("../src/index")

describe("createDefaultExternalScanner (mocked spawn)", () => {
  test("returns a scanner function", () => {
    const scanner = createDefaultExternalScanner()
    expect(typeof scanner).toBe("function")
  })

  test("collects semgrep output lines", async () => {
    const scanner = createDefaultExternalScanner()
    const issues = await scanner("def foo(): pass\nsemgrep-hit")
    expect(issues.length).toBe(2)
    expect(issues[0]).toBe("rule-1: found issue A")
  })

  test("skips decorative semgrep lines", async () => {
    const scanner = createDefaultExternalScanner()
    const issues = await scanner("def foo(): pass\nsemgrep-hit")
    expect(issues.some((i) => i.includes("\u2500"))).toBe(false)
  })

  test("falls back to bandit when semgrep yields nothing", async () => {
    const scanner = createDefaultExternalScanner()
    const issues = await scanner("import os\nbandit-hit")
    expect(issues.some((i) => i.startsWith(">>"))).toBe(true)
  })

  test("returns empty when neither scanner finds anything", async () => {
    const scanner = createDefaultExternalScanner()
    const issues = await scanner("plain code")
    expect(issues).toEqual([])
  })
})
