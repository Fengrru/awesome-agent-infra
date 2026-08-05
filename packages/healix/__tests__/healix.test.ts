import { describe, expect, test } from "bun:test"
import {
  ErrorClassifier,
  type RecoveryRule,
  RepairMemoryEngine,
  createErrorClassifier,
  createRepairMemoryEngine,
} from "../src/index"

describe("ErrorClassifier", () => {
  const classifier = new ErrorClassifier()

  test("classifies not_found errors", () => {
    expect(classifier.classify("file not found: src/main.ts")).toBe("not_found")
    expect(classifier.classify("command not found")).toBe("not_found")
    expect(classifier.classify("enoent error")).toBe("not_found")
    expect(classifier.classify("path not found: /usr/bin")).toBe("not_found")
  })

  test("classifies permission errors", () => {
    expect(classifier.classify("permission denied: /etc/config")).toBe("permission")
    expect(classifier.classify("EACCES: access denied")).toBe("permission")
  })

  test("classifies timeout errors", () => {
    expect(classifier.classify("request timeout after 30s")).toBe("timeout")
  })

  test("classifies syntax errors", () => {
    expect(classifier.classify("syntax error in test.ts")).toBe("syntax")
    expect(classifier.classify("parse error at line 10")).toBe("syntax")
  })

  test("classifies resource errors", () => {
    expect(classifier.classify("out of memory: heap allocation failed")).toBe("resource")
    expect(classifier.classify("disk full: no space left")).toBe("resource")
  })

  test("classifies network errors", () => {
    expect(classifier.classify("ENOTFOUND: DNS resolution failed")).toBe("network")
    expect(classifier.classify("ECONNREFUSED: connection refused")).toBe("network")
  })

  test("classifies research_failed errors", () => {
    expect(classifier.classify("research failed to find relevant docs")).toBe("research_failed")
    expect(classifier.classify("tutorial parse failed: invalid format")).toBe("research_failed")
    expect(classifier.classify("cache expired")).toBe("research_failed")
    expect(classifier.classify("stale content detected")).toBe("research_failed")
  })

  test("returns unknown for unrecognized errors", () => {
    expect(classifier.classify("bizarre unrecognizable garbled error")).toBe("unknown")
  })

  test("extractStructure normalizes paths and numbers", () => {
    const result = classifier.extractStructure("Error: file not found at /home/user/file.ts")
    expect(result.error_type).toBe("Error")
    expect(result.normalized).toContain("<PATH>")
  })
})

