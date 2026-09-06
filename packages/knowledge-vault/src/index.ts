/**
 * knowledge-vault
 *
 * A dependency-free, append-only knowledge store for agents. Each entry has a
 * version chain (parent → child), a content-addressed id, derivation edges to
 * upstream knowledge, a verification state, and usage metrics.
 *
 * The vault exposes a small `SelfStore` interface and a default
 * `SqliteSelfStore` implementation. Like `@fengrru/evidence-log`, it does not
 * import any SQLite driver; pass one in.
 *
 * Extracted from the seed self-hosted-agent project.
 *
 * @example
 * ```ts
 * import { Database } from "bun:sqlite" // or node:sqlite
 * import { SqliteSelfStore } from "@fengrru/knowledge-vault"
 *
 * const store = new SqliteSelfStore(new Database("agent.db"))
 * const obj = store.add("project:rules", {
 *   kind: "memory",
 *   content: "Always prefer explicit imports.",
 *   provenance: { source: "human", refs: [], created: Date.now() },
 *   evidence: [],
 *   verification: { status: "unverified", check: null, lastVerifiedAt: null },
 *   ttl: null,
 *   state: "draft",
 *   metrics: { uses: 0, successes: 0, lastUsedAt: null },
 * })
 * ```
 *
 * @module
 */

export type { SqliteDb, SqliteStatement } from "./db.js"
export type {
  Check,
  KnowledgeKind,
  KnowledgeObject,
  KnowledgeState,
  Metrics,
  NewKnowledgeObject,
  Provenance,
  ProvenanceSource,
  Ref,
  Verification,
  VerificationStatus,
} from "./schema.js"
export {
  contentHash,
  isKnowledgeKind,
  isKnowledgeState,
  isProvenanceSource,
  isVerificationStatus,
  parseCheck,
  parseRef,
  stableStringify,
} from "./schema.js"
export type { SelfStore } from "./store.js"
export { DataCorruptionError, SqliteSelfStore } from "./store.js"
