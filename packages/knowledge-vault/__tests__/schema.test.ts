import { describe, expect, test } from "bun:test"
import {
  contentHash,
  isKnowledgeKind,
  isKnowledgeState,
  isProvenanceSource,
  isVerificationStatus,
  parseCheck,
  parseRef,
  stableStringify,
} from "../src/index.js"

describe("schema guards", () => {
  test("isKnowledgeKind accepts only valid kinds", () => {
    expect(isKnowledgeKind("memory")).toBe(true)
    expect(isKnowledgeKind("unknown")).toBe(false)
    expect(isKnowledgeKind(7)).toBe(false)
  })

  test("isKnowledgeState accepts only valid states", () => {
    expect(isKnowledgeState("active")).toBe(true)
    expect(isKnowledgeState("deleted")).toBe(false)
    expect(isKnowledgeState(null)).toBe(false)
  })

  test("isVerificationStatus accepts only valid statuses", () => {
    expect(isVerificationStatus("verified")).toBe(true)
    expect(isVerificationStatus("pending")).toBe(false)
  })

  test("isProvenanceSource accepts only valid sources", () => {
    expect(isProvenanceSource("self-reflection")).toBe(true)
    expect(isProvenanceSource("github")).toBe(false)
  })

  test("parseRef accepts all optional fields", () => {
    expect(parseRef({})).toEqual({})
    expect(parseRef({ url: "u", sessionId: "s", connection: "c", knowledgeId: "k" })).toEqual({
      url: "u",
      sessionId: "s",
      connection: "c",
      knowledgeId: "k",
    })
    expect(parseRef({ sessionId: undefined, knowledgeId: null })).toEqual({})
  })

  test("parseRef rejects malformed values", () => {
    expect(parseRef(null)).toBeNull()
    expect(parseRef({ url: 5 })).toBeNull()
    expect(parseRef({ knowledgeId: [] })).toBeNull()
  })

  test("parseCheck accepts command and assert", () => {
    expect(parseCheck({ type: "command", cmd: "x" })).toEqual({ type: "command", cmd: "x" })
    expect(parseCheck({ type: "assert", expr: "x" })).toEqual({ type: "assert", expr: "x" })
  })

  test("parseCheck rejects malformed checks", () => {
    expect(parseCheck(null)).toBeNull()
    expect(parseCheck({ type: "command" })).toBeNull()
    expect(parseCheck({ type: "assert", expr: 3 })).toBeNull()
    expect(parseCheck({ type: "other" })).toBeNull()
  })

  test("contentHash and stableStringify are re-exported", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }))
    expect(contentHash({ a: 1 })).toMatch(/^[0-9a-f]{40}$/)
  })
})
