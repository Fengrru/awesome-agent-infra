/**
 * Hashing utilities for code entities.
 *
 * Produces signature_hash (parameter list + return type) and
 * content_hash (full entity body) for incremental change detection
 * and impact analysis.
 *
 * Uses node:crypto for SHA-256, zero external dependencies.
 *
 * @module codegraph/hashing
 */

import { createHash } from "node:crypto"

export interface EntitySource {
  /** Entity name */
  name: string
  /** Full source text of the entity */
  body: string
  /** Signature-like source (parameters + return type) */
  signatureSource: string
}

export interface EntityHashes {
  signatureHash: string
  contentHash: string
}

/**
 * Compute signature and content hashes for an entity.
 *
 * @param source - The entity source info
 * @returns SHA-256 hashes
 */
export function computeEntityHashes(source: EntitySource): EntityHashes {
  return {
    signatureHash: hashString(source.signatureSource),
    contentHash: hashString(source.body),
  }
}

/**
 * Compute SHA-256 hash of a string.
 */
export function hashString(input: string): string {
  return createHash("sha256").update(input).digest("hex")
}

/**
 * Compute SHA-256 hash of a Buffer.
 */
export function hashBuffer(input: Buffer): string {
  return createHash("sha256").update(input).digest("hex")
}

/**
 * Check if two hashes indicate the same content.
 */
export function hashesEqual(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false
  return a === b
}

/**
 * Check if a signature has changed by comparing hashes.
 * Returns true if the signature has changed.
 */
export function signatureChanged(oldHash: string | undefined, newHash: string | undefined): boolean {
  return !hashesEqual(oldHash, newHash)
}

/**
 * Build a signature source string from entity metadata.
 * Format: "name(param1:type1=default1, param2:type2): returnType"
 */
export function buildSignatureSource(
  name: string,
  parameters: Array<{ name: string; type: string; optional?: boolean }>,
  returnType?: string,
): string {
  const params = parameters.map((p) => `${p.name}:${p.type}${p.optional ? "?" : ""}`).join(",")
  const ret = returnType ? `:${returnType}` : ""
  return `${name}(${params})${ret}`
}

/**
 * Build a content source string from entity body text.
 */
export function buildContentSource(_name: string, bodyText: string): string {
  return bodyText
}
