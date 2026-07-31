/**
 * Heuristic step scoring functions for PRM.
 * @module process-reward/scoring
 */

import type {
  CodeHeuristicOptions,
  GenerateFn,
  HeuristicConfig,
  LogicHeuristicOptions,
  MathHeuristicOptions,
  TaskType,
  VerifyFn,
} from "./types"
import { DEFAULT_CODE_OPTIONS, DEFAULT_LOGIC_OPTIONS, DEFAULT_MATH_OPTIONS } from "./types"

/** Compute confidence in MC rollout label based on number of rollouts. */
export function rolloutConfidence(numRollouts: number): number {
  if (numRollouts <= 0) return 0
  return 1 - 1 / Math.sqrt(numRollouts + 1)
}

export function scoreMathStep(
  step: string,
  previousStep: string | null,
  options: MathHeuristicOptions = DEFAULT_MATH_OPTIONS,
): number {
  let score = 0.5
  const eqMatches = step.match(/[+-]?\s*\d+(?:\.\d+)?\s*=\s*[+-]?\s*\d+(?:\.\d+)?/g)
  if (eqMatches && eqMatches.length >= 2) score += options.equationWeight * 1.5
  if (/[+\-*/=]/.test(step)) score += options.equationWeight
  if (/\blet\s+\w+\s*=|\w+\s*←|\w+\s*:=\s*\d/.test(step) || /\b\w+\s*=\s*[-]?\d+(?:\.\d+)?\s*[+\-*/]\s*\d/.test(step))
    score += options.equationWeight * 0.8
  if (
    /\b(substitute|plug|replace)\b/i.test(step) ||
    /\bsince\s+\w+\s*=\s*\d+(?:\.\d+)?/i.test(step) ||
    /\w+\s*=\s*\d+(?:\.\d+)?\s*,\s*(?:so|thus|therefore|then)\b/.test(step)
  )
    score += options.coherenceWeight * 1.2
  if (previousStep) {
    const prevNums: string[] = previousStep.match(/\d+(?:\.\d+)?/g) ?? []
    const currNums: string[] = step.match(/\d+(?:\.\d+)?/g) ?? []
    const overlapSet = new Set(prevNums)
    const overlap = currNums.filter((n) => overlapSet.has(n)).length
    if (overlap > 0) score += options.coherenceWeight * Math.min(1, overlap / Math.max(prevNums.length, 1))
    if (prevNums.length > 0 && currNums.length > 0) {
      const prevMag = prevNums.map((n) => Math.log10(Math.abs(Number.parseFloat(n)) + 1e-9))
      const currMag = currNums.map((n) => Math.log10(Math.abs(Number.parseFloat(n)) + 1e-9))
      const avgPrev = prevMag.reduce((a, b) => a + b, 0) / prevMag.length
      const avgCurr = currMag.reduce((a, b) => a + b, 0) / currMag.length
      const md = Math.abs(avgCurr - avgPrev)
      if (md > 3) score -= options.errorPenalty * 0.5
      else if (md < 1) score += options.coherenceWeight * 0.5
    }
  }
  if (/\/\s*0\b|division\s+by\s+zero|÷\s*0/i.test(step)) score -= options.errorPenalty
  if (/\bNaN\b|\bundefined\b|∅|\bInfinity\b|∞/.test(step)) score -= options.errorPenalty * 0.7
  return Math.max(0, Math.min(1, score))
}

