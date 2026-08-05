import { describe, expect, test } from "bun:test"
import { ValidationNetwork, createDefaultExternalScanner, createValidationNetwork } from "../src/index"

describe("ValidationNetwork", () => {
  const valid8 = new ValidationNetwork({ threshold: 0.7, maxRetries: 3 })

  // ── Layer 1: Syntax ────────────────────────────────────────────────────

  describe("runSyntaxValidation", () => {
    test("valid TypeScript passes syntax check", async () => {
      const result = await valid8.runSyntaxValidation(
        "const x: number = 1;\nfunction add(a: number, b: number): number { return a + b; }",
        "test.ts",
      )
      expect(result.layer).toBe("syntax")
      expect(result.score).toBeGreaterThanOrEqual(0.7)
    })

    test("valid JavaScript passes regex fallback", async () => {
      const result = await valid8.runSyntaxValidation("const x = 1;\nconsole.log(x);", "test.js")
      expect(result.layer).toBe("syntax")
      expect(result.score).toBeGreaterThanOrEqual(0.7)
    })

    test("non-TS/JS files use brace/paren/bracket matching", async () => {
      const result = await valid8.runSyntaxValidation("def hello():\n    print('hello')\n", "test.py")
      expect(result.layer).toBe("syntax")
      expect(result.score).toBeGreaterThanOrEqual(0.7)
    })

    test("mismatched braces are detected in non-TS files", async () => {
      const result = await valid8.runSyntaxValidation("function broken() { return 1;\n", "test.txt")
      expect(result.score).toBeLessThan(1.0)
      expect(result.report).toContain("Mismatched")
    })

    test("duplicate const declaration is flagged", async () => {
      const result = await valid8.runSyntaxValidation("const const x = 1;", "test.ts")
      expect(result.score).toBeLessThan(1.0)
      expect(result.report).toContain("Duplicate")
    })

    test("bare TODO comments are flagged", async () => {
      const result = await valid8.runSyntaxValidation("// TODO\nconst x = 1;", "test.ts")
      expect(result.score).toBeLessThan(1.0)
      expect(result.report).toContain("TODO")
    })
  })

  // ── Layer 2: Semantic ──────────────────────────────────────────────────

  describe("runSemanticValidation", () => {
    test("keyword fallback matches relevant output", async () => {
      const result = await valid8.runSemanticValidation(
        "This function calculates the total price from items array using reduce",
        "calculate total price from items",
      )
      expect(result.layer).toBe("semantic")
      expect(result.score).toBeGreaterThan(0.3)
    })

    test("unrelated output scores low on keyword fallback", async () => {
      const result = await valid8.runSemanticValidation("lorem ipsum dolor sit amet", "generate TypeScript unit tests")
      expect(result.layer).toBe("semantic")
      // Should score lower since output has no matching keywords
      expect(result.score).toBeLessThan(0.8)
    })

    test("short output gets length penalty", async () => {
      const resultNormal = await valid8.runSemanticValidation(
        "This is a long and detailed response about TypeScript unit testing strategies",
        "generate TypeScript unit tests",
      )
      const resultShort = await valid8.runSemanticValidation("hi", "generate TypeScript unit tests")
      expect(resultShort.score).toBeLessThanOrEqual(resultNormal.score)
    })

    test("LLM review callback is used when provided", async () => {
      const mockLLM = async (_output: string, _goal: string) => ({
        score: 0.95,
        report: "Output perfectly matches the goal",
      })
      const result = await valid8.runSemanticValidation("const test = () => {}", "write tests", mockLLM)
      expect(result.layer).toBe("semantic")
      expect(result.score).toBe(0.95)
      expect(result.report).toContain("LLM review")
    })
  })

  // ── Layer 3: Runtime ───────────────────────────────────────────────────

  describe("runRuntimeValidation", () => {
    test("clean output returns perfect score", async () => {
      const result = await valid8.runRuntimeValidation("Build completed successfully. All tests passed.")
      expect(result.layer).toBe("runtime")
      expect(result.score).toBe(1.0)
      expect(result.report).toBe("No runtime errors detected")
    })

    test("TypeScript compilation errors detected", async () => {
      const result = await valid8.runRuntimeValidation(
        "error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.",
      )
      expect(result.score).toBeLessThan(1.0)
      expect(result.report).toContain("compilation")
    })

    test("test failures detected", async () => {
      const result = await valid8.runRuntimeValidation(
        "1 test failed\nAssertionError: expected true but got false\nFAIL",
      )
      expect(result.score).toBeLessThan(1.0)
      expect(result.report).toContain("test_failure")
    })

    test("crash patterns detected", async () => {
      const result = await valid8.runRuntimeValidation("fatal: out of memory\nprocess exited with signal SIGSEGV")
      expect(result.score).toBeLessThan(1.0)
      expect(result.report).toContain("crash")
    })

    test("error categories are summarized", async () => {
      const result = await valid8.runRuntimeValidation("error TS1000: bad\nFAIL test\ntypeerror: x is not a function")
      expect(result.report).toMatch(/compilation|test_failure|runtime_error/)
    })
  })

  // ── Layer 4: Security ──────────────────────────────────────────────────

  describe("runSecurityValidation", () => {
    test("clean code passes security check", async () => {
      const result = await valid8.runSecurityValidation("const greeting = 'hello world';\nconsole.log(greeting);")
      expect(result.layer).toBe("security")
      expect(result.score).toBe(1.0)
      expect(result.report).toBe("Security check passed")
    })

    test("destructive command patterns detected", async () => {
      const result = await valid8.runSecurityValidation("rm -rf / && chmod 777 /")
      expect(result.score).toBeLessThan(1.0)
      expect(result.report).toContain("destructive")
    })

    test("SQL injection patterns detected", async () => {
      const result = await valid8.runSecurityValidation(
        "SELECT * FROM users WHERE name = 'admin' OR '1'='1'; DROP TABLE users;",
      )
      expect(result.score).toBeLessThan(1.0)
      expect(result.report).toContain("sql_injection")
    })

    test("code injection patterns detected", async () => {
      const result = await valid8.runSecurityValidation("eval(userInput); exec('rm -rf /');")
      expect(result.score).toBeLessThan(1.0)
      expect(result.report).toContain("code_injection")
    })

    test("permission rules block bash when not allowed", async () => {
      const result = await valid8.runSecurityValidation("spawn('ls', ['-la'])", { allowBash: false })
      expect(result.score).toBeLessThan(1.0)
      expect(result.report).toContain("permission")
    })

    test("permission rules allow bash when allowed", async () => {
      const result = await valid8.runSecurityValidation("spawn('ls', ['-la'])", { allowBash: true })
      // Should not flag bash when allowed
      expect(result.report).not.toContain("permission: bash")
    })

    test("blocked patterns are enforced", async () => {
      const result = await valid8.runSecurityValidation("const secretKey = 'abc123'", {
        blockedPatterns: ["secretKey"],
      })
      expect(result.score).toBeLessThan(1.0)
      expect(result.report).toContain("blocked pattern")
    })
  })

  // ── Meta ───────────────────────────────────────────────────────────────

  describe("confidence and retry logic", () => {
    test("calculateConfidence computes weighted average", () => {
      const results = [
        { layer: "syntax" as const, score: 1.0, report: "" },
        { layer: "semantic" as const, score: 0.8, report: "" },
        { layer: "runtime" as const, score: 0.9, report: "" },
        { layer: "security" as const, score: 1.0, report: "" },
      ]
      const confidence = valid8.calculateConfidence(results)
      // weights: syntax(0.2)*1 + semantic(0.3)*0.8 + runtime(0.3)*0.9 + security(0.2)*1
      // = 0.2 + 0.24 + 0.27 + 0.2 = 0.91
      expect(confidence).toBe(0.91)
    })

    test("shouldRetry returns true when below threshold", () => {
      expect(valid8.shouldRetry(0.5, 1)).toBe(true)
    })

    test("shouldRetry returns false when at threshold", () => {
      expect(valid8.shouldRetry(0.7, 0)).toBe(false)
    })

    test("shouldRetry returns false when retries exhausted", () => {
      expect(valid8.shouldRetry(0.5, 3)).toBe(false)
    })

    test("getThreshold and getMaxRetries match config", () => {
      expect(valid8.getThreshold()).toBe(0.7)
      expect(valid8.getMaxRetries()).toBe(3)
    })
  })
})

describe("createDefaultExternalScanner", () => {
  test("returns a scanner function", () => {
    const scanner = createDefaultExternalScanner()
    expect(typeof scanner).toBe("function")
  })

  test("scanner handles empty code gracefully", async () => {
    const scanner = createDefaultExternalScanner()
    const issues = await scanner("")
    expect(Array.isArray(issues)).toBe(true)
    expect(issues.length).toBe(0)
  })
})

describe("createValidationNetwork", () => {
  test("returns a ValidationNetwork instance", () => {
    const vn = createValidationNetwork({ threshold: 0.5, maxRetries: 2 })
    expect(vn).toBeInstanceOf(ValidationNetwork)
    expect(vn.getThreshold()).toBe(0.5)
    expect(vn.getMaxRetries()).toBe(2)
  })

  test("works with no arguments", () => {
    const vn = createValidationNetwork()
    expect(vn).toBeInstanceOf(ValidationNetwork)
  })
})
