import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

export interface SandboxConfig {
  timeoutMs: number
  memoryLimitMb: number
  blockedModules: string[]
  allowedEnvironment: string[]
}

export interface ExecutionResult {
  stdout: string
  stderr: string
  exitCode: number
  timedOut: boolean
  durationMs: number
  error?: string
}

export interface VerificationResult {
  verified: boolean
  method: string
  answerValue?: number
  referenceValue?: number
  errorMessage: string
  metadata: Record<string, unknown>
}

export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  timeoutMs: 10000,
  memoryLimitMb: 512,
  blockedModules: ["child_process", "fs", "net", "http", "os", "cluster", "worker_threads"],
  allowedEnvironment: ["PATH", "HOME", "TMPDIR", "TEMP"],
}

export const DEFAULT_MATH_VERIFIER_TOLERANCE = 1e-5

export class MathVerifier {
  tolerance: number

  constructor(tolerance: number = DEFAULT_MATH_VERIFIER_TOLERANCE) {
    this.tolerance = tolerance
  }

  verify(generatedText: string, referenceAnswer: string): VerificationResult {
    if (MathVerifier.isLikelySymbolic(generatedText) || MathVerifier.isLikelySymbolic(referenceAnswer)) {
      const symResult = this.verifySymbolic(generatedText, referenceAnswer)
      if (symResult.verified) return symResult

      const genNum = this.extractNumber(generatedText)
      const refNum = this.extractNumber(referenceAnswer)
      if (genNum !== null && refNum !== null) {
        return this.compareNumbers(genNum, refNum)
      }

      return symResult
    }

    const genNum = this.extractNumber(generatedText)
    const refNum = this.extractNumber(referenceAnswer)

    if (genNum !== null && refNum !== null) {
      return this.compareNumbers(genNum, refNum)
    }

    return this.verifySymbolic(generatedText, referenceAnswer)
  }

