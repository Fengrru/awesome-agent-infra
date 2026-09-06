import { contentHash, stableStringify } from "@fengrru/evidence-log"

export { contentHash, stableStringify }

export type KnowledgeKind = "memory" | "skill" | "policy" | "connection-meta"
export type ProvenanceSource = "trajectory" | "search" | "mcp" | "human" | "self-reflection" | "consolidation"
export type VerificationStatus = "unverified" | "verified" | "failed" | "stale"
export type KnowledgeState = "draft" | "active" | "stale" | "archived"

export interface Ref {
  url?: string
  sessionId?: string
  connection?: string
  knowledgeId?: string
}

export type Check = { type: "command"; cmd: string } | { type: "assert"; expr: string }

export interface Verification {
  status: VerificationStatus
  check: Check | null
  lastVerifiedAt: number | null
}

export interface Metrics {
  uses: number
  successes: number
  lastUsedAt: number | null
}

export interface Provenance {
  source: ProvenanceSource
  refs: Ref[]
  created: number
}

export interface KnowledgeObject {
  id: string
  name: string
  kind: KnowledgeKind
  version: number
  parentId: string | null
  content: unknown
  provenance: Provenance
  evidence: string[]
  verification: Verification
  ttl: number | null
  state: KnowledgeState
  metrics: Metrics
}

export type NewKnowledgeObject = Omit<KnowledgeObject, "id" | "name" | "version" | "parentId">

const knowledgeKinds: KnowledgeKind[] = ["memory", "skill", "policy", "connection-meta"]
const provenanceSources: ProvenanceSource[] = [
  "trajectory",
  "search",
  "mcp",
  "human",
  "self-reflection",
  "consolidation",
]
const verificationStatuses: VerificationStatus[] = ["unverified", "verified", "failed", "stale"]
const knowledgeStates: KnowledgeState[] = ["draft", "active", "stale", "archived"]

export function isKnowledgeKind(value: unknown): value is KnowledgeKind {
  return knowledgeKinds.includes(value as KnowledgeKind)
}

export function isProvenanceSource(value: unknown): value is ProvenanceSource {
  return provenanceSources.includes(value as ProvenanceSource)
}

export function isVerificationStatus(value: unknown): value is VerificationStatus {
  return verificationStatuses.includes(value as VerificationStatus)
}

export function isKnowledgeState(value: unknown): value is KnowledgeState {
  return knowledgeStates.includes(value as KnowledgeState)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string"
}

function isString(value: unknown): value is string {
  return typeof value === "string"
}

function isNullableString(value: unknown): value is string | null | undefined {
  return value === null || value === undefined || isString(value)
}

export function parseRef(input: unknown): Ref | null {
  if (!isRecord(input)) return null
  if (
    !isOptionalString(input.url) ||
    !isOptionalString(input.sessionId) ||
    !isOptionalString(input.connection) ||
    !isNullableString(input.knowledgeId)
  ) {
    return null
  }
  const ref: Ref = {
    ...(isString(input.url) ? { url: input.url } : {}),
    ...(isString(input.sessionId) ? { sessionId: input.sessionId } : {}),
    ...(isString(input.connection) ? { connection: input.connection } : {}),
    ...(isString(input.knowledgeId) ? { knowledgeId: input.knowledgeId } : {}),
  }
  return ref
}

export function parseCheck(input: unknown): Check | null {
  if (!isRecord(input) || (input.type !== "command" && input.type !== "assert")) return null
  if (input.type === "command" && isString(input.cmd)) return { type: "command", cmd: input.cmd }
  if (input.type === "assert" && isString(input.expr)) return { type: "assert", expr: input.expr }
  return null
}
