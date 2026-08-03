/**
 * Valid8 — Multi-Layer AI Output Validation Network
 *
 * 4-layer validation pipeline:
 *   1. SYNTAX   — TypeScript AST parsing + regex fallback
 *   2. SEMANTIC — LLM reviewer (delegated) + keyword relevance fallback
 *   3. RUNTIME  — Structured error extraction from test/build output
 *   4. SECURITY — 40+ patterns across 6 categories + permission-aware
 *
 * @module valid8
 */

import { spawn } from "node:child_process"

// ── Types ──────────────────────────────────────────────────────────────────

export interface ValidationResult {
  layer: "syntax" | "semantic" | "runtime" | "security"
  /** 0-1 score */
  score: number
  report: string
}

export interface ValidationConfig {
  /** Confidence threshold for pass (default 0.7) */
  threshold: number
  /** Max retries on failure (default 3) */
  maxRetries: number
}

export interface PermissionRuleset {
  allowBash?: boolean
  allowWrite?: boolean
  allowNetwork?: boolean
  allowedPaths?: string[]
  blockedPatterns?: string[]
}

/** LLM reviewer callback — compares output against original goal */
export type LLMReviewFn = (output: string, originalGoal: string) => Promise<{ score: number; report: string }>

/** External security scanner callback (e.g. semgrep, bandit wrapper) */
export type ExternalSecurityScanner = (code: string) => Promise<string[]>

export interface StructuredError {
  category: "crash" | "compilation" | "test_failure" | "build_error" | "runtime_error" | "warning"
  message: string
  filePath?: string
  lineNumber?: number
}

// ── Security Patterns ─────────────────────────────────────────────────────

const SECURITY_PATTERNS = {
  destructive: [
    "rm -rf /",
    "rm -rf ~",
    "rm -rf .",
    "dd if=",
    "mkfs.",
    ":(){ :|:& };:",
    "> /dev/sda",
    "> /dev/hda",
    "chmod 777 /",
    "chmod -R 777 /",
  ],
  sqlInjection: ["DROP TABLE", "DROP DATABASE", "TRUNCATE TABLE", "'; DROP", "'; DELETE", "1=1", "OR '1'='1'"],
  pathTraversal: ["/etc/passwd", "/etc/shadow", "../../../", "....//....//", "%2e%2e%2f", "..\\..\\..\\"],
  codeInjection: [
    "eval(",
    "exec(",
    "system(",
    "shell_exec(",
    "passthru(",
    "popen(",
    "proc_open(",
    "assert(",
    "Function(",
    "new Function",
    "process.mainModule",
    "require('child_process')",
    "spawn(",
    "fork(",
    "subprocess.call(",
    "os.system(",
  ],
  cryptoMining: ["stratum+tcp://", "xmrig", "minerd", "cgminer", "cpuminer", "cryptonight", "nicehash"],
  reverseShell: [
    "nc -e /bin/sh",
    "nc -e /bin/bash",
    "bash -i >&",
    "python -c 'import socket",
    "perl -e 'use Socket",
    "ruby -rsocket",
    "php -r '$sock=fsockopen",
    "/dev/tcp/",
  ],
} as const

const LIKELY_TS_JS = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/i

// ── ValidationNetwork ─────────────────────────────────────────────────────

export class ValidationNetwork {
  private config: ValidationConfig

  constructor(config?: Partial<ValidationConfig>) {
    this.config = {
      threshold: config?.threshold ?? 0.7,
      maxRetries: config?.maxRetries ?? 3,
    }
  }

  // ── Layer 1: Syntax ────────────────────────────────────────────────────

