/**
 * Healix — Self-Healing Error Classifier & Repair Engine
 *
 * Dual-hash matching (exact MD5 + fuzzy structural hash) with Hamming distance
 * tolerance enables matching similar-but-not-identical errors. Self-learning
 * success_rate tracking automatically promotes effective repair rules.
 *
 * Zero runtime dependencies — only Node.js built-in `crypto`.
 *
 * @module healix
 */

import { createHash } from "node:crypto"

// ── Types ──────────────────────────────────────────────────────────────────

export type ErrorCategory =
  | "not_found"
  | "permission"
  | "timeout"
  | "syntax"
  | "resource"
  | "network"
  | "research_failed"
  | "unknown"

export interface RecoveryRule {
  repair_id: string
  tool: string
  category: ErrorCategory
  condition: string
  recovery_action: string
  /** Higher = more specific match */
  specificity: number
  /** Times this rule has matched */
  hit_count: number
  /** Timestamp of last match */
  last_hit: number
  /** How many times this error pattern occurred */
  occurrence_count: number
  /** Self-learning: rolling average of recovery success */
  success_rate: number
  /** ISO timestamp of creation */
  created_at: number
  /** MD5 hash of normalized error */
  exact_hash: string
  /** Structural fuzzy hash for similar-error matching */
  fuzzy_hash: string
  /** Extracted error type (e.g. 'TypeError') */
  error_type: string
  /** Core symbols extracted from the error */
  core_symbols: string[]
}

export interface RepairDatabase {
  upsertRepairRule(rule: RecoveryRule): void
  getRepairRules(): RecoveryRule[]
}

// ── Error Classifier ──────────────────────────────────────────────────────

/**
 * Classifies errors into 8 categories using keyword matching.
 * Extracts error structure (type, symbols, normalized form) for hashing.
 */
export class ErrorClassifier {
  private static CATEGORY_PATTERNS: [ErrorCategory, string[]][] = [
    ["not_found", ["not found", "no such file", "does not exist", "path not found", "enoent"]],
    ["permission", ["permission", "denied", "forbidden", "unauthorized", "eacces"]],
    ["timeout", ["timeout", "timed out", "deadline exceeded", "etimedout"]],
    ["syntax", ["syntax", "invalid syntax", "parse error", "unexpected token", "esyntax"]],
    ["resource", ["oom", "out of memory", "disk full", "enospc"]],
    ["network", ["network", "connection refused", "econnrefused", "enotfound", "fetch failed", "dns"]],
    ["research_failed", ["research failed", "tutorial parse failed", "no results found", "cache expired", "stale content"]],
  ]

  classify(error: string): ErrorCategory {
    const e = error.toLowerCase()
    for (const [category, keywords] of ErrorClassifier.CATEGORY_PATTERNS) {
      if (keywords.some((k) => e.includes(k))) return category
    }
    return "unknown"
  }

  /**
   * Extract structured info from an error message:
   * - error_type: e.g. 'TypeError', 'EACCES'
   * - core_symbols: full-qualified symbols (e.g. 'fs.readFile')
   * - normalized: version with paths/numbers/hex/strings replaced by placeholders
   */
  extractStructure(error: string): {
    error_type: string
    core_symbols: string[]
    normalized: string
  } {
    const normalized = error
      .replace(/\/[^\s]+\/[^\s]+/g, "<PATH>")
      .replace(/\d+/g, "<N>")
      .replace(/0x[0-9a-fA-F]+/g, "<HEX>")
      .replace(/"([^"]+)"/g, "<STRING>")

    const symbolRegex = /(?:at\s+)?([A-Za-z_][\w.]*(?:\.[\w]+)+)(?:\s|\(|$)/g
    const core_symbols: string[] = []
    let match
    while ((match = symbolRegex.exec(error)) !== null) {
      if (!core_symbols.includes(match[1]!)) {
        core_symbols.push(match[1]!)
      }
    }

    const typeMatch = error.match(/(\w+Error|\w+Exception|E\w+)/)
    const error_type = typeMatch ? typeMatch[1] : "UnknownError"

    return { error_type, core_symbols, normalized }
  }
}

// ── Repair Memory Engine ──────────────────────────────────────────────────

/**
 * Core self-healing engine with dual-hash matching.
 *
 * Matching strategy (3 tiers):
 *   1. Exact hash match (MD5 of normalized error) — tool-specific, success_rate > 0.8
 *   2. Condition-based match (AND-separated predicates)
 *   3. Fuzzy hash match (Hamming distance ≤ 3, success_rate > 0.6)
 *   4. Category fallback
 */
