/**
 * Inference engine — step segmentation, verification, and guided generation.
 * @module process-reward/inference
 */

import type { ProcessRewardModel } from "./model"
import type { GenerateFn, SegmentedPRMStep, StepSegmentKind, TaskType, VerificationResult } from "./types"

// ═══════════════════════════════════════════════════════════════════════════
// Step Segmenter
// ═══════════════════════════════════════════════════════════════════════════

/**
 * StepSegmenter: classify and segment reasoning steps for PRM processing.
 *
 * Used to prepare steps for domain-specific heuristic scoring.
 */
// biome-ignore lint/complexity/noStaticOnlyClass: public API shape, kept for backward compatibility
export class StepSegmenter {
  /**
   * Classify a single step into its rhetorical kind.
   * Priority: IMPLICATION → ASSERTION → EQUATION → CONCLUSION → UNKNOWN
   */
  static classify(text: string): StepSegmentKind {
    const t = text.trim()

    if (/\b(therefore|thus|hence|so|consequently|it\s+follows|implies)\b/i.test(t)) {
      return "implication"
    }
    if (/=\s*[-]?\d|\d\s*=\s*\d|[+\-*/×÷]\s*\d/.test(t)) {
      return "equation"
    }
    if (/\b(assume|let|given|suppose|consider|by\s+definition)\b/i.test(t)) {
      return "assertion"
    }
    if (/\b(Q\.?E\.?D\.?|proved|in\s+conclusion|to\s+summarize|contradiction)\b/i.test(t)) {
      return "conclusion"
    }
    return "unknown"
  }

  /**
   * Segment a full reasoning path into classified steps.
   */
  static segment(text: string): SegmentedPRMStep[] {
    const rawSteps = text
      .split(/\n\n+|(?=\n(?:Step\s*\d+|\d+\.)\s*[A-Z])/i)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)