  /**
   * Syntax validation using TypeScript AST parsing (for TS/JS files)
   * with regex-based fallback for other languages.
   */
  async runSyntaxValidation(code: string, filePath: string): Promise<ValidationResult> {
    const issues: string[] = []

    if (LIKELY_TS_JS.test(filePath)) {
      try {
        const astIssues = await tryParseWithTypeScript(code, filePath)
        issues.push(...astIssues)
      } catch {
        // TypeScript not installed — fallback to regex
      }
    }

    // Regex-based fallback (catches non-TS/JS files too)
    if (/\b(const const|let let|var var)\b/.test(code)) {
      issues.push("Duplicate variable declaration")
    }
    if (!LIKELY_TS_JS.test(filePath)) {
      if ((code.match(/\{/g) || []).length !== (code.match(/\}/g) || []).length) {
        issues.push("Mismatched braces")
      }
      if ((code.match(/\(/g) || []).length !== (code.match(/\)/g) || []).length) {
        issues.push("Mismatched parentheses")
      }
      if ((code.match(/\[/g) || []).length !== (code.match(/\]/g) || []).length) {
        issues.push("Mismatched brackets")
      }
    }

    const bareTodos = code.match(/\/\/\s*TODO\s*$/gm) || []
    if (bareTodos.length > 0) {
      issues.push(`${bareTodos.length} bare TODO comment(s) without description`)
    }

    const score = issues.length === 0 ? 1.0 : Math.max(0, 1.0 - issues.length * 0.15)
    return {
      layer: "syntax",
      score,
      report: issues.length > 0 ? issues.join("; ") : "Syntax check passed",
    }
  }

  // ── Layer 2: Semantic ──────────────────────────────────────────────────

  /**
   * Semantic validation — delegates to LLM when available, falls back to
   * keyword-based relevance scoring.
   */
  async runSemanticValidation(
    output: string,
    originalGoal: string,
    llmReview?: LLMReviewFn,
  ): Promise<ValidationResult> {
    if (llmReview) {
      const { score, report } = await llmReview(output, originalGoal)
      return {
        layer: "semantic",
        score: Math.max(0, Math.min(1.0, score)),
        report: `LLM review: ${report}`,
      }
    }

    // Fallback: keyword-based relevance scoring
    const outputLower = output.toLowerCase()
    const goalKeywords = originalGoal
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3)
    const matchedKeywords = goalKeywords.filter((kw) => outputLower.includes(kw))

    const outputLengthPenalty = output.length < 20 ? 0.1 : 0
    const score = goalKeywords.length > 0 ? matchedKeywords.length / goalKeywords.length - outputLengthPenalty : 0.5