export function scoreCodeStep(
  step: string,
  _previousStep: string | null,
  options: CodeHeuristicOptions = DEFAULT_CODE_OPTIONS,
): number {
  let score = 0.5
  const structural = [
    /\b(def|class|function|const|let|var|import|export|from|return)\b/,
    /\b(if|elif|else|for|while|switch|case)\b/,
    /\b(try|catch|finally|throw|raise)\b/,
    /\b(async|await|Promise|yield)\b/,
    /\b(type|interface|enum|implements|extends)\b/,
  ]
  const hits = structural.filter((p) => p.test(step)).length
  score += (options.patternWeight * Math.min(hits, 4)) / 4
  const errors = [/:$/m, /\belsif\b/i, /\)\s*{/, /\bprint\b.*\bprintf\b/i]
  let pen = 0
  for (const e of errors) if (e.test(step)) pen++
  if (pen > 0) score -= options.syntaxPenalty * Math.min(1, pen * 0.5)
  const dangerous = [
    /\bos\.system\b/i,
    /\bsubprocess\b/i,
    /\bexec\s*\(/i,
    /\beval\s*\(/i,
    /\brm\s+-rf\b/,
    /\bshutil\.rmtree\b/i,
    /\bos\.remove\b/i,
    /\bimport\s+ctypes\b/i,
    /\b__import__\s*\(/,
    /\bsocket\b/i,
  ]
  const dHits = dangerous.filter((p) => p.test(step)).length
  if (dHits > 0) score -= options.syntaxPenalty * Math.min(1, dHits * 0.4)
  const lines = step.split("\n").filter((l) => l.trim().length > 0)
  if (lines.length > 1) {
    const indents = lines.map((l) => (l.match(/^(\s*)/)?.[1] ?? "").length)
    if (new Set(indents).size <= 3) score += options.indentWeight
  }
  return Math.max(0, Math.min(1, score))
}

export function scoreLogicStep(
  step: string,
  previousStep: string | null,
  options: LogicHeuristicOptions = DEFAULT_LOGIC_OPTIONS,
): number {
  let score = 0.5
  if (/\b(assume|let|given|suppose|consider|by\s+definition)\b/i.test(step)) score += options.premiseWeight
  if (/[→⇒⟹∨∧¬∀∃⊢⊨]/.test(step) || /\bimplies\b|\band\s+also\b|\bsuch\s+that\b/i.test(step))
    score += options.premiseWeight * 0.8
  if (/\b(contrary|opposite|negation|for\s+contradiction|suppose\s+not)\b/i.test(step))
    score += options.conclusionWeight * 1.2
  if (/\b(therefore|thus|hence|so|consequently|it\s+follows)\b/i.test(step) || /\bQ\.?E\.?D\.?\b/i.test(step))
    score += options.conclusionWeight
  if (/\bcontradiction\b|\bimpossible\b|\bcan'?t\s+be\b/.test(step.toLowerCase())) {
    if (/\bderiv(?:e|ing)\s+contradiction|for\s+contradiction|proof\s+by\s+contradiction/i.test(step.toLowerCase()))
      score += options.conclusionWeight * 0.5
    else score -= options.contradictionPenalty * 0.3
  }
  if (
    previousStep &&
    /\b(assume|let|given|suppose|consider)\b/i.test(previousStep) &&
    /\b(therefore|thus|this\s+means|it\s+follows|hence|so|consequently)\b/i.test(step)
  )
    score += options.conclusionWeight
  return Math.max(0, Math.min(1, score))
}

export function scoreGeneralStep(step: string, _previousStep: string | null): number {
  let score = 0.5
  if (step.trim().length > 10) score += 0.1
  if (step.includes("\n")) score += 0.05
  if (/^[A-Z]/.test(step)) score += 0.05
  if (step.trim().length < 3) score -= 0.3
  if (/^(yes|no|ok|i\s+think|maybe)$/i.test(step.trim())) score -= 0.2
  return Math.max(0, Math.min(1, score))
}

export function heuristicScore(
  step: string,
  previousStep: string | null,
  taskType: TaskType,
  config?: HeuristicConfig,
): number {
  switch (taskType) {
    case "math":
      return scoreMathStep(step, previousStep, { ...DEFAULT_MATH_OPTIONS, ...config?.math })
    case "code":
      return scoreCodeStep(step, previousStep, { ...DEFAULT_CODE_OPTIONS, ...config?.code })
    case "logic":
      return scoreLogicStep(step, previousStep, { ...DEFAULT_LOGIC_OPTIONS, ...config?.logic })
    default:
      return scoreGeneralStep(step, previousStep)
  }
}

export function weakSupervisionLabel(heuristicScore: number, outcome: boolean): number {
  return 0.7 * heuristicScore + 0.3 * (outcome ? 0.9 : 0.15)
}

export async function mcRolloutLabel(
  steps: string[],
  stepIndex: number,
  referenceAnswer: string,
  generateFn: GenerateFn,
  verifyFn: VerifyFn,
  numRollouts: number,
): Promise<{ label: number; confidence: number }> {
  const state = steps.slice(0, stepIndex).join("\n") || "Start"
  const completions = await generateFn(state, numRollouts)
  let successCount = 0
  for (const completion of completions) {
    const fullPath = [...steps.slice(0, stepIndex + 1), completion].join("\n")
    if (await verifyFn(fullPath, referenceAnswer)) successCount++
  }
  const label = numRollouts > 0 ? successCount / numRollouts : 0.5
  return { label, confidence: rolloutConfidence(numRollouts) }
}
