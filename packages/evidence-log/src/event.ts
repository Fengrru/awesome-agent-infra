/**
 * The evidence-log event model.
 *
 * An event is one immutable, timestamped record appended to the log. Every
 * event carries an id, a monotonic timestamp, and the session it belongs to.
 * This module provides the runtime event model and a hand-written discriminator
 * (`parseEvent`) that replaces the previous zod schema, keeping the package
 * dependency-free.
 */

export interface StepEvent {
  type: "step"
  id: string
  ts: number
  sessionId: string
  tool: string
  args: unknown
}

export interface ResultEvent {
  type: "result"
  id: string
  ts: number
  sessionId: string
  stepId: string
  result: unknown
}

export interface VerdictEvent {
  type: "verdict"
  id: string
  ts: number
  sessionId: string
  stepId?: string
  ok: boolean
  detail: string
}

export interface HarvestEvent {
  type: "harvest"
  id: string
  ts: number
  sessionId: string
  stepId?: string
  data: unknown
}

export interface TurnEvent {
  type: "turn"
  id: string
  ts: number
  sessionId: string
  goal: string
}

export type StoppedReason = "done" | "max_steps" | "error"

export interface DoneEvent {
  type: "done"
  id: string
  ts: number
  sessionId: string
  answer: string
  stopped?: StoppedReason
}

export type TaskStatus = "open" | "done" | "failed" | "abandoned"

export interface TaskEvent {
  type: "task"
  id: string
  ts: number
  sessionId: string
  taskId: string
  parentId: string | null
  status: TaskStatus
  title: string
}

export interface ConsolidateEvent {
  type: "consolidate"
  id: string
  ts: number
  sessionId: string
  data: {
    merged: number
    archived: number
    promoted: number
    staled: number
    mapping: Array<{ from: string; to: string }>
  }
}

export interface CompactEvent {
  type: "compact"
  id: string
  ts: number
  sessionId: string
  covers: string[]
  summary: string
}

export interface PruneEvent {
  type: "prune"
  id: string
  ts: number
  sessionId: string
  before: number
  archived: number
}

/** Discriminated union of every event the log can store */
export type Event =
  | StepEvent
  | ResultEvent
  | VerdictEvent
  | HarvestEvent
  | TurnEvent
  | DoneEvent
  | TaskEvent
  | ConsolidateEvent
  | CompactEvent
  | PruneEvent

/** Literal `type` value of an {@link Event} */
export type EventType = Event["type"]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === "string"
}

function isNumber(value: unknown): value is number {
  return typeof value === "number"
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean"
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || isString(value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value)
}

/**
 * Runtime guard that narrows arbitrary data into an {@link Event}. Mirrors the
 * shape validation the log performs on rows read back from storage; returns
 * null for anything malformed.
 *
 * @param input - Unstructured data (typically a parsed log row).
 * @returns The validated event, or null when the input does not match.
 */
export function parseEvent(input: unknown): Event | null {
  if (!isRecord(input)) return null
  const { type, id, ts, sessionId } = input
  if (!isString(type) || !isString(id) || !isNumber(ts) || !isString(sessionId)) return null

  switch (type) {
    case "step": {
      if (!isString(input.tool)) return null
      const ev: Event = { type, id, ts, sessionId, tool: input.tool, args: input.args }
      return ev
    }
    case "result": {
      if (!isString(input.stepId)) return null
      const ev: Event = { type, id, ts, sessionId, stepId: input.stepId, result: input.result }
      return ev
    }
    case "verdict": {
      if (!isBoolean(input.ok) || !isString(input.detail) || !isOptionalString(input.stepId)) return null
      const ev: Event = {
        type,
        id,
        ts,
        sessionId,
        ok: input.ok,
        detail: input.detail,
        ...(isString(input.stepId) ? { stepId: input.stepId } : {}),
      }
      return ev
    }
    case "harvest": {
      if (!isOptionalString(input.stepId)) return null
      const ev: Event = {
        type,
        id,
        ts,
        sessionId,
        ...(isString(input.stepId) ? { stepId: input.stepId } : {}),
        data: input.data,
      }
      return ev
    }
    case "turn": {
      if (!isString(input.goal)) return null
      const ev: Event = { type, id, ts, sessionId, goal: input.goal }
      return ev
    }
    case "done": {
      if (!isString(input.answer)) return null
      const stopped = input.stopped
      if (stopped !== undefined && stopped !== "done" && stopped !== "max_steps" && stopped !== "error") return null
      const ev: Event = {
        type,
        id,
        ts,
        sessionId,
        answer: input.answer,
        ...(isString(stopped) ? { stopped } : {}),
      }
      return ev
    }
    case "task": {
      if (!isString(input.taskId) || !isString(input.title) || !isNullableString(input.parentId)) return null
      const status = input.status
      if (status !== "open" && status !== "done" && status !== "failed" && status !== "abandoned") return null
      const ev: Event = {
        type,
        id,
        ts,
        sessionId,
        taskId: input.taskId,
        parentId: input.parentId,
        status,
        title: input.title,
      }
      return ev
    }
    case "consolidate": {
      const data = input.data
      if (!isRecord(data)) return null
      if (
        !isNumber(data.merged) ||
        !isNumber(data.archived) ||
        !isNumber(data.promoted) ||
        !isNumber(data.staled) ||
        !Array.isArray(data.mapping)
      ) {
        return null
      }
      const mapping: Array<{ from: string; to: string }> = []
      for (const pair of data.mapping) {
        if (!isRecord(pair) || !isString(pair.from) || !isString(pair.to)) return null
        mapping.push({ from: pair.from, to: pair.to })
      }
      const ev: Event = {
        type,
        id,
        ts,
        sessionId,
        data: { merged: data.merged, archived: data.archived, promoted: data.promoted, staled: data.staled, mapping },
      }
      return ev
    }
    case "compact": {
      const covers = input.covers
      if (!Array.isArray(covers) || !covers.every(isString) || !isString(input.summary)) return null
      const ev: Event = { type, id, ts, sessionId, covers, summary: input.summary }
      return ev
    }
    case "prune": {
      if (!isNumber(input.before) || !isNumber(input.archived)) return null
      const ev: Event = { type, id, ts, sessionId, before: input.before, archived: input.archived }
      return ev
    }
    default:
      return null
  }
}
