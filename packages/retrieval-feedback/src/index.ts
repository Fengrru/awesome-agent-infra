/**
 * retrieval-feedback
 *
 * Retrieval filters and usage-based re-ranking extracted from the seed
 * self-hosted-agent project. This package is intentionally small: it provides
 * the shared signals that any retrieval strategy (TF-IDF, dense embedding,
 * keyword, hybrid) applies after scoring candidates.
 *
 * The three primitives are:
 *
 * - {@link isExpired}: drop knowledge whose TTL has elapsed.
 * - {@link injectable}: drop drafts, stale/archived entries, and unverified
 *   skills so a poisoned session cannot overwrite established knowledge.
 * - {@link usageFactor}: multiply a base relevance score by a bounded signal
 *   derived from `uses` and `successes`, so entries that help often rank
 *   higher and entries that fail are penalized.
 *
 * @example
 * ```ts
 * import { isExpired, injectable, usageFactor } from "@fengrru/retrieval-feedback"
 * import type { KnowledgeObject } from "@fengrru/knowledge-vault"
 *
 * const scored = candidates
 *   .filter((o) => injectable(o) && !isExpired(o, Date.now()))
 *   .map((o) => ({ object: o, score: rawScore(o) * usageFactor(o) }))
 * ```
 *
 * @module
 */

import type { KnowledgeObject } from "@fengrru/knowledge-vault"

/** A retriever backed by a knowledge store. */
export interface Retriever {
  retrieve(query: string, limit: number): Promise<KnowledgeObject[]>
}

/**
 * True when the object's TTL has elapsed since creation.
 *
 * @param obj - A knowledge object.
 * @param now - Reference timestamp (defaults-aware callers pass `Date.now()`).
 * @returns Whether the entry is expired.
 */
export function isExpired(obj: KnowledgeObject, now: number): boolean {
  return obj.ttl !== null && obj.provenance.created + obj.ttl < now
}

/**
 * True when the object is safe to inject into a prompt.
 *
 * Drafts are proposals that may be poisoned; stale/archived entries are no
 * longer authoritative; skills must be verified before they can be used.
 *
 * @param obj - A knowledge object.
 * @returns Whether the entry should be injected.
 */
export function injectable(obj: KnowledgeObject): boolean {
  if (obj.state === "draft") return false
  if (obj.state === "stale" || obj.state === "archived") return false
  if (obj.kind === "skill") return obj.verification.status === "verified"
  return true
}

/**
 * Bounded usage-derived multiplier for re-ranking candidates. A small
 * "gets smarter with use" signal with no storage cost.
 *
 * @param obj - A knowledge object.
 * @returns A positive multiplier to apply to a base score.
 */
export function usageFactor(obj: KnowledgeObject): number {
  const { uses, successes } = obj.metrics
  const health = 1 + 0.3 * Math.tanh((successes - uses / 2) / 5)
  return (1 + Math.log10(uses + 2) * 0.2) * health
}
