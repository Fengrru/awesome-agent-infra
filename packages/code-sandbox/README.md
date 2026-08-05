# @fengrru/code-sandbox

[![npm version](https://img.shields.io/npm/v/@fengrru/code-sandbox)](https://www.npmjs.com/package/@fengrru/code-sandbox) [![npm downloads](https://img.shields.io/npm/dm/@fengrru/code-sandbox)](https://www.npmjs.com/package/@fengrru/code-sandbox) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)

Secure code execution sandbox with math, code, and logic verification.

Zero dependencies. Uses Node.js `child_process` for subprocess isolation.

## Features

- **SecureExecutor** — Execute code in an isolated subprocess with timeout and memory limits
- **MathVerifier** — Robust number extraction (GSM8K format, fractions, floats) with tolerance-based comparison
- **CodeVerifier** — Execute code and check output in pass/stdout/assert modes
- **LogicVerifier** — Jaccard similarity, contradiction detection, premise-conclusion structure
- **VerifierPool** — Registry pattern with pre-registered math/code/logic verifiers and fallback

## Usage

```typescript
import {
  SecureExecutor,
  MathVerifier,
  CodeVerifier,
  LogicVerifier,
  VerifierPool,
} from "@fengrru/code-sandbox"

// ── SecureExecutor ────────────────────────────────────────
const executor = new SecureExecutor({ timeoutMs: 5000 })
const result = await executor.execute('console.log("hello")')
console.log(result.stdout) // "hello\n"

// ── MathVerifier ──────────────────────────────────────────
const mathVerifier = new MathVerifier(1e-5)
const mathResult = mathVerifier.verify("The answer is 42", "#### 42")
console.log(mathResult.verified) // true

// ── CodeVerifier ──────────────────────────────────────────
const codeVerifier = new CodeVerifier()
const codeResult = await codeVerifier.verify(
  "console.log(1 + 1)",
  "2",
  "stdout"
)
console.log(codeResult.verified) // true

// ── LogicVerifier ─────────────────────────────────────────
const logicVerifier = new LogicVerifier()
const logicResult = logicVerifier.verify(
  "If it rains, then the ground is wet. Therefore, the ground is wet.",
  "The ground is wet because it is raining."
)
console.log(logicResult.verified) // true

// ── VerifierPool ──────────────────────────────────────────
const pool = new VerifierPool()
const poolResult = await pool.verify("math", "x = 3.14", "3.14")
console.log(poolResult.verified) // true

// Custom verifier registration
pool.registerVerifier("custom", (text, ref) => ({
  verified: text.includes(ref),
  method: "custom",
  errorMessage: "",
  metadata: {},
}))
```

## API

### SecureExecutor

```typescript
new SecureExecutor(config?: Partial<SandboxConfig>)
executor.execute(code: string, stdin?: string): Promise<ExecutionResult>
```

### MathVerifier

```typescript
new MathVerifier(tolerance?: number)
mathVerifier.verify(generatedText: string, referenceAnswer: string): VerificationResult
mathVerifier.extractNumber(text: string): number | null
```

### CodeVerifier

```typescript
new CodeVerifier(timeout?: number, memoryLimitMb?: number)
codeVerifier.verify(generatedCode: string, expectedOutput: string, mode?: "stdout" | "pass" | "assert"): Promise<VerificationResult>
```

### LogicVerifier

```typescript
new LogicVerifier()
logicVerifier.verify(generated: string, reference: string): VerificationResult
```

### VerifierPool

```typescript
new VerifierPool()
pool.registerVerifier(taskType: string, verifier: (text: string, ref: string) => VerificationResult | Promise<VerificationResult>): void
pool.verify(taskType: string, generated: string, reference: string): Promise<VerificationResult>
pool.getRegisteredTypes(): string[]
```
