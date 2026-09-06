import { describe, expect, test } from "bun:test"
import type { KnowledgeObject } from "@fengrru/knowledge-vault"
import { injectable, isExpired, usageFactor } from "../src/index.js"

function makeObj(overrides: Partial<KnowledgeObject>): KnowledgeObject {
  return {
    id: "x",
    name: "x",
    kind: "memory",
    version: 1,
    parentId: null,
    content: "",
    provenance: { source: "human", refs: [], created: 1000 },
    evidence: [],
    verification: { status: "unverified", check: null, lastVerifiedAt: null },
    ttl: null,
    state: "active",
    metrics: { uses: 0, successes: 0, lastUsedAt: null },
    ...overrides,
  }
}

describe("isExpired", () => {
  test("returns false when ttl is null", () => {
    expect(isExpired(makeObj({ ttl: null }), 1_000_000)).toBe(false)
  })

  test("returns false when ttl has not elapsed", () => {
    expect(isExpired(makeObj({ ttl: 100, provenance: { source: "human", refs: [], created: 900 } }), 1000)).toBe(false)
  })

  test("returns true when ttl has elapsed", () => {
    expect(isExpired(makeObj({ ttl: 100, provenance: { source: "human", refs: [], created: 800 } }), 1000)).toBe(true)
  })
})

describe("injectable", () => {
  test("rejects drafts", () => {
    expect(injectable(makeObj({ state: "draft" }))).toBe(false)
  })

  test("rejects stale and archived entries", () => {
    expect(injectable(makeObj({ state: "stale" }))).toBe(false)
    expect(injectable(makeObj({ state: "archived" }))).toBe(false)
  })

  test("skills must be verified", () => {
    expect(
      injectable(
        makeObj({
          kind: "skill",
          state: "active",
          verification: { status: "unverified", check: null, lastVerifiedAt: null },
        }),
      ),
    ).toBe(false)
    expect(
      injectable(
        makeObj({
          kind: "skill",
          state: "active",
          verification: { status: "verified", check: null, lastVerifiedAt: null },
        }),
      ),
    ).toBe(true)
  })

  test("accepts other active kinds", () => {
    expect(injectable(makeObj({ kind: "memory" }))).toBe(true)
    expect(injectable(makeObj({ kind: "policy" }))).toBe(true)
    expect(injectable(makeObj({ kind: "connection-meta" }))).toBe(true)
  })
})

describe("usageFactor", () => {
  test("is positive and bounded for no usage", () => {
    const f = usageFactor(makeObj({ metrics: { uses: 0, successes: 0, lastUsedAt: null } }))
    expect(f).toBeGreaterThan(0)
    expect(f).toBeLessThan(2)
  })

  test("rises with successful use", () => {
    const f = usageFactor(makeObj({ metrics: { uses: 10, successes: 10, lastUsedAt: null } }))
    expect(f).toBeGreaterThan(usageFactor(makeObj({ metrics: { uses: 0, successes: 0, lastUsedAt: null } })))
  })

  test("falls when failures dominate", () => {
    const f = usageFactor(makeObj({ metrics: { uses: 10, successes: 0, lastUsedAt: null } }))
    expect(f).toBeLessThan(usageFactor(makeObj({ metrics: { uses: 10, successes: 10, lastUsedAt: null } })))
  })
})
