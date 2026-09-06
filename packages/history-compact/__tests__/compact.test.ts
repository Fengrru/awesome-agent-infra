import { describe, expect, test } from "bun:test"
import type { Event } from "@fengrru/evidence-log"
import { createPlanCompaction, summarizeRound } from "../src/index.js"

function makeRound(n: number, stopped: "done" | "error" = "done"): Event[] {
  return [
    { type: "turn", id: `t${n}`, ts: n * 100, sessionId: "s", goal: `goal ${n}` },
    { type: "step", id: `s${n}`, ts: n * 100 + 1, sessionId: "s", tool: "bash", args: "ls" },
    {
      type: "result",
      id: `r${n}`,
      ts: n * 100 + 2,
      sessionId: "s",
      stepId: `s${n}`,
      result: { ok: n !== 1 },
    },
    { type: "done", id: `d${n}`, ts: n * 100 + 3, sessionId: "s", answer: `answer ${n}`, stopped },
  ]
}

const mockReconstruct = (events: Event[], opts: { trustedCompacts: Set<string>; skipIds?: Set<string> }): unknown[] =>
  events.filter((e) => !opts.skipIds?.has(e.id))

describe("summarizeRound", () => {
  test("summarizes a completed round", () => {
    const summary = summarizeRound(makeRound(1))
    expect(summary).toContain("goal 1")
    expect(summary).toContain("bash")
    expect(summary).toContain("answer 1")
  })

  test("notes max_steps", () => {
    const summary = summarizeRound(makeRound(2, "error"))
    expect(summary).toContain("error:")
  })

  test("handles no done", () => {
    const summary = summarizeRound(makeRound(1).slice(0, 3))
    expect(summary).toContain("interrupted")
  })

  test("handles no turn", () => {
    const summary = summarizeRound(makeRound(1).slice(1))
    expect(summary).toContain("(no goal)")
  })
})

describe("createPlanCompaction", () => {
  test("returns empty folds when threshold is zero or negative", () => {
    const plan = createPlanCompaction(mockReconstruct)
    const events = makeRound(1).concat(makeRound(2))
    expect(plan(events, 0, new Set())).toEqual([])
    expect(plan(events, -1, new Set())).toEqual([])
  })

  test("returns empty folds when history already fits", () => {
    const plan = createPlanCompaction(mockReconstruct)
    const events = makeRound(1).concat(makeRound(2))
    expect(plan(events, 1_000_000, new Set())).toEqual([])
  })

  test("folds older complete rounds until history fits", () => {
    const plan = createPlanCompaction(mockReconstruct)
    const events = makeRound(1).concat(makeRound(2)).concat(makeRound(3))
    const folds = plan(events, 50, new Set())
    expect(folds).toHaveLength(2)
    expect(folds[0].covers).toEqual(makeRound(1).map((e) => e.id))
    expect(folds[0].summary).toContain("goal 1")
    expect(folds[1].covers).toEqual(makeRound(2).map((e) => e.id))
    expect(folds[1].summary).toContain("goal 2")
  })

  test("does not fold the most recent round", () => {
    const plan = createPlanCompaction(mockReconstruct)
    const events = makeRound(1).concat(makeRound(2)).concat(makeRound(3))
    const folds = plan(events, 1, new Set())
    const foldedIds = folds.flatMap((f) => f.covers)
    expect(foldedIds).not.toContain("t3")
    expect(foldedIds).not.toContain("d3")
  })

  test("does not fold incomplete rounds", () => {
    const plan = createPlanCompaction(mockReconstruct)
    const events = makeRound(1).concat(makeRound(2).slice(0, 2)).concat(makeRound(3))
    const folds = plan(events, 1, new Set())
    const foldedIds = folds.flatMap((f) => f.covers)
    expect(foldedIds).not.toContain("t2")
  })

  test("skips events already covered by trusted compacts", () => {
    const plan = createPlanCompaction(mockReconstruct)
    const first = makeRound(1)
    const second = makeRound(2)
    const compact: Event = {
      type: "compact",
      id: "c1",
      ts: 10_000,
      sessionId: "s",
      covers: first.map((e) => e.id),
      summary: "folded",
    }
    const events = first.concat(second).concat([compact])
    const folds = plan(events, 1, new Set(["c1"]))
    expect(folds).toHaveLength(0)
  })
})