    return {
      layer: "semantic",
      score: Math.max(0, Math.min(1.0, score + 0.3)),
      report: `[fallback] Goal relevance: ${matchedKeywords.length}/${goalKeywords.length} keywords matched`,
    }
  }

  // ── Layer 3: Runtime ───────────────────────────────────────────────────

  /**
   * Runtime validation — extracts structured errors from test/build output.
   * Categorizes: crash, compilation, test_failure, build_error, runtime_error, warning.
   */
  async runRuntimeValidation(output: string, testOutput?: string, buildOutput?: string): Promise<ValidationResult> {
    const allOutput = [output, testOutput, buildOutput].filter(Boolean).join("\n")
    const errors = extractStructuredErrors(allOutput)

    if (errors.length === 0) {
      return { layer: "runtime", score: 1.0, report: "No runtime errors detected" }
    }

    const severityWeights: Record<string, number> = {
      crash: 1.0,
      compilation: 0.9,
      test_failure: 0.7,
      build_error: 0.8,
      runtime_error: 0.6,
      warning: 0.3,
    }
    const penalty = errors.reduce((sum, e) => sum + (severityWeights[e.category] ?? 0.5) * 0.1, 0)
    const score = Math.max(0, 1.0 - penalty)

    const byCategory = new Map<string, number>()
    for (const e of errors) {
      byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + 1)
    }
    const summary = Array.from(byCategory.entries())
      .map(([cat, count]) => `${cat}(${count})`)
      .join(", ")

    return { layer: "runtime", score, report: `Runtime issues detected: ${summary}` }
  }

  // ── Layer 4: Security ──────────────────────────────────────────────────

  /**
   * Security validation — 40+ built-in patterns across 6 categories,
   * plus permission-aware checks and optional external scanner.
   */
  async runSecurityValidation(
    code: string,
    permission?: PermissionRuleset,
    externalScanner?: ExternalSecurityScanner,
  ): Promise<ValidationResult> {
    const found: string[] = []
    const codeLower = code.toLowerCase()

    const patternCategories: Array<{ category: string; patterns: readonly string[] }> = [
      { category: "destructive", patterns: SECURITY_PATTERNS.destructive },
      { category: "sql_injection", patterns: SECURITY_PATTERNS.sqlInjection },
      { category: "path_traversal", patterns: SECURITY_PATTERNS.pathTraversal },
      { category: "code_injection", patterns: SECURITY_PATTERNS.codeInjection },
      { category: "crypto_mining", patterns: SECURITY_PATTERNS.cryptoMining },
      { category: "reverse_shell", patterns: SECURITY_PATTERNS.reverseShell },
    ]

    for (const { category, patterns } of patternCategories) {
      for (const pattern of patterns) {
        if (codeLower.includes(pattern.toLowerCase())) {
          found.push(`${category}: ${pattern}`)
        }
      }
    }

    // External scanner
    if (externalScanner) {
      try {
        const externalIssues = await externalScanner(code)
        for (const issue of externalIssues) {
          found.push(`external: ${issue}`)
        }
      } catch {
        found.push("external: security scanner failed to execute")
      }
    }

    // Permission-aware checks
    if (permission) {
      if (!permission.allowBash && /bash|shell|exec|spawn/i.test(code)) {
        found.push("permission: bash/shell execution not allowed")
      }
      if (!permission.allowWrite && /write|create|save/i.test(code)) {
        found.push("permission: file write not allowed")
      }
      if (!permission.allowNetwork && /fetch|http|curl|wget|axios/i.test(code)) {
        found.push("permission: network access not allowed")
      }
      if (permission.blockedPatterns) {
        for (const blocked of permission.blockedPatterns) {
          if (codeLower.includes(blocked.toLowerCase())) {
            found.push(`permission: blocked pattern "${blocked}"`)
          }
        }
      }
    }

    const score = found.length === 0 ? 1.0 : Math.max(0, 1.0 - found.length * 0.25)
    return {
      layer: "security",
      score,
      report: found.length > 0 ? `Security concerns found: ${found.join(", ")}` : "Security check passed",
    }
  }

  // ── Meta ───────────────────────────────────────────────────────────────

  /** Weighted confidence across all 4 layers */
  calculateConfidence(results: ValidationResult[]): number {
    const weights: Record<ValidationResult["layer"], number> = {
      syntax: 0.2,
      semantic: 0.3,
      runtime: 0.3,
      security: 0.2,
    }
    const total = results.reduce((sum, r) => sum + r.score * weights[r.layer], 0)
    return Math.round(total * 100) / 100
  }

  shouldRetry(confidence: number, retryCount: number): boolean {
    return confidence < this.config.threshold && retryCount < this.config.maxRetries
  }

  getThreshold(): number {
    return this.config.threshold
  }
  getMaxRetries(): number {
    return this.config.maxRetries
  }
}

// ── TypeScript AST Syntax Check ───────────────────────────────────────────

interface WalkContext {
  issues: string[]
  source: unknown // ts.SourceFile (avoids direct ts import for optional dep)
}

async function tryParseWithTypeScript(code: string, filePath: string): Promise<string[]> {
  // Lazy-load TypeScript — it's an optional peer dependency
  let ts: typeof import("typescript") | undefined
  try {
    ts = await import("typescript")
  } catch {
    return []
  }

  const source = ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest, true)

  const issues: string[] = []

  // Parse diagnostics
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const diags = (
    source as unknown as { parseDiagnostics?: Array<{ messageText: unknown; start?: number; length?: number }> }
  ).parseDiagnostics
  if (diags && diags.length > 0) {
    for (const diag of diags) {
      if (diag.start !== undefined && diag.length !== undefined) {
        const snippet = code.slice(diag.start, diag.start + diag.length)
        issues.push(`Parse error: ${ts.flattenDiagnosticMessageText(diag.messageText as string, "\n")} at "${snippet}"`)
      } else {
        issues.push(`Parse error: ${ts.flattenDiagnosticMessageText(diag.messageText as string, "\n")}`)
      }
    }
  }

  // AST quality walk
  const walkCtx: WalkContext = { issues, source }
  walkAST(ts, source, walkCtx)

  return issues
}

