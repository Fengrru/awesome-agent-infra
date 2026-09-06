import { Database } from "bun:sqlite"
import { describe, expect, test } from "bun:test"
import { type Event, SqliteLog, contentHash, validEvidenceIds } from "../src/index.js"

function setup(): { db: Database; log: SqliteLog } {
  const db = new Database(":memory:")
  const log = new SqliteLog(db)
  return { db, log }
}

function events(log: SqliteLog): Event[] {
  const turn: Event = { type: "turn", id: "t1", ts: 100, sessionId: "s1", goal: "hello" }
  const step: Event = { type: "step", id: "s1", ts: 200, sessionId: "s1", tool: "bash", args: "ls" }
  const result: Event = { type: "result", id: "r1", ts: 300, sessionId: "s1", stepId: "s1", result: "ok" }
  log.append(turn)
  log.append(step)
  log.append(result)
  return [turn, step, result]
}

describe("SqliteLog", () => {
  test("appends and replays in timestamp order", () => {
    const { log } = setup()
    expect(events(log)).toEqual([
      { type: "turn", id: "t1", ts: 100, sessionId: "s1", goal: "hello" },
      { type: "step", id: "s1", ts: 200, sessionId: "s1", tool: "bash", args: "ls" },
      { type: "result", id: "r1", ts: 300, sessionId: "s1", stepId: "s1", result: "ok" },
    ])
    expect(log.replay()).toHaveLength(3)
  })

  test("replaySince returns only newer events", () => {
    const { log } = setup()
    events(log)
    const since = log.replaySince(150)
    expect(since.map((e) => e.id)).toEqual(["s1", "r1"])
  })

  test("replaySession scopes by session id", () => {
    const { log } = setup()
    log.append({ type: "turn", id: "t2", ts: 400, sessionId: "s2", goal: "other" })
    expect(log.replaySession("s2").map((e) => e.id)).toEqual(["t2"])
    expect(log.replaySession("nope")).toEqual([])
  })

  test("replayRecent returns the newest events in ascending order", () => {
    const { log } = setup()
    events(log)
    expect(log.replayRecent(2).map((e) => e.id)).toEqual(["s1", "r1"])
    expect(log.replayRecent(0)).toEqual([])
  })

  test("eventsBefore and pruneBefore", () => {
    const { log } = setup()
    events(log)
    expect(log.eventsBefore(250).map((e) => e.id)).toEqual(["t1", "s1"])
    const removed = log.pruneBefore(250)
    expect(removed).toBe(2)
    expect(log.replay().map((e) => e.id)).toEqual(["r1"])
  })

  test("verifyEvidence accepts intact ids and rejects missing ones", () => {
    const { log } = setup()
    events(log)
    expect(log.verifyEvidence(["t1", "r1"])).toEqual({ ok: true, invalid: [] })
    const check = log.verifyEvidence(["t1", "ghost", "r1"])
    expect(check.ok).toBe(false)
    expect(check.invalid).toEqual(["ghost"])
  })

  test("verifyEvidence detects tampered rows", () => {
    const { db, log } = setup()
    events(log)
    db.query("UPDATE events SET data = ? WHERE id = ?").run(
      JSON.stringify({ ...{ type: "turn", id: "t1", ts: 100, sessionId: "s1" }, goal: "pwned" }),
      "t1",
    )
    const check = log.verifyEvidence(["t1"])
    expect(check.ok).toBe(false)
    expect(check.invalid).toEqual(["t1"])
  })

  test("verifyEvidence flags legacy rows without a hash", () => {
    const { db, log } = setup()
    events(log)
    db.query("INSERT INTO events (id, ts, type, session_id, data) VALUES (?, ?, ?, ?, ?)").run(
      "legacy",
      50,
      "turn",
      "s1",
      JSON.stringify({ type: "turn", id: "legacy", ts: 50, sessionId: "s1", goal: "old" }),
    )
    const check = log.verifyEvidence(["legacy", "t1"])
    expect(check.ok).toBe(false)
    expect(check.invalid).toEqual(["legacy"])
  })

  test("verifyEvidence rejects ids whose row is not valid JSON", () => {
    const { db, log } = setup()
    events(log)
    db.query("INSERT INTO events (id, ts, type, session_id, data, content_hash) VALUES (?, ?, ?, ?, ?, ?)").run(
      "bad",
      60,
      "turn",
      "s1",
      "not json",
      contentHash({ x: 1 }),
    )
    const check = log.verifyEvidence(["bad"])
    expect(check.ok).toBe(false)
    expect(check.invalid).toEqual(["bad"])
  })

  test("verifyEvidence de-duplicates ids", () => {
    const { log } = setup()
    events(log)
    expect(log.verifyEvidence(["t1", "t1", "t1"])).toEqual({ ok: true, invalid: [] })
  })

  test("validEvidenceIds filters and short-circuits empty input", () => {
    const { log } = setup()
    events(log)
    expect(validEvidenceIds(log, [])).toEqual([])
    expect(validEvidenceIds(log, ["t1", "ghost", "r1"])).toEqual(["t1", "r1"])
  })

  test("skip corrupt rows but keep reading", () => {
    const { db, log } = setup()
    events(log)
    db.query("INSERT INTO events (id, ts, type, session_id, data) VALUES (?, ?, ?, ?, ?)").run(
      "c1",
      400,
      "turn",
      "s1",
      "{broken",
    )
    db.query("INSERT INTO events (id, ts, type, session_id, data) VALUES (?, ?, ?, ?, ?)").run(
      "c2",
      500,
      "turn",
      "s1",
      JSON.stringify({ type: "weird", id: "c2" }),
    )
    const replayed = log.replay()
    expect(replayed.map((e) => e.id)).toEqual(["t1", "s1", "r1"])
  })

  test("constructor tolerates an existing events table", () => {
    const { db } = setup()
    const second = new SqliteLog(db)
    second.append({ type: "turn", id: "x", ts: 1, sessionId: "s", goal: "g" })
    expect(second.replay().map((e) => e.id)).toEqual(["x"])
  })

  test("append stores the content hash of the canonical event", () => {
    const { db, log } = setup()
    log.append({ type: "turn", id: "t", ts: 1, sessionId: "s", goal: "g" })
    const row = db.query("SELECT content_hash FROM events WHERE id = ?").get("t") as { content_hash: string }
    expect(row.content_hash).toBe(contentHash({ type: "turn", id: "t", ts: 1, sessionId: "s", goal: "g" }))
  })
})
