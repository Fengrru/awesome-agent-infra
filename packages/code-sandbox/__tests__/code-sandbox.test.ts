import { describe, expect, test } from "bun:test"
import {
  MathVerifier,
  SecureExecutor,
  CodeVerifier,
  LogicVerifier,
  VerifierPool,
  DEFAULT_MATH_VERIFIER_TOLERANCE,
  DEFAULT_SANDBOX_CONFIG,
} from "../src/index"

describe("MathVerifier", () => {
  test("extractNumber: plain integer", () => {
    const v = new MathVerifier()
    expect(v.extractNumber("the answer is 42")).toBe(42)
  })

  test("extractNumber: decimal", () => {
    const v = new MathVerifier()
    expect(v.extractNumber("result is 3.14 meters")).toBe(3.14)
  })

  test("extractNumber: negative number", () => {
    const v = new MathVerifier()
    expect(v.extractNumber("temperature is -15 degrees")).toBe(-15)
  })

  test("extractNumber: GSM8K format", () => {
    const v = new MathVerifier()
    expect(v.extractNumber("#### 1,234.56")).toBe(1234.56)
  })

  test("extractNumber: GSM8K format with text prefix", () => {
    const v = new MathVerifier()
    expect(v.extractNumber("The total cost is #### 500")).toBe(500)
  })

  test("extractNumber: fraction", () => {
    const v = new MathVerifier()
    expect(v.extractNumber("the ratio is 3/4")).toBe(0.75)
  })

  test("extractNumber: fraction with spaces", () => {
    const v = new MathVerifier()
    expect(v.extractNumber("1 / 2 of the pie")).toBe(0.5)
  })

  test("extractNumber: scientific notation", () => {
    const v = new MathVerifier()
    expect(v.extractNumber("6.022e23")).toBe(6.022e23)
  })

  test("extractNumber: number with commas", () => {
    const v = new MathVerifier()
    expect(v.extractNumber("budget is 1,000,000")).toBe(1000000)
  })

  test("extractNumber: returns last number when multiple present", () => {
    const v = new MathVerifier()
    expect(v.extractNumber("x=10 y=20 z=30")).toBe(30)
  })

  test("extractNumber: no number returns null", () => {
    const v = new MathVerifier()
    expect(v.extractNumber("hello world")).toBeNull()
  })

  test("verify: exact match", () => {
    const v = new MathVerifier()
    const result = v.verify("answer: 42", "42")
    expect(result.verified).toBe(true)
    expect(result.method).toBe("numeric")
    expect(result.answerValue).toBe(42)
    expect(result.referenceValue).toBe(42)
  })

  test("verify: within absolute tolerance", () => {
    const v = new MathVerifier(0.1)
    const result = v.verify("3.14", "3.14159")
    expect(result.verified).toBe(true)
  })

  test("verify: outside tolerance", () => {
    const v = new MathVerifier(0.001)
    const result = v.verify("3.14", "3.5")
    expect(result.verified).toBe(false)
  })

  test("verify: within relative tolerance", () => {
    const v = new MathVerifier(1e-5)
    const result = v.verify("1000", "1000.001")
    expect(result.verified).toBe(true)
  })

  test("verify: zero reference with absolute tolerance", () => {
    const v = new MathVerifier(0.1)
    const result = v.verify("0.05", "0")
    expect(result.verified).toBe(true)
  })

  test("verify: symbolic match", () => {
    const v = new MathVerifier()
    const result = v.verify("x^2 + 3x + 2", "x^2 + 3x + 2")
    expect(result.method).toBe("symbolic")
    expect(result.verified).toBe(true)
  })

  test("verify: symbolic mismatch", () => {
    const v = new MathVerifier()
    const result = v.verify("hello", "world")
    expect(result.method).toBe("symbolic")
    expect(result.verified).toBe(false)
  })

  test("verify: LaTeX expression extraction for symbolic comparison", () => {
    const v = new MathVerifier()
    const result = v.verify("$x^2 + y^2$", "$x^2 + y^2$")
    expect(result.verified).toBe(true)
  })

  test("verify: removes 'The answer is' prefix in symbolic mode", () => {
    const v = new MathVerifier()
    const result = v.verify("The answer is: banana", "banana")
    expect(result.verified).toBe(true)
  })

  test("default tolerance is exported", () => {
    expect(DEFAULT_MATH_VERIFIER_TOLERANCE).toBe(1e-5)
  })
})