function walkAST(ts: typeof import("typescript"), node: import("typescript").Node, ctx: WalkContext): void {
  // Empty catch blocks
  if (ts.isCatchClause(node)) {
    if (node.block && node.block.statements.length === 0) {
      ctx.issues.push("Empty catch block — swallowing errors silently")
    }
  }

  // "any" type usage
  if (ts.isTypeNode(node) && node.kind === ts.SyntaxKind.AnyKeyword) {
    ctx.issues.push("Usage of 'any' type — consider a more specific type")
  }

  // console.* calls
  if (ts.isCallExpression(node)) {
    const expr = node.expression
    if (
      ts.isPropertyAccessExpression(expr) &&
      ts.isIdentifier(expr.expression) &&
      expr.expression.text === "console" &&
      ["log", "warn", "error", "debug"].includes(expr.name.text)
    ) {
      ctx.issues.push(`console.${expr.name.text}() call — remove before production`)
    }
  }

  // Empty block statements
  if (ts.isBlock(node) && node.statements.length === 0) {
    const parent = node.parent
    if (
      parent &&
      !ts.isFunctionDeclaration(parent) &&
      !ts.isMethodDeclaration(parent) &&
      !ts.isIfStatement(parent) &&
      !ts.isCatchClause(parent) &&
      !ts.isForStatement(parent) &&
      !ts.isWhileStatement(parent) &&
      !ts.isTryStatement(parent)
    ) {
      ctx.issues.push("Empty block statement — dead code or incomplete logic")
    }
  }

  // eval() calls
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "eval") {
    ctx.issues.push("eval() call detected — security risk, consider alternatives")
  }

  ts.forEachChild(node, (child) => walkAST(ts, child, ctx))
}

// ── Structured Error Extraction ───────────────────────────────────────────

function extractStructuredErrors(output: string): StructuredError[] {
  const errors: StructuredError[] = []

  // Compilation errors
  const compilationPatterns = [
    /error\s+TS\d{4}:/gi,
    /error:\s*(expected|undeclared|cannot find)/gi,
    /compilation failed/gi,
    /syntax error/gi,
  ]
  for (const pattern of compilationPatterns) {
    for (const match of output.matchAll(pattern)) {
      const ctx = output.slice(Math.max(0, match.index! - 20), match.index! + 80)
      errors.push({ category: "compilation", message: ctx.trim(), lineNumber: extractLineNumber(ctx) })
    }
  }

  // Test failures
  const testPatterns = [
    /tests?\s+failed/gi,
    /\bfail\b.*\d+\s+test/gi,
    /assertion.*failed/gi,
    /expected.*but got/gi,
    /assertionerror/gi,
    /expect\(.*\)\.toBe/gi,
  ]
  for (const pattern of testPatterns) {
    for (const match of output.matchAll(pattern)) {
      const ctx = output.slice(Math.max(0, match.index! - 30), match.index! + 100)
      errors.push({ category: "test_failure", message: ctx.trim() })
    }
  }

  // Runtime errors
  const runtimePatterns = [
    /\btypeerror\b/gi,
    /\breferenceerror\b/gi,
    /\brangeerror\b/gi,
    /\burierror\b/gi,
    /\bcannot find module\b/gi,
    /\bmodule not found\b/gi,
    /\benoent\b/gi,
    /\beacces\b/gi,
    /\beaddrinuse\b/gi,
  ]
  for (const pattern of runtimePatterns) {
    for (const match of output.matchAll(pattern)) {
      const ctx = output.slice(Math.max(0, match.index! - 20), match.index! + 80)
      errors.push({
        category: "runtime_error",
        message: ctx.trim(),
        filePath: extractFilePath(ctx),
        lineNumber: extractLineNumber(ctx),
      })
    }
  }

  // Crashes
  const crashPatterns = [
    /\bpanic\b/gi,
    /\bsegfault\b/gi,
    /\bsigsegv\b/gi,
    /\bsigabrt\b/gi,
    /\bstack overflow\b/gi,
    /\bout of memory\b/gi,
  ]
  for (const pattern of crashPatterns) {
    for (const match of output.matchAll(pattern)) {
      const ctx = output.slice(Math.max(0, match.index! - 20), match.index! + 60)
      errors.push({ category: "crash", message: ctx.trim() })
    }
  }

  // Build errors
  const buildPatterns = [
    /\bbuild (failed|error)/gi,
    /\bbun build.*error/gi,
    /\bnpm run build.*error/gi,
    /\bcargo build.*error/gi,
  ]
  for (const pattern of buildPatterns) {
    for (const match of output.matchAll(pattern)) {
      const ctx = output.slice(Math.max(0, match.index! - 20), match.index! + 80)
      errors.push({ category: "build_error", message: ctx.trim() })
    }
  }

  // Warnings
  const warningPatterns = [/\bwarning\b/gi, /\bdeprecated\b/gi, /\bwarn\b/gi]
  for (const pattern of warningPatterns) {
    for (const match of output.matchAll(pattern)) {
      const ctx = output.slice(Math.max(0, match.index! - 20), match.index! + 60)
      errors.push({ category: "warning", message: ctx.trim() })
    }
  }

  return errors
}