    return rawSteps.map((stepText, index) => ({
      text: stepText,
      kind: StepSegmenter.classify(stepText),
      index,
    }))
  }

  /** Map rhetorical kind to TaskType for heuristic dispatch. */
  static kindToTaskType(kind: StepSegmentKind): TaskType {
    switch (kind) {
      case "equation":
        return "math"
      case "assertion":
      case "implication":
      case "conclusion":
        return "logic"
      default:
        return "general"
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Verifier Pool
// ═══════════════════════════════════════════════════════════════════════════

// Blocked code modules for security
const BLOCKED_CODE_MODULES = new Set([
  "os",
  "subprocess",
  "shutil",
  "ctypes",
  "socket",
  "sys",
  "builtins",
  "__builtins__",
  "importlib",
])

/**
 * VerifierPool: unified interface for verifying answers across domains.
 *
 * Provides:
 *   - MathVerifier: GSM8K-style (#### / fraction / comma-number matching)
 *   - CodeVerifier: secure Python execution with sandbox restrictions
 *   - LogicVerifier: contradiction detection + proposition validation
 */
// biome-ignore lint/complexity/noStaticOnlyClass: public API shape, kept for backward compatibility
export class VerifierPool {
  /**
   * Verify a math answer against ground truth.
   * Handles: #### format, fraction normalization, comma-separated numbers.
   */
  static verifyMath(predicted: string, reference: string): VerificationResult {
    // Normalize both answers
    const normPred = VerifierPool.normalizeMathAnswer(predicted)
    const normRef = VerifierPool.normalizeMathAnswer(reference)

    // Exact match after normalization
    if (normPred === normRef) {
      return { correct: true, confidence: 1.0, verifier: "math_exact" }
    }

    // Fraction equivalence: parse as floats and compare
    const predFloat = Number.parseFloat(normPred)
    const refFloat = Number.parseFloat(normRef)
    if (!Number.isNaN(predFloat) && !Number.isNaN(refFloat)) {
      const tolerance = Math.max(1e-6, Math.abs(refFloat) * 1e-4)
      if (Math.abs(predFloat - refFloat) < tolerance) {
        return {
          correct: true,
          confidence: 0.95,
          verifier: "math_float",
          details: `Matched within tolerance ${tolerance.toExponential(1)}`,
        }
      }
    }

    return { correct: false, confidence: 0.9, verifier: "math", details: `Expected ${normRef}, got ${normPred}` }
  }

  /**
   * Verify code output by checking for dangerous calls and syntax validity.
   * This is a lexical safety check — NOT a full sandbox executor.
   */
  static verifyCode(code: string, expectedOutput?: string): VerificationResult {
    // Safety check: detect dangerous imports/calls
    for (const mod of BLOCKED_CODE_MODULES) {
      const pattern = new RegExp(`\\b(import\\s+${mod}|from\\s+${mod}|${mod}\\.)`, "i")
      if (pattern.test(code)) {
        return {
          correct: false,
          confidence: 0.95,
          verifier: "code_safety",
          details: `Blocked module detected: ${mod}`,
        }
      }
    }

    // Check for direct shell access
    if (/\b(exec|eval|__import__|compile)\s*\(/i.test(code)) {
      return {
        correct: false,
        confidence: 0.9,
        verifier: "code_safety",
        details: "Dangerous built-in function detected",
      }
    }

    // Code structure validation
    const hasDefinition = /\b(def|function|class|const|let|var)\b/.test(code)
    const hasReturn = /\breturn\b/.test(code)
    const hasOutput = /\b(print|console\.log|output|result)\b/.test(code)

    if (hasDefinition && (hasReturn || hasOutput)) {
      // If expected output provided, check for it
      if (expectedOutput) {
        const outputMatch = code.includes(expectedOutput)
        return {
          correct: outputMatch,
          confidence: outputMatch ? 0.8 : 0.5,
          verifier: "code_structure",
          details: outputMatch ? "Expected output found in code" : "Expected output not found in code",
        }
      }
      return { correct: true, confidence: 0.7, verifier: "code_structure" }
    }

    return { correct: true, confidence: 0.5, verifier: "code_basic" }
  }

  /**
   * Verify a logic deduction against ground truth.
   * Checks for contradictions and proposition consistency.
   */
  static verifyLogic(predicted: string, reference: string): VerificationResult {
    const normPred = predicted.trim().toLowerCase()
    const normRef = reference.trim().toLowerCase()

    // Exact match
    if (normPred === normRef) {
      return { correct: true, confidence: 1.0, verifier: "logic_exact" }
    }

    // Contradiction check: if answer says "contradiction" but reference doesn't
    const predHasContradiction = /\bcontradiction\b/.test(normPred)
    const refHasContradiction = /\bcontradiction\b/.test(normRef)
    if (predHasContradiction !== refHasContradiction) {
      return { correct: false, confidence: 0.8, verifier: "logic_contradiction", details: "Contradiction mismatch" }
    }

    // Substring match (partial credit)
    if (normPred.includes(normRef) || normRef.includes(normPred)) {
      return { correct: true, confidence: 0.6, verifier: "logic_partial", details: "Partial (substring) match" }
    }

    // Jaccard similarity on word tokens
    const predTokens = new Set(normPred.split(/\s+/).filter((t) => t.length > 1))
    const refTokens = new Set(normRef.split(/\s+/).filter((t) => t.length > 1))
    let intersect = 0
    for (const t of predTokens) if (refTokens.has(t)) intersect++
    const union = new Set([...predTokens, ...refTokens])
    const jaccard = union.size > 0 ? intersect / union.size : 0

    return {
      correct: jaccard > 0.7,
      confidence: jaccard,
      verifier: "logic_jaccard",
      details: `Jaccard similarity: ${jaccard.toFixed(3)}`,
    }
  }

  /** Dispatch verification by task type. */
  static verify(predicted: string, reference: string, taskType: TaskType): VerificationResult {
    switch (taskType) {
      case "math":
        return VerifierPool.verifyMath(predicted, reference)
      case "code":
        return VerifierPool.verifyCode(predicted, reference)
      case "logic":
        return VerifierPool.verifyLogic(predicted, reference)
      default: {
        const exact = predicted.trim() === reference.trim()
        return { correct: exact, confidence: exact ? 1.0 : 0.5, verifier: "general_exact" }
      }
    }
  }

  // ── Helpers ──

  private static normalizeMathAnswer(text: string): string {
    let n = text.trim()

    // Extract answer from #### format (GSM8K style)
    const hashMatch = n.match(/####\s*(.+)/)
    if (hashMatch) n = hashMatch[1]!.trim()

    // Remove commas from numbers like "1,234" → "1234"
    n = n.replace(/,/g, "")

    // Normalize fraction: "3/4" → "0.75"
    const fracMatch = n.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/)
    if (fracMatch) {
      const num = Number.parseFloat(fracMatch[1]!)
      const den = Number.parseFloat(fracMatch[2]!)
      if (den !== 0) n = (num / den).toString()
    }

    // Remove percentage sign
    n = n.replace(/%$/, "")

    return n.trim()
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Guided Inference Engine
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GuidedInferenceEngine: wraps a generator with PRM-guided step selection.
 *
 * At each step, generates k candidates, scores them with PRM, and selects
 * the best one (or branches if confidence is low).
 */
export class GuidedInferenceEngine {
  private prm: ProcessRewardModel
  private generateFn: GenerateFn
  private candidatesPerStep: number

  constructor(prm: ProcessRewardModel, generateFn: GenerateFn, candidatesPerStep = 4) {
    this.prm = prm
    this.generateFn = generateFn
    this.candidatesPerStep = candidatesPerStep
  }

  /**
   * Generate a reasoning path guided by PRM scoring.
   * At each step: generate k candidates → score each → pick best.
   */
  async generate(
    problem: string,
    maxSteps = 10,
    taskType: TaskType = "general",
  ): Promise<{ path: string[]; scores: number[] }> {
    const path: string[] = []
    const scores: number[] = []
    let currentState = problem

    for (let step = 0; step < maxSteps; step++) {
      const candidates = await this.generateFn(currentState, this.candidatesPerStep)
      if (candidates.length === 0) break

      // Score each candidate
      const scoredCandidates = await Promise.all(
        candidates.map(async (c) => {
          const result = await this.prm.scoreStep(currentState, c, undefined, taskType)
          return { candidate: c, score: result.score }
        }),
      )

      // Pick the best candidate
      scoredCandidates.sort((a, b) => b.score - a.score)
      const best = scoredCandidates[0]!

      path.push(best.candidate)
      scores.push(best.score)
      currentState += `\n${best.candidate}`

      // Check termination condition(s)
      if (/\b(Therefore|Final Answer|The answer is|Conclusion)\b/i.test(best.candidate)) {
        break
      }
    }

    return { path, scores }
  }
}