export class RepairMemoryEngine {
  private errorClassifier = new ErrorClassifier()
  private rules = new Map<string, RecoveryRule>()
  private readonly MAX_RULES = 50
  private db: RepairDatabase | null = null

  /** Connect to a persistent database and load stored rules */
  setDatabase(db: RepairDatabase): void {
    this.db = db
    const persisted = db.getRepairRules()
    for (const rule of persisted) {
      const key = this.getRuleKey(rule.category, rule.tool, rule.condition)
      if (!this.rules.has(key)) {
        this.rules.set(key, rule)
      }
    }
  }

  /** MD5 hash of the normalized error (exact dedup) */
  computeExactHash(error: string): string {
    const { normalized } = this.errorClassifier.extractStructure(error)
    return createHash("md5").update(normalized).digest("hex").substring(0, 16)
  }

  /** Structural fuzzy hash from error_type + core_symbols (similarity matching) */
  computeFuzzyHash(error: string): string {
    const { error_type, core_symbols } = this.errorClassifier.extractStructure(error)
    const parts = [error_type, ...core_symbols.slice(0, 5)]
    const combined = parts.join("|")
    let hash = 0
    for (let i = 0; i < combined.length; i++) {
      const char = combined.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash |= 0
    }
    return hash.toString(16).padStart(16, "0")
  }

  /** Hamming distance between two hex hash strings */
  hammingDistance(hash1: string, hash2: string): number {
    let distance = 0
    const len = Math.min(hash1.length, hash2.length)
    for (let i = 0; i < len; i++) {
      if (hash1[i] !== hash2[i]) distance++
    }
    return distance
  }

  /**
   * Specificity scoring — more constrained conditions get higher scores.
   *   10 pts: condition contains AND (multiple constraints)
   *    5 pts: context.contains(...) pattern
   *    3 pts: non-generic tool binding
   *    1 pt:  any condition (not "always")
   */
  calculateSpecificity(condition: string, tool: string): number {
    let score = 0
    if (condition.includes("AND")) score += 10
    if (condition.includes("context.contains")) score += 5
    if (condition.includes("tool=") && tool !== "any") score += 3
    if (condition !== "always") score += 1
    return score
  }

  /**
   * Add a repair rule (or increment occurrence_count if duplicate).
   * Auto-computes exact_hash, fuzzy_hash, and condition.
   */
  addRule(tool: string, error: string, recoveryAction: string): RecoveryRule {
    const category = this.errorClassifier.classify(error)
    const exactHash = this.computeExactHash(error)
    const fuzzyHash = this.computeFuzzyHash(error)
    const { error_type, core_symbols } = this.errorClassifier.extractStructure(error)

    const key = this.getRuleKey(category, tool, error)
    const existing = this.rules.get(key)

    if (existing) {
      existing.occurrence_count++
      existing.last_hit = Date.now()
      return existing
    }

    // LRU eviction
    if (this.rules.size >= this.MAX_RULES) {
      const firstKey = this.rules.keys().next().value
      if (firstKey) this.rules.delete(firstKey)
    }

    const condition = this.buildCondition(tool, error)
    const specificity = this.calculateSpecificity(condition, tool)

    const rule: RecoveryRule = {
      repair_id: `repair_${Date.now()}`,
      tool,
      category,
      condition,
      recovery_action: recoveryAction,
      specificity,
      hit_count: 0,
      last_hit: Date.now(),
      occurrence_count: 1,
      success_rate: 0,
      created_at: Date.now(),
      exact_hash: exactHash,
      fuzzy_hash: fuzzyHash,
      error_type,
      core_symbols,
    }

    this.rules.set(key, rule)
    if (this.db) {
      try { this.db.upsertRepairRule(rule) } catch { /* persistence optional */ }
    }
    return rule
  }