  extractNumber(text: string): number | null {
    const gsm8kMatch = text.match(/####\s*([\d,]+\.?\d*)/)
    if (gsm8kMatch) {
      const cleaned = gsm8kMatch[1].replace(/,/g, "")
      const num = Number(cleaned)
      if (!Number.isNaN(num)) return num
    }

    const fractionMatch = text.match(/(\d+)\s*\/\s*(\d+)/)
    if (fractionMatch) {
      const num = Number(fractionMatch[1])
      const den = Number(fractionMatch[2])
      if (den !== 0 && !Number.isNaN(num) && !Number.isNaN(den)) return num / den
    }

    const cleanedText = text.replace(/,/g, "")
    const numberRegex = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g
    const matches = cleanedText.match(numberRegex)
    if (matches && matches.length > 0) {
      for (let i = matches.length - 1; i >= 0; i--) {
        const num = Number(matches[i])
        if (!Number.isNaN(num)) return num
      }
    }

    return null
  }

  private compareNumbers(gen: number, ref: number): VerificationResult {
    const absDiff = Math.abs(gen - ref)
    const relDiff = ref !== 0 ? absDiff / Math.abs(ref) : absDiff

    const withinTolerance = absDiff <= this.tolerance || relDiff <= this.tolerance

    return {
      verified: withinTolerance,
      method: "numeric",
      answerValue: gen,
      referenceValue: ref,
      errorMessage: withinTolerance ? "" : `Values differ by ${absDiff} (relative: ${relDiff.toExponential(4)})`,
      metadata: { absDiff, relDiff, tolerance: this.tolerance },
    }
  }

  private verifySymbolic(generated: string, reference: string): VerificationResult {
    const genExpr = MathVerifier.extractExpression(generated)
    const refExpr = MathVerifier.extractExpression(reference)

    const normalized = genExpr.toLowerCase().replace(/\s+/g, "")
    const normalizedRef = refExpr.toLowerCase().replace(/\s+/g, "")

    const exactMatch = normalized === normalizedRef

    return {
      verified: exactMatch,
      method: "symbolic",
      errorMessage: exactMatch ? "" : `Symbolic mismatch: "${genExpr}" vs "${refExpr}"`,
      metadata: { generatedExpr: genExpr, referenceExpr: refExpr },
    }
  }

  private static isLikelySymbolic(text: string): boolean {
    if (/\$|\\[a-zA-Z]/.test(text)) return true
    if (/[a-zA-Z]\s*[\^\+\-\*\/=<>]/.test(text)) return true
    if (/\b(sin|cos|tan|log|ln|sqrt|abs|exp|mod|gcd|lcm)\s*\(/i.test(text)) return true
    return false
  }

  private static extractExpression(text: string): string {
    const latexPatterns = [/\$.*?\$/g, /\$\$.*?\$\$/gs, /\\boxed\{(.*?)\}/g, /\\[a-zA-Z]+\{(.*?)\}/g]

    for (const pattern of latexPatterns) {
      const match = text.match(pattern)
      if (match) return match.join(" ")
    }

    return text
      .replace(/The (final )?answer is:?\s*/i, "")
      .replace(/Therefore,?\s*/i, "")
      .replace(/So,?\s*/i, "")
      .replace(/Thus,?\s*/i, "")
      .trim()
  }
}

export class SecureExecutor {
  config: SandboxConfig

  constructor(config?: Partial<SandboxConfig>) {
    this.config = { ...DEFAULT_SANDBOX_CONFIG, ...config }
  }

  execute(code: string, stdin?: string): Promise<ExecutionResult> {
    const startTime = Date.now()
    const tempFile = join(tmpdir(), `sandbox-${randomUUID()}.js`)

    const wrapped = this.buildWrapper(code)

    return writeFile(tempFile, wrapped, "utf-8").then(() => {
      return new Promise<ExecutionResult>((resolve) => {
        const env: Record<string, string | undefined> = {}
        for (const key of this.config.allowedEnvironment) {
          const val = process.env[key]
          if (val !== undefined) env[key] = val
        }

        const child = spawn("node", [`--max-old-space-size=${this.config.memoryLimitMb}`, tempFile], {
          env,
          stdio: ["pipe", "pipe", "pipe"],
        })

        let stdout = ""
        let stderr = ""
        let timedOut = false

        const timer = setTimeout(() => {
          timedOut = true
          child.kill("SIGKILL")
        }, this.config.timeoutMs)

        child.stdout?.on("data", (data: Buffer) => {
          stdout += data.toString()
        })

        child.stderr?.on("data", (data: Buffer) => {
          stderr += data.toString()
        })

        if (stdin && child.stdin) {
          child.stdin.write(stdin)
          child.stdin.end()
        }

        child.on("close", (exitCode: number | null) => {
          clearTimeout(timer)
          const durationMs = Date.now() - startTime

          unlink(tempFile).catch(() => {})

          resolve({
            stdout,
            stderr,
            exitCode: exitCode ?? -1,
            timedOut,
            durationMs,
          })
        })

        child.on("error", (err: Error) => {
          clearTimeout(timer)
          const durationMs = Date.now() - startTime

          unlink(tempFile).catch(() => {})

          resolve({
            stdout,
            stderr,
            exitCode: -1,
            timedOut,
            durationMs,
            error: err.message,
          })
        })
      })
    })
  }

  private buildWrapper(userCode: string): string {
    const blockedModules = JSON.stringify(this.config.blockedModules)

    return [
      "(function() {",
      `  var _blocked = ${blockedModules};`,
      "  try {",
      "    var Module = require('module');",
      "    var _origRequire = Module.prototype.require;",
      "    Module.prototype.require = function(id) {",
      "      if (_blocked.indexOf(id) !== -1) {",
      "        throw new Error('Access to module \\'' + id + '\\' is blocked in sandbox');",
      "      }",
      "      return _origRequire.apply(this, arguments);",
      "    };",
      "  } catch (_e) {}",
      userCode,
      "})();",
    ].join("\n")
  }
}

export class CodeVerifier {
  timeout: number
  private memoryLimitMb: number

  constructor(timeout = 10000, memoryLimitMb = 512) {
    this.timeout = timeout
    this.memoryLimitMb = memoryLimitMb
  }

  async verify(
    generatedCode: string,
    expectedOutput: string,
    mode: "stdout" | "pass" | "assert" = "stdout",
  ): Promise<VerificationResult> {
    const executor = new SecureExecutor({
      timeoutMs: this.timeout,
      memoryLimitMb: this.memoryLimitMb,
    })

    let codeToExecute: string
    if (mode === "assert") {
      codeToExecute = `"use strict";\n${generatedCode}`
    } else {
      codeToExecute = generatedCode
    }

    const execResult = await executor.execute(codeToExecute)

    if (execResult.error) {
      return {
        verified: false,
        method: `code_${mode}`,
        errorMessage: `Execution error: ${execResult.error}`,
        metadata: { execResult },
      }
    }

    if (mode === "pass") {
      const passed = execResult.exitCode === 0
      return {
        verified: passed,
        method: "code_pass",
        errorMessage: passed ? "" : `Exit code ${execResult.exitCode}: ${execResult.stderr}`,
        metadata: { exitCode: execResult.exitCode, stderr: execResult.stderr },
      }
    }

    if (mode === "stdout") {
      const output = execResult.stdout.trim()
      const expected = expectedOutput.trim()
      const match = output === expected
      return {
        verified: match,
        method: "code_stdout",
        errorMessage: match ? "" : `Expected "${expected}", got "${output}"`,
        metadata: { stdout: output, expected },
      }
    }

    if (mode === "assert") {
      const passed = execResult.exitCode === 0 && execResult.stderr === ""
      return {
        verified: passed,
        method: "code_assert",
        errorMessage: passed ? "" : execResult.stderr || `Exit code ${execResult.exitCode}`,
        metadata: {
          exitCode: execResult.exitCode,
          stderr: execResult.stderr,
          stdout: execResult.stdout,
        },
      }
    }

    return {
      verified: false,
      method: "code_unknown",
      errorMessage: `Unknown mode: ${mode}`,
      metadata: {},
    }
  }
}

export class LogicVerifier {
  verify(generated: string, reference: string): VerificationResult {
    const genWords = new Set(generated.toLowerCase().split(/\W+/).filter(Boolean))
    const refWords = new Set(reference.toLowerCase().split(/\W+/).filter(Boolean))

    const intersection = new Set([...genWords].filter((w) => refWords.has(w)))
    const union = new Set([...genWords, ...refWords])

    const jaccard = union.size > 0 ? intersection.size / union.size : 0

    const contradictionKeywords = /true/i.test(generated) && /false/i.test(generated)
    const negationPattern = /(?:not|never|isn't|doesn't|nor|neither)\b.*\b(?:is|has|will|can|must|should)/i.test(
      generated,
    )

    const hasContradiction = contradictionKeywords || negationPattern

    const hasPremise = /\b(?:if|given|suppose|assume|since|because)\b/i.test(generated)
    const hasConclusion = /\b(?:therefore|thus|hence|so|consequently|then)\b/i.test(generated)
    const hasStructure = hasPremise && hasConclusion

    const verified = jaccard >= 0.3 && !hasContradiction

    let errorMessage = ""
    if (hasContradiction) {
      errorMessage = "Contradiction detected in generated text"
    } else if (jaccard < 0.3) {
      errorMessage = `Low similarity (Jaccard: ${jaccard.toFixed(3)})`
    }

    return {
      verified,
      method: "logic",
      errorMessage,
      metadata: {
        jaccard,
        hasContradiction,
        hasPremise,
        hasConclusion,
        hasStructure,
        genWordCount: genWords.size,
        refWordCount: refWords.size,
      },
    }
  }
}

export class VerifierPool {
  private verifiers: Map<string, (text: string, ref: string) => VerificationResult | Promise<VerificationResult>>

  constructor() {
    this.verifiers = new Map()

    const mathVerifier = new MathVerifier()
    const codeVerifier = new CodeVerifier()
    const logicVerifier = new LogicVerifier()

    this.verifiers.set("math", (text, ref) => mathVerifier.verify(text, ref))
    this.verifiers.set("code", (text, ref) => codeVerifier.verify(text, ref, "stdout"))
    this.verifiers.set("logic", (text, ref) => logicVerifier.verify(text, ref))
  }

  registerVerifier(
    taskType: string,
    verifier: (text: string, ref: string) => VerificationResult | Promise<VerificationResult>,
  ): void {
    this.verifiers.set(taskType, verifier)
  }

  async verify(taskType: string, generated: string, reference: string): Promise<VerificationResult> {
    const verifier = this.verifiers.get(taskType)
    if (!verifier) {
      return this.fallbackVerify(generated, reference)
    }
    return await verifier(generated, reference)
  }

  getRegisteredTypes(): string[] {
    return Array.from(this.verifiers.keys())
  }

  private fallbackVerify(generated: string, reference: string): VerificationResult {
    const match = generated.trim() === reference.trim()
    return {
      verified: match,
      method: "fallback_exact",
      errorMessage: match ? "" : "Generated text does not match reference",
      metadata: {},
    }
  }
}

/**
 * Create a {@link SecureExecutor} instance.
 *
 * @param args - Constructor arguments forwarded to {@link SecureExecutor}.
 * @returns A new {@link SecureExecutor}.
 */
export function createSecureExecutor(...args: ConstructorParameters<typeof SecureExecutor>): SecureExecutor {
  return new SecureExecutor(...args)
}

/**
 * Create a {@link VerifierPool} instance.
 *
 * @param args - Constructor arguments forwarded to {@link VerifierPool}.
 * @returns A new {@link VerifierPool}.
 */
export function createVerifierPool(...args: ConstructorParameters<typeof VerifierPool>): VerifierPool {
  return new VerifierPool(...args)
}
