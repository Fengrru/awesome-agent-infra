/**
 * evidence-log
 *
 * A zero-dependency, content-addressed, append-only event log. Agents append
 * immutable typed events (steps, results, verdicts, harvests, compactions,
 * ...); rows are written with the hash of their canonical JSON so that any
 * citation of past evidence can later be verified intact.
 *
 * Extracted from the seed self-hosted-agent project and designed to be driven
 * by any SQLite-compatible database handed in by the caller.
 *
 * @example
 * ```ts
 * import { SqliteLog, validEvidenceIds } from "@fengrru/evidence-log"
 *
 * const log = new SqliteLog(db)
 * log.append({ type: "turn", id: "t1", ts: Date.now(), sessionId: "s1", goal: "ship it" })
 * const evidence = validEvidenceIds(log, ["t1", "ghost"])
 * ```
 *
 * @module
 */

export type {
  CompactEvent,
  ConsolidateEvent,
  DoneEvent,
  Event,
  EventType,
  HarvestEvent,
  PruneEvent,
  ResultEvent,
  StepEvent,
  StoppedReason,
  TaskEvent,
  TaskStatus,
  TurnEvent,
  VerdictEvent,
} from "./event.js"
export { parseEvent } from "./event.js"
export type { SqliteDb, SqliteStatement } from "./db.js"
export { contentHash, stableStringify } from "./hash.js"
export type { EvidenceCheck, Log } from "./log.js"
export { SqliteLog, validEvidenceIds } from "./log.js"