describe("SecureExecutor", () => {
  test("execute: simple console.log captures stdout", async () => {
    const executor = new SecureExecutor({ timeoutMs: 5000 })
    const result = await executor.execute("console.log('hello sandbox')")
    expect(result.stdout.trim()).toBe("hello sandbox")
    expect(result.exitCode).toBe(0)
    expect(result.timedOut).toBe(false)
  })

  test("execute: captures stderr", async () => {
    const executor = new SecureExecutor({ timeoutMs: 5000 })
    const result = await executor.execute("console.error('oops')")
    expect(result.stderr).toContain("oops")
    expect(result.exitCode).toBe(0)
  })

  test("execute: exit code from process.exit", async () => {
    const executor = new SecureExecutor({ timeoutMs: 5000 })
    const result = await executor.execute("process.exit(7)")
    expect(result.exitCode).toBe(7)
  })

  test("execute: timeout kills the process", async () => {
    const executor = new SecureExecutor({ timeoutMs: 500 })
    const result = await executor.execute("while(true){}")
    expect(result.timedOut).toBe(true)
  })

  test("execute: blocked module throws error", async () => {
    const executor = new SecureExecutor({ timeoutMs: 5000 })
    const result = await executor.execute("require('fs')")
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("blocked")
  })

  test("execute: allowed module works", async () => {
    const executor = new SecureExecutor({ timeoutMs: 5000 })
    const result = await executor.execute("var p = require('path'); console.log(p.basename('/a/b/c'))")
    expect(result.stdout.trim()).toBe("c")
    expect(result.exitCode).toBe(0)
  })

  test("default config is exported", () => {
    expect(DEFAULT_SANDBOX_CONFIG.timeoutMs).toBe(10000)
    expect(DEFAULT_SANDBOX_CONFIG.memoryLimitMb).toBe(512)
    expect(DEFAULT_SANDBOX_CONFIG.blockedModules).toContain("fs")
    expect(DEFAULT_SANDBOX_CONFIG.blockedModules).toContain("child_process")
  })

  test("config can be partially overridden", () => {
    const executor = new SecureExecutor({ timeoutMs: 3000 })
    expect(executor.config.timeoutMs).toBe(3000)
    expect(executor.config.memoryLimitMb).toBe(512)
  })
})

describe("CodeVerifier", () => {
  test("stdout mode: matching output passes", async () => {
    const v = new CodeVerifier(5000)
    const result = await v.verify("console.log(1 + 2)", "3", "stdout")
    expect(result.verified).toBe(true)
    expect(result.method).toBe("code_stdout")
  })

  test("stdout mode: mismatched output fails", async () => {
    const v = new CodeVerifier(5000)
    const result = await v.verify("console.log('hello')", "bye", "stdout")
    expect(result.verified).toBe(false)
  })

  test("pass mode: zero exit code passes", async () => {
    const v = new CodeVerifier(5000)
    const result = await v.verify("var x = 1 + 1", "", "pass")
    expect(result.verified).toBe(true)
    expect(result.method).toBe("code_pass")
  })

  test("pass mode: non-zero exit code fails", async () => {
    const v = new CodeVerifier(5000)
    const result = await v.verify("throw new Error('fail')", "", "pass")
    expect(result.verified).toBe(false)
  })

  test("assert mode: valid expression passes", async () => {
    const v = new CodeVerifier(5000)
    const result = await v.verify("var result = 2 + 2", "", "assert")
    expect(result.verified).toBe(true)
  })

  test("assert mode: syntax error fails", async () => {
    const v = new CodeVerifier(5000)
    const result = await v.verify("var x = {", "", "assert")
    expect(result.verified).toBe(false)
  })

  test("default mode is stdout", async () => {
    const v = new CodeVerifier(5000)
    const result = await v.verify("console.log('ok')", "ok")
    expect(result.verified).toBe(true)
  })
})