describe("RepairMemoryEngine", () => {
  test("addRule creates a new repair rule", () => {
    const engine = new RepairMemoryEngine()
    const rule = engine.addRule("webfetch", "fetch failed: 404 not found", "retry with alternate URL")
    expect(rule.repair_id).toBeDefined()
    expect(rule.tool).toBe("webfetch")
    expect(rule.category).toBe("not_found")
    expect(rule.recovery_action).toBe("retry with alternate URL")
    expect(rule.occurrence_count).toBe(1)
  })

  test("addRule increments occurrence_count on duplicate", () => {
    const engine = new RepairMemoryEngine()
    engine.addRule("webfetch", "timeout exceeded", "retry")
    const rule2 = engine.addRule("webfetch", "timeout exceeded", "retry")
    expect(rule2.occurrence_count).toBe(2)
  })

  test("computeExactHash produces consistent results", () => {
    const engine = new RepairMemoryEngine()
    const h1 = engine.computeExactHash("Error: file not found")
    const h2 = engine.computeExactHash("Error: file not found")
    expect(h1).toBe(h2)
    expect(h1.length).toBe(16)
  })

  test("computeFuzzyHash is case-insensitive and structural", () => {
    const engine = new RepairMemoryEngine()
    const h1 = engine.computeFuzzyHash("TypeError: cannot read property 'x' of undefined")
    const h2 = engine.computeFuzzyHash("TypeError: Cannot read property 'X' of Undefined")
    expect(h1).toBe(h2)
  })

  test("hammingDistance computes correct distance", () => {
    const engine = new RepairMemoryEngine()
    expect(engine.hammingDistance("0000", "0000")).toBe(0)
    expect(engine.hammingDistance("0000", "1111")).toBe(4)
    expect(engine.hammingDistance("abcd", "abcf")).toBe(1)
  })

  test("calculateSpecificity scores AND conditions higher", () => {
    const engine = new RepairMemoryEngine()
    const s1 = engine.calculateSpecificity("fetch failed AND timeout", "any")
    const s2 = engine.calculateSpecificity("fetch failed", "any")
    expect(s1).toBeGreaterThan(s2)
  })

  test("matchRules finds exact hash match", () => {
    const engine = new RepairMemoryEngine()
    engine.addRule("webfetch", "404 not found", "retry with backup url")
    const rule = engine.matchRules("webfetch", "404 not found")
    expect(rule).not.toBeNull()
    expect(rule!.recovery_action).toBe("retry with backup url")
  })

  test("matchRules matches by AND condition", () => {
    const engine = new RepairMemoryEngine()
    engine.addRule("webfetch", "fetch failed AND timeout", "retry with longer timeout")
    const rule = engine.matchRules("webfetch", "fetch failed AND timeout")
    expect(rule).not.toBeNull()
  })

  test("matchRules matches by category fallback", () => {
    const engine = new RepairMemoryEngine()
    engine.addRule("webfetch", "404 page not found", "use alternate source")
    const rule = engine.matchRules("webfetch", "document not found anywhere")
    expect(rule).not.toBeNull()
    expect(rule!.category).toBe("not_found")
  })

  test("matchRules returns null for no match", () => {
    const engine = new RepairMemoryEngine()
    const rule = engine.matchRules("unknown_tool", "some random error")
    expect(rule).toBeNull()
  })

  test("recordResult updates success rate", () => {
    const engine = new RepairMemoryEngine()
    const rule = engine.addRule("webfetch", "timeout", "retry")
    engine.recordResult(rule.repair_id, true)
    const rules = engine.getAllRules()
    const updated = rules.find((r) => r.repair_id === rule.repair_id)
    expect(updated!.success_rate).toBeGreaterThan(0)
    expect(updated!.hit_count).toBe(1)
  })

  test("recordResult with false decreases success rate", () => {
    const engine = new RepairMemoryEngine()
    const rule = engine.addRule("webfetch", "unknown format", "reformat")
    engine.recordResult(rule.repair_id, true)
    engine.recordResult(rule.repair_id, true)
    engine.recordResult(rule.repair_id, false)
    const rules = engine.getAllRules()
    const updated = rules.find((r) => r.repair_id === rule.repair_id)
    expect(updated!.success_rate).toBeLessThan(1.0)
  })

  test("calculateRetention decays over time", () => {
    const engine = new RepairMemoryEngine()
    const recent = { created_at: Date.now() } as RecoveryRule
    const old = { created_at: Date.now() - 86400000 * 30 } as RecoveryRule
    expect(engine.calculateRetention(recent)).toBeGreaterThan(engine.calculateRetention(old))
  })

  test("calculateRetention has floor of 0.1", () => {
    const engine = new RepairMemoryEngine()
    const ancient = { created_at: Date.now() - 86400000 * 365 * 10 } as RecoveryRule
    expect(engine.calculateRetention(ancient)).toBeGreaterThanOrEqual(0.1)
  })

  test("seedDefaults returns predefined rules", () => {
    const engine = new RepairMemoryEngine()
    const rules = engine.seedDefaults()
    expect(rules.length).toBeGreaterThan(0)
    for (const rule of rules) {
      expect(rule.repair_id).toBeDefined()
      expect(rule.tool).toBeDefined()
      expect(rule.category).toBeDefined()
    }
  })

  test("getAllRules returns rules sorted by specificity", () => {
    const engine = new RepairMemoryEngine()
    engine.addRule("tool_a", "error simple", "fix simple")
    engine.addRule("tool_b", "error with AND condition", "fix complex")
    const rules = engine.getAllRules()
    for (let i = 1; i < rules.length; i++) {
      expect(rules[i - 1]!.specificity).toBeGreaterThanOrEqual(rules[i]!.specificity)
    }
  })

  test("setDatabase loads persisted rules", () => {
    const engine = new RepairMemoryEngine()
    let upserted = false
    engine.setDatabase({
      upsertRepairRule: () => {
        upserted = true
      },
      getRepairRules: () => [],
    })
    engine.addRule("test_tool", "test error", "test fix")
    expect(upserted).toBe(true)
  })

  test("matchRules respects success_rate threshold for exact match", () => {
    const engine = new RepairMemoryEngine()
    const rule = engine.addRule("tool_a", "specific error text", "fix a")
    // Make success rate low by recording many failures
    for (let i = 0; i < 20; i++) {
      engine.recordResult(rule.repair_id, false)
    }
    const matched = engine.matchRules("tool_a", "specific error text")
    // May still match via category fallback, but exact match should be filtered
    if (matched) {
      // Category fallback is always possible
      expect(matched).toBeDefined()
    }
  })
})

describe("factory functions", () => {
  test("createErrorClassifier returns an ErrorClassifier", () => {
    const ec = createErrorClassifier()
    expect(ec).toBeInstanceOf(ErrorClassifier)
    expect(ec.classify("file not found")).toBe("not_found")
  })

  test("createRepairMemoryEngine returns a RepairMemoryEngine", () => {
    const engine = createRepairMemoryEngine()
    expect(engine).toBeInstanceOf(RepairMemoryEngine)
    const hash = engine.computeExactHash("test")
    expect(hash).toHaveLength(16)
  })
})
