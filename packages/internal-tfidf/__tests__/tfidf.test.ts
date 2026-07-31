import { describe, expect, test } from "bun:test"
import {
  buildTFIDFVectors,
  computeCosineSimilarity,
  computeIDF,
  computeTFIDFVector,
  cosineSimilarity,
  tokenize,
} from "../src/index"

describe("tokenize", () => {
  test("lowercases and splits on non-alphanumeric characters", () => {
    const result = tokenize("Hello World! How are you?")
    expect(result).toEqual(["hello", "world", "how", "are", "you"])
  })

  test("filters out single-character tokens", () => {
    const result = tokenize("a b c, x yz")
    expect(result).toEqual(["yz"])
  })

  test("handles empty string", () => {
    expect(tokenize("")).toEqual([])
  })

  test("handles numbers mixed with text", () => {
    const result = tokenize("fn123 test42")
    expect(result).toEqual(["fn123", "test42"])
  })
})

describe("computeIDF", () => {
  test("computes IDF for multiple documents", () => {
    const docs: string[][] = [
      ["hello", "world"],
      ["hello", "there"],
      ["world", "foo"],
    ]
    const idf = computeIDF(docs)

    expect(idf.get("hello")).toBeGreaterThan(0)
    expect(idf.get("there")).toBeGreaterThan(idf.get("hello")!)
  })

  test("returns empty map for empty documents", () => {
    const idf = computeIDF([])
    expect(idf.size).toBe(0)
  })

  test("terms in all documents have lower IDF than rare terms", () => {
    const docs: string[][] = [
      ["common", "a"],
      ["common", "b"],
      ["common", "c"],
    ]
    const idf = computeIDF(docs)
    expect(idf.get("a")!).toBeGreaterThan(idf.get("common")!)
  })
})

describe("computeTFIDFVector", () => {
  test("computes TF-IDF weighted vector", () => {
    const docs: string[][] = [
      ["hello", "world"],
      ["hello", "code"],
    ]
    const idf = computeIDF(docs)
    const vec = computeTFIDFVector(["hello", "world"], idf)

    expect(vec.has("hello")).toBe(true)
    expect(vec.has("world")).toBe(true)
    expect(vec.get("hello")!).toBeGreaterThan(0)
  })
})

describe("cosineSimilarity (Map-based)", () => {
  test("identical vectors have similarity 1", () => {
    const a = new Map([["hello", 1]])
    const b = new Map([["hello", 1]])
    expect(cosineSimilarity(a, b)).toBeCloseTo(1)
  })

  test("orthogonal vectors have similarity 0", () => {
    const a = new Map([["a", 1]])
    const b = new Map([["b", 1]])
    expect(cosineSimilarity(a, b)).toBe(0)
  })

  test("empty vectors have similarity 0", () => {
    const a = new Map<string, number>()
    const b = new Map([["a", 1]])
    expect(cosineSimilarity(a, b)).toBe(0)
  })
})

describe("buildTFIDFVectors", () => {
  test("computes TF-IDF vectors for documents", () => {
    const docs = ["hello world", "hello code", "world foo"]
    const { vectors, terms } = buildTFIDFVectors(docs)

    expect(vectors.length).toBe(3)
    expect(vectors.every((v) => v.length === terms.length)).toBe(true)
  })

  test("handles single document", () => {
    const { vectors } = buildTFIDFVectors(["hello"])
    expect(vectors.length).toBe(1)
  })

  test("handles empty documents", () => {
    const { vectors, terms } = buildTFIDFVectors([])
    expect(vectors).toEqual([])
    expect(terms).toEqual([])
  })
})

describe("computeCosineSimilarity (array-based)", () => {
  test("identical vectors have similarity 1", () => {
    expect(computeCosineSimilarity([1, 2], [1, 2])).toBeCloseTo(1)
  })

  test("orthogonal vectors have similarity 0", () => {
    expect(computeCosineSimilarity([1, 0], [0, 1])).toBe(0)
  })

  test("empty vectors return 0", () => {
    expect(computeCosineSimilarity([], [1])).toBe(0)
  })
})
