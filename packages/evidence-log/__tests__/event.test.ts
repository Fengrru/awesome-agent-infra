import { describe, expect, test } from "bun:test"
import { type Event, parseEvent } from "../src/index.js"

const base = { id: "e1", ts: 1000, sessionId: "s1" }

describe("parseEvent", () => {
  test("accepts every event kind", () => {
    const samples: Event[] = [
      { type: "step", ...base, tool: "bash", args: { cmd: "ls" } },
      { type: "result", ...base, stepId: "e0", result: "ok" },
      { type: "verdict", ...base, stepId: "e0", ok: true, detail: "good" },
      { type: "verdict", ...base, ok: false, detail: "bad" },
      { type: "harvest", ...base, stepId: "e0", data: { k: "v" } },
      { type: "harvest", ...base, data: null },
      { type: "turn", ...base, goal: "go" },
      { type: "done", ...base, answer: "a" },
      { type: "done", ...base, answer: "a", stopped: "done" },
      { type: "done", ...base, answer: "a", stopped: "max_steps" },
      { type: "task", ...base, taskId: "t1", parentId: null, status: "open", title: "t" },
      { type: "task", ...base, taskId: "t1", parentId: "p", status: "abandoned", title: "t" },
      {
        type: "consolidate",
        ...base,
        data: { merged: 1, archived: 2, promoted: 3, staled: 4, mapping: [{ from: "a", to: "b" }] },
      },
      { type: "compact", ...base, covers: ["a", "b"], summary: "fold" },
      { type: "prune", ...base, before: 500, archived: 3 },
    ]
    for (const sample of samples) {
      const parsed = parseEvent(sample)
      expect(parsed, sample.type).not.toBeNull()
      expect(parsed).toEqual(sample)
    }
  })

  test("rejects non-objects", () => {
    for (const bad of [null, "x", 42, true, [base], undefined]) {
      expect(parseEvent(bad)).toBeNull()
    }
  })

  test("rejects objects missing or mistyping core fields", () => {
    expect(parseEvent({ ...base, id: 7 })).toBeNull()
    expect(parseEvent({ ...base, ts: "1" })).toBeNull()
    expect(parseEvent({ ...base, sessionId: 1 })).toBeNull()
    expect(parseEvent({ type: "step", id: "e", ts: 1 })).toBeNull()
    expect(parseEvent({ ...base, type: "unknown" })).toBeNull()
    expect(parseEvent({ type: 3, ...base })).toBeNull()
  })

  test("rejects variant fields of the wrong shape", () => {
    expect(parseEvent({ type: "step", ...base, tool: 1 })).toBeNull()
    expect(parseEvent({ type: "result", ...base, stepId: null })).toBeNull()
    expect(parseEvent({ type: "verdict", ...base, ok: "yes", detail: "x" })).toBeNull()
    expect(parseEvent({ type: "verdict", ...base, ok: true, detail: 3 })).toBeNull()
    expect(parseEvent({ type: "verdict", ...base, ok: true, detail: "x", stepId: 5 })).toBeNull()
    expect(parseEvent({ type: "harvest", ...base, stepId: 5 })).toBeNull()
    expect(parseEvent({ type: "turn", ...base })).toBeNull()
    expect(parseEvent({ type: "done", ...base })).toBeNull()
    expect(parseEvent({ type: "done", ...base, answer: "a", stopped: "nope" })).toBeNull()
    expect(parseEvent({ type: "task", ...base, taskId: 1, parentId: null, status: "open", title: "t" })).toBeNull()
    expect(parseEvent({ type: "task", ...base, taskId: "t", parentId: 3, status: "open", title: "t" })).toBeNull()
    expect(parseEvent({ type: "task", ...base, taskId: "t", parentId: null, status: "gone", title: "t" })).toBeNull()
    expect(parseEvent({ type: "task", ...base, taskId: "t", parentId: null, status: "open" })).toBeNull()
    expect(parseEvent({ type: "consolidate", ...base, data: { merged: 1 } })).toBeNull()
    expect(
      parseEvent({
        type: "consolidate",
        ...base,
        data: { ...{ merged: 1, archived: 2, promoted: 3, staled: 4 }, mapping: "x" },
      }),
    ).toBeNull()
    expect(
      parseEvent({
        type: "consolidate",
        ...base,
        data: { merged: 1, archived: 2, promoted: 3, staled: 4, mapping: [{ from: 1, to: "b" }] },
      }),
    ).toBeNull()
    expect(parseEvent({ type: "consolidate", ...base, data: null })).toBeNull()
    expect(parseEvent({ type: "compact", ...base, covers: "all", summary: "x" })).toBeNull()
    expect(parseEvent({ type: "compact", ...base, covers: ["a", 3], summary: "x" })).toBeNull()
    expect(parseEvent({ type: "compact", ...base, covers: ["a"] })).toBeNull()
    expect(parseEvent({ type: "prune", ...base, before: "yesterday", archived: 1 })).toBeNull()
    expect(parseEvent({ type: "prune", ...base, archived: 1 })).toBeNull()
  })
})
