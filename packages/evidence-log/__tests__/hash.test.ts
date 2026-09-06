import { describe, expect, test } from "bun:test"
import { contentHash, stableStringify } from "../src/index.js"

describe("stableStringify", () => {
  test("serializes object keys in sorted order", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }))
    expect(stableStringify({ z: "x", a: { d: 1, c: 2 }, m: null })).toBe('{"a":{"c":2,"d":1},"m":null,"z":"x"}')
  })

  test("handles arrays, primitives, and nesting", () => {
    expect(stableStringify([3, { b: 1, a: 2 }])).toBe('[3,{"a":2,"b":1}]')
    expect(stableStringify("hi")).toBe('"hi"')
    expect(stableStringify(null)).toBe("null")
    expect(stableStringify(undefined)).toBe(undefined)
  })
})

describe("contentHash", () => {
  test("is deterministic and independent of key order", () => {
    expect(contentHash({ x: 1, y: 2 })).toBe(contentHash({ y: 2, x: 1 }))
    expect(contentHash({ a: [1, 2] })).toMatch(/^[0-9a-f]{40}$/)
  })

  test("changes when the content changes", () => {
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }))
  })
})