  /**
   * Match an error against known repair rules using 3-tier strategy:
   *   1. Exact hash + high success_rate (> 0.8)
   *   2. Condition-based AND-matching
   *   3. Fuzzy hash (Hamming ≤ 3) + moderate success_rate (> 0.6)
   *   4. Category fallback
   */
  matchRules(tool: string, error: string): RecoveryRule | null {
    const fuzzyHash = this.computeFuzzyHash(error)
    const category = this.errorClassifier.classify(error)

    const candidates = Array.from(this.rules.values())
      .filter((r) => this.calculateRetention(r) > 0.1)
      .sort((a, b) => b.specificity - a.specificity)

    // Tier 1: exact hash match for same tool
    for (const rule of candidates) {
      if (
        rule.tool === tool &&
        this.computeExactHash(error) === this.computeExactHash(rule.recovery_action)
      ) {
        if (rule.success_rate > 0.8) return rule
      }
    }

    // Tier 2: AND-condition matching
    for (const rule of candidates) {
      const conditions = rule.condition.split(" AND ").map((c) => c.trim())
      const allMatch = conditions.every((cond) => {
        if (cond.startsWith("tool=")) return tool === cond.slice(5).replace(/'/g, "")
        if (cond.startsWith("context.contains(")) {
          const keyword = cond.slice(16, -1)
          return error.includes(keyword)
        }
        return error.includes(cond) || tool.includes(cond)
      })
      if (allMatch) return rule
    }

    // Tier 3: fuzzy hash matching
    for (const rule of candidates) {
      const ruleFuzzyHash = this.computeFuzzyHash(rule.recovery_action)
      if (this.hammingDistance(fuzzyHash, ruleFuzzyHash) <= 3 && rule.success_rate > 0.6) {
        return rule
      }
    }

    // Tier 4: category fallback
    for (const rule of candidates) {
      if (rule.category === category) return rule
    }

    return null
  }

  /**
   * Record the outcome of a repair attempt (self-learning).
   * Updates success_rate as a rolling average.
   * Promotes specificity when confidence is high (success_rate > 0.8, hits > 5).
   */
  recordResult(ruleId: string, success: boolean): void {
    for (const [, rule] of this.rules) {
      if (rule.repair_id === ruleId) {
        rule.hit_count++
        rule.last_hit = Date.now()
        rule.success_rate =
          (rule.success_rate * (rule.hit_count - 1) + (success ? 1 : 0)) / rule.hit_count

        if (rule.success_rate > 0.8 && rule.hit_count > 5) {
          rule.specificity += 5
        }

        if (this.db) {
          try { this.db.upsertRepairRule(rule) } catch { /* persistence optional */ }
        }
        return
      }
    }
  }

  /** Exponential decay retention: R = exp(-hours/168) — 1-week half-life */
  calculateRetention(rule: RecoveryRule): number {
    const hours = (Date.now() - (rule.last_hit || rule.created_at)) / 3_600_000
    return Math.max(0.1, Math.exp(-hours / 168))
  }

  getAllRules(): RecoveryRule[] {
    return Array.from(this.rules.values()).sort((a, b) => b.specificity - a.specificity)
  }

  /** Seed 6 predefined recovery rules for common agent errors */
  seedDefaults(): RecoveryRule[] {
    const seeds: Array<{ tool: string; error: string; recoveryAction: string }> = [
      {
        tool: "webfetch",
        error: "fetch failed: connection refused",
        recoveryAction: "RETRY_3: Wait 2s between retries, then fallback to websearch for alternative sources",
      },
      {
        tool: "webfetch",
        error: "timeout waiting for response",
        recoveryAction: "RETRY_WITH_BACKOFF: Retry up to 3 times with exponential backoff (2s, 4s, 8s)",
      },
      {
        tool: "tutorial_parser",
        error: "tutorial parse failed: no structured content extracted",
        recoveryAction: "FALLBACK_RAW: Use the raw webfetch output directly without parsing, include original HTML content",
      },
      {
        tool: "websearch",
        error: "no results found for query",
        recoveryAction: "REWRITE_QUERY: Simplify keywords and broaden search terms, remove version-specific numbers",
      },
      {
        tool: "shell",
        error: "command not found",
        recoveryAction: "SKIP_AND_REPORT: Mark the dependency as missing in the research report, continue with remaining steps",
      },
      {
        tool: "research",
        error: "cache expired or stale content",
        recoveryAction: "REFRESH: Re-run websearch with current date filter, discard cached results older than 7 days",
      },
    ]

    const rules: RecoveryRule[] = []
    for (const seed of seeds) {
      const rule = this.addRule(seed.tool, seed.error, seed.recoveryAction)
      rules.push(rule)
    }
    return rules
  }

  // ── Internal ───────────────────────────────────────────────────────────

  private getRuleKey(category: string, tool: string, condition: string): string {
    if (["not_found", "permission", "timeout"].includes(category)) {
      return `${category}:${condition}`
    }
    return `${category}:${tool}:${condition}`
  }

  private buildCondition(tool: string, error: string): string {
    const parts: string[] = []
    if (tool !== "any") parts.push(`tool='${tool}'`)
    const { error_type } = this.errorClassifier.extractStructure(error)
    if (error_type !== "UnknownError") parts.push(error_type)
    return parts.join(" AND ") || "always"
  }
}