describe("LogicVerifier", () => {
  test("similar texts pass", () => {
    const v = new LogicVerifier()
    const result = v.verify(
      "If it rains, the ground is wet. Therefore, the ground is wet.",
      "The ground is wet because it is raining.",
    )
    expect(result.verified).toBe(true)
    expect(result.method).toBe("logic")
  })

  test("very different texts fail on low similarity", () => {
    const v = new LogicVerifier()
    const result = v.verify("apple banana cherry", "xylophone zebra quantum")
    expect(result.verified).toBe(false)
    expect(result.metadata.jaccard as number).toBeLessThan(0.3)
  })

  test("contradiction keywords cause failure", () => {
    const v = new LogicVerifier()
    const result = v.verify(
      "The answer is true and also false according to the reasoning.",
      "The correct answer is true.",
    )
    expect(result.verified).toBe(false)
    expect(result.metadata.hasContradiction).toBe(true)
  })

  test("negation pattern causes failure", () => {
    const v = new LogicVerifier()
    const result = v.verify(
      "This is not the correct solution and should never be used.",
      "This is the correct solution.",
    )
    expect(result.verified).toBe(false)
    expect(result.metadata.hasContradiction).toBe(true)
  })

  test("detects premise-conclusion structure", () => {
    const v = new LogicVerifier()
    const result = v.verify(
      "Since all men are mortal and Socrates is a man, therefore Socrates is mortal.",
      "Socrates is mortal because he is a man.",
    )
    expect(result.metadata.hasStructure).toBe(true)
  })

  test("exact same text passes", () => {
    const v = new LogicVerifier()
    const result = v.verify("hello world", "hello world")
    expect(result.verified).toBe(true)
    expect(result.metadata.jaccard).toBe(1)
  })

  test("metadata includes word counts", () => {
    const v = new LogicVerifier()
    const result = v.verify("one two three", "one two")
    expect(result.metadata.genWordCount).toBe(3)
    expect(result.metadata.refWordCount).toBe(2)
  })
})

describe("VerifierPool", () => {
  test("pre-registered math verifier works", async () => {
    const pool = new VerifierPool()
    const result = await pool.verify("math", "x = 3.14", "3.14")
    expect(result.verified).toBe(true)
  })

  test("pre-registered code verifier works", async () => {
    const pool = new VerifierPool()
    const result = await pool.verify("code", "console.log('ok')", "ok")
    expect(result.verified).toBe(true)
  })

  test("pre-registered logic verifier works", async () => {
    const pool = new VerifierPool()
    const result = await pool.verify(
      "logic",
      "The ground is wet, therefore it rained.",
      "It rained so the ground is wet.",
    )
    expect(result.verified).toBe(true)
  })

  test("unknown type falls back to exact string match", async () => {
    const pool = new VerifierPool()
    const result = await pool.verify("unknown", "hello", "hello")
    expect(result.verified).toBe(true)
    expect(result.method).toBe("fallback_exact")
  })

  test("unknown type fallback fails on mismatch", async () => {
    const pool = new VerifierPool()
    const result = await pool.verify("unknown", "hello", "world")
    expect(result.verified).toBe(false)
  })

  test("registerVerifier adds custom verifier", async () => {
    const pool = new VerifierPool()
    pool.registerVerifier("custom", (text, ref) => ({
      verified: text.includes(ref),
      method: "custom",
      errorMessage: "",
      metadata: {},
    }))

    const result = await pool.verify("custom", "hello world", "world")
    expect(result.verified).toBe(true)
    expect(result.method).toBe("custom")
  })

  test("getRegisteredTypes returns registered types", () => {
    const pool = new VerifierPool()
    const types = pool.getRegisteredTypes()
    expect(types).toContain("math")
    expect(types).toContain("code")
    expect(types).toContain("logic")
  })
})