function extractLineNumber(ctx: string): number | undefined {
  const match = ctx.match(/[:\s](\d+)[:,\s]/)
  return match ? Number.parseInt(match[1]!, 10) : undefined
}

function extractFilePath(ctx: string): string | undefined {
  const match = ctx.match(/([^\s:"]+\.(ts|tsx|js|jsx|py|rs|go|java))[:,\s]/i)
  return match ? match[1] : undefined
}

// ── External Scanner Factory ──────────────────────────────────────────────

function spawnAsync(
  command: string,
  args: string[],
  input: string,
  timeout: number,
): Promise<{ status: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout,
    })
    let stdout = ""
    proc.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString()
    })
    proc.stderr?.on("data", () => {
      /* drain stderr so the child process is not blocked */
    })
    proc.on("close", (code) => {
      resolve({ status: code, stdout })
    })
    const onError = (err: Error): void => reject(err)
    proc.on("error", onError)
    proc.stdin?.write(input)
    proc.stdin?.end()
  })
}

/**
 * Create a default external security scanner using semgrep (then bandit).
 * Uses `child_process.spawnSync` — gracefully returns empty results if tools
 * are not installed.
 */
export function createDefaultExternalScanner(): ExternalSecurityScanner {
  return async (code: string): Promise<string[]> => {
    const issues: string[] = []

    // Try semgrep
    try {
      const proc = await spawnAsync("semgrep", ["--config", "auto", "--quiet", "-"], code, 30_000)
      if (proc.status === 0 || proc.status === 1) {
        const output = proc.stdout || ""
        if (output.trim()) {
          for (const line of output.split("\n")) {
            const trimmed = line.trim()
            if (trimmed && !trimmed.startsWith("\u2500") && !trimmed.startsWith("\u254c")) {
              issues.push(trimmed.slice(0, 200))
            }
          }
        }
      }
    } catch {
      // semgrep not installed — silent fallback
    }

    // Try bandit (Python-specific)
    if (issues.length === 0 && /def\s|import\s|class\s.*:/.test(code)) {
      try {
        const proc = await spawnAsync("bandit", ["-q", "-"], code, 30_000)
        if (proc.status !== null && proc.status !== 127) {
          const output = proc.stdout || ""
          for (const line of output.split("\n")) {
            const trimmed = line.trim()
            if (trimmed.startsWith(">>")) {
              issues.push(trimmed.slice(0, 200))
            }
          }
        }
      } catch {
        // bandit not installed — silent fallback
      }
    }

    return issues
  }
}

/**
 * Create a {@link ValidationNetwork} instance.
 *
 * @param args - Constructor arguments forwarded to {@link ValidationNetwork}.
 * @returns A new {@link ValidationNetwork}.
 */
export function createValidationNetwork(...args: ConstructorParameters<typeof ValidationNetwork>): ValidationNetwork {
  return new ValidationNetwork(...args)
}
