import { createHash } from "node:crypto"

/**
 * Deterministic JSON stringification: object keys are sorted recursively so
 * the same logical value always serializes to the same string, regardless of
 * key insertion order.
 *
 * @param value - Any JSON-serializable value.
 * @returns The canonical string form.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
  return `{${entries.join(",")}}`
}

/**
 * Content hash of a value's canonical JSON (first 40 hex chars of SHA-256).
 * Idempotent writes and evidence verification both key on this hash.
 *
 * @param content - Any JSON-serializable value.
 * @returns A 40-character hex digest.
 */
export function contentHash(content: unknown): string {
  return createHash("sha256").update(stableStringify(content)).digest("hex").slice(0, 40)
}
