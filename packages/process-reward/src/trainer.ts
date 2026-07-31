/**
 * PRMTrainer — confidence-weighted MSE training for PRM.
 * @module process-reward/trainer
 */

import type { TaskType, TrainingConfig, TrainingSample } from "./types"
import { DEFAULT_TRAINING_CONFIG } from "./types"

// ═══════════════════════════════════════════════════════════════════════════
// HeuristicStepScorer (from prm-trainer — alternative scoring engine)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * HeuristicStepScorer: alternative domain-aware step scorer with
 * equation verification, variable extraction, and numeric plausibility checks.
 *
 * More sophisticated than the simple heuristicScore() in scoring.ts —
 * register this via `prm.registerScorer("math", scorer.scoreStep)` for
 * advanced math evaluation.
 */
export class HeuristicStepScorer {
  scoreStep(stepText: string, previousStep: string | null, taskType: TaskType): number {
    if (!stepText || stepText.trim().length === 0) return 0.0
    const step = stepText.trim()
    switch (taskType) {
      case "math":
        return this.scoreMath(step, previousStep)
      case "code":
        return this.scoreCode(step, previousStep)
      case "logic":
        return this.scoreLogic(step, previousStep)
      default:
        return 0.5
    }
  }

  private scoreMath(step: string, prev: string | null): number {
    if (!step || step.trim().length === 0) return 0.0
    let score = 0.5

    if (/[=\u2248\u2260\u2264\u2265]/.test(step)) score += 0.1

    const divByZeroRegex = /\b(?:1|0)\s*\/\s*0\b|\b[a-zA-Z_]\w*\s*\/\s*0\b|\/\s*\(\s*0\s*\)/
    if (divByZeroRegex.test(step)) score -= 0.4

    const nanRegex = /\bNaN\b|\bInfinity\b|0\s*\/\s*0(?!\w)/
    if (nanRegex.test(step)) score -= 0.3

    const eqResult = this.verifyEquation(step)
    if (eqResult !== null) score += eqResult * 0.1

    if (prev) {
      const chainScore = this.checkEquationChain(step, prev)
      score += chainScore * 0.1

      const backSubScore = this.checkBackSubstitution(step, prev)
      score += backSubScore * 0.1
    }

    const varsInStep = this.extractVariables(step)
    if (prev) {
      const varsInPrev = this.extractVariables(prev)
      if (varsInStep.size > 0 && varsInPrev.size > 0) {
        const overlap = new Set([...varsInStep].filter((v) => varsInPrev.has(v)))
        if (overlap.size >= Math.min(varsInStep.size, varsInPrev.size) * 0.5) {
          score += 0.1
        }
      }
    }

    if (prev) {
      const prevNums = this.extractNumbers(prev)
      const stepNums = this.extractNumbers(step)
      if (prevNums.size > 0 && stepNums.size > 0) {
        const numCoherence = this.checkNumericPlausibility(prevNums, stepNums)
        score += numCoherence * 0.05
      }
    }

    if (/\b(?:m|cm|mm|km|g|kg|s|min|h|m\/s|km\/h|N|J|W|Pa|Hz)\b/.test(step)) {
      score += 0.05
    }

    const structuralScore = this.checkMathStructuralQuality(step)
    score += structuralScore * 0.05

    if (/error|mistake|wrong|incorrect|oops/i.test(step)) score -= 0.15

    return Math.max(0, Math.min(1, score))
  }

  private scoreCode(step: string, prev: string | null): number {
    if (!step || step.trim().length === 0) return 0.0
    let score = 0.5

    const classDef = /\bclass\s+[A-Z]\w*/.test(step)
    const funcDef = /\b(?:def|function|fn)\s+\w+\s*\(/.test(step)
    const arrowFunc = /(?:const|let|var)\s+\w+\s*=\s*(?:\([^)]*\)\s*=>|function)/.test(step)
    if (classDef || funcDef || arrowFunc) score += 0.15

    const hasStructureKeywords = /\b(?:for|while|do|if|else|switch|case|try|catch|finally|return|yield|await)\b/.test(
      step,
    )
    if (hasStructureKeywords) score += 0.1

    const hasImport = /\bimport\s+\{?\s*\w+|\brequire\s*\(?\s*["']/.test(step)
    if (hasImport) {
      if (/\b(?:os|sys|subprocess|child_process|shell)\b/.test(step)) {
        score -= 0.3
      } else if (/\b(?:fs|path|http|express|react|axios|lodash|math|json)\b/.test(step)) {
        score += 0.05
      }
    }

    const syntaxErrorKeywords =
      /\bundefined variable\b|\bunexpected token\b|\bmissing\s+\w+\b|\bsyntax error\b|\btype error\b|\breference error\b|\bcannot read property\b|\bis not defined\b|\bis not a function\b/i
    if (syntaxErrorKeywords.test(step)) score -= 0.3

    const bracketPairs = this.countBracketBalance(step)
    if (bracketPairs === 0) score += 0.05

    const indentConsistency = this.checkIndentationConsistency(step)
    if (indentConsistency) score += 0.05

    if (prev) {
      const hasPrevBrackets = /[{}()]/.test(prev)
      const hasCurrBrackets = /[{}()]/.test(step)
      if (hasPrevBrackets && hasCurrBrackets) score += 0.05
    }

    const hasComment = /\/\/|#/.test(step)
    if (hasComment) score += 0.02

    return Math.max(0, Math.min(1, score))
  }

  private scoreLogic(step: string, prev: string | null): number {
    if (!step || step.trim().length === 0) return 0.0
    let score = 0.5

    const premiseKeywords = /\b(?:premise|assume|given|suppose|let|axiom|postulate)\b/i
    const conclusionKeywords = /\b(?:therefore|hence|thus|consequently|accordingly|so|implies|entails)\b/i
    if (premiseKeywords.test(step)) score += 0.15
    if (conclusionKeywords.test(step)) score += 0.15

    const contradictionMarkers =
      /\b(?:contradiction|paradox|inconsistent|impossible|absurd|however|but|yet|nevertheless)\b/i
    if (contradictionMarkers.test(step)) {
      const hasContradiction = this.detectContradiction(step)
      if (hasContradiction) score -= 0.2
    }

    const structureMarkers =
      /\b(?:if\s+.*\s+then|implies|entails|leads to|results in|follows from|is equivalent to|if and only if)\b/i
    if (structureMarkers.test(step)) score += 0.1

    if (prev) {
      const prevWords = new Set(prev.toLowerCase().match(/\b[a-z]{4,}\b/g) || [])
      const stepWords = new Set(step.toLowerCase().match(/\b[a-z]{4,}\b/g) || [])
      const overlap = new Set([...prevWords].filter((w) => stepWords.has(w)))
      if (overlap.size >= Math.min(prevWords.size, stepWords.size) * 0.4) {
        score += 0.1
      }
    }

    const logicalConnectors = /\b(?:and|or|not|all|some|none|every|exists|forall|∃|∀|∧|∨|¬|→|↔)\b/i
    if (logicalConnectors.test(step)) score += 0.05

    const formalNotation = /\b(?:P|Q|R)\s*\(/.test(step)
    if (formalNotation) score += 0.1

    const verboseError = /unclear|vague|ambiguous|fallacy|invalid|unsound/i.test(step)
    if (verboseError) score -= 0.15

    if (step.length < 10 && step.length > 0) score -= 0.1

    return Math.max(0, Math.min(1, score))
  }

  private verifyEquation(step: string): number | null {
    const eqRegex = /([^=]+)=\s*([^=;,\n]+)/g
    let matches = 0
    let plausible = 0
    for (const eqMatch of step.matchAll(eqRegex)) {
      matches++
      const left = eqMatch[1]!.trim()
      const right = eqMatch[2]!.trim()

      if (/[a-zA-Z]/.test(left) || /[a-zA-Z]/.test(right)) {
        plausible += 0.5
        continue
      }

      try {
        const leftVal = this.safeEval(left)
        const rightVal = this.safeEval(right)
        if (leftVal !== null && rightVal !== null && Math.abs(leftVal - rightVal) < 1e-6) {
          plausible++
        }
      } catch {
        plausible += 0.3
      }
    }

    if (matches === 0) return null
    return plausible / matches
  }

  private safeEval(expr: string): number | null {
    const sanitized = expr.replace(/[^0-9+\-*/().\s]/g, "")
    if (sanitized.length === 0) return null
    try {
      const result = new Function(`return (${sanitized})`)()
      if (typeof result === "number" && Number.isFinite(result)) return result
    } catch {
      return null
    }
    return null
  }

  private extractVariables(text: string): Set<string> {
    const matches = text.match(/\b[a-zA-Z_]\w*\b/g) || []
    const keywords = new Set([
      "NaN",
      "Infinity",
      "true",
      "false",
      "null",
      "undefined",
      "if",
      "else",
      "for",
      "while",
      "do",
      "return",
      "function",
      "class",
      "import",
      "export",
      "const",
      "let",
      "var",
      "typeof",
      "instanceof",
      "new",
      "this",
      "super",
      "then",
      "function",
      "let",
      "suppose",
      "premise",
      "given",
      "assume",
      "therefore",
      "hence",
      "thus",
      "implies",
      "entails",
      "from",
      "to",
    ])
    return new Set(matches.filter((m) => !keywords.has(m) && m.length >= 1 && /[a-zA-Z]/.test(m)))
  }

  private extractNumbers(text: string): Set<number> {
    const matches = text.match(/-?\d+(?:\.\d+)?/g) || []
    return new Set(matches.map(Number).filter((n) => Number.isFinite(n)))
  }

  private checkEquationChain(step: string, prev: string | null): number {
    if (!prev) return 0.5
    const prevVars = this.extractVariables(prev)
    const stepVars = this.extractVariables(step)
    if (prevVars.size === 0 || stepVars.size === 0) return 0.0
    const overlap = new Set([...prevVars].filter((v) => stepVars.has(v)))
    const minSize = Math.min(prevVars.size, stepVars.size)
    if (minSize === 0) return 0.0
    return Math.min(1, overlap.size / minSize)
  }

  private checkBackSubstitution(step: string, prev: string | null): number {
    if (!prev) return 0.0
    const solvePattern = /\b([a-zA-Z_]\w*)\s*=\s*(.+)/i
    const prevMatch = prev.match(solvePattern)
    if (!prevMatch) return 0.0
    const solvedVar = prevMatch[1]!.trim()
    const solvedExpr = prevMatch[2]!.trim()
    const stepHasVar = new RegExp(`\\b${solvedVar}\\b`).test(step)
    const stepHasExpr = step.includes(solvedExpr)
    if (stepHasVar) return 0.5
    if (stepHasExpr) return 0.8
    return 0.0
  }

  private checkNumericPlausibility(prevNums: Set<number>, stepNums: Set<number>): number {
    const prevArr = [...prevNums].filter((n) => Number.isFinite(n) && n !== 0)
    const stepArr = [...stepNums].filter((n) => Number.isFinite(n) && n !== 0)
    if (prevArr.length === 0 || stepArr.length === 0) return 0.5
    for (const pn of prevArr) {
      for (const sn of stepArr) {
        if (Math.abs(pn - sn) < 1e-6) return 1.0
        if (pn !== 0 && Math.abs((sn - pn) / pn) < 2.0) return 0.6
      }
    }
    return 0.3
  }

  private checkMathStructuralQuality(step: string): number {
    let quality = 0.5
    if (/^[\s]*[a-zA-Z_]\w*\s*=/.test(step)) quality += 0.2
    if (/\b(?:therefore|hence|thus|so|because)\b/i.test(step)) quality += 0.1
    const lineCount = step.split("\n").filter((l) => l.trim().length > 0).length
    if (lineCount > 1) quality += 0.1
    if (step.length < 5 && step.length > 0) quality -= 0.3
    if (/\b(?:sqrt|sin|cos|tan|log|ln|exp|∑|∏|∫|lim|π|∞)\b/.test(step)) quality += 0.1
    return Math.max(0, Math.min(1, quality))
  }

  private detectContradiction(step: string): boolean {
    const lower = step.toLowerCase()
    const strongPatterns = [
      /\btrue\b.*\bfalse\b/i,
      /\bfalse\b.*\btrue\b/i,
      /\bP\b.*\bnot P\b|\bnot P\b.*\bP\b/i,
      /\bcorrect\b.*\bincorrect\b/i,
      /\bvalid\b.*\binvalid\b/i,
      /\bpossible\b.*\bimpossible\b/i,
      /\bconsistent\b.*\binconsistent\b/i,
      /\bsound\b.*\bunsound\b/i,
    ]
    return strongPatterns.some((p) => p.test(lower))
  }

  private countBracketBalance(text: string): number {
    let brace = 0
    let paren = 0
    let bracket = 0
    for (const ch of text) {
      if (ch === "{") brace++
      if (ch === "}") brace--
      if (ch === "(") paren++
      if (ch === ")") paren--
      if (ch === "[") bracket++
      if (ch === "]") bracket--
    }
    if (brace === 0 && paren === 0 && bracket === 0) return 0
    if (Math.abs(brace) <= 1 && Math.abs(paren) <= 1 && Math.abs(bracket) <= 1) return 1
    return 2
  }

  private checkIndentationConsistency(text: string): boolean {
    const lines = text.split("\n").filter((l) => l.trim().length > 0)
    if (lines.length <= 1) return true
    const indentPatterns = lines.map((l) => {
      const match = l.match(/^(\s*)/)
      return match ? match[1]!.length : 0
    })
    const first = indentPatterns[0]!
    for (let i = 1; i < indentPatterns.length; i++) {
      const diff = Math.abs(indentPatterns[i]! - first)
      if (diff > first * 2 && diff > 4) return false
    }
    return true
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PRMTrainer
// ═══════════════════════════════════════════════════════════════════════════

/**
 * PRMTrainer: confidence-weighted MSE training for process reward models.
 *
 * Features:
 * - Weighted MSE loss with confidence-based sample weighting
 * - Multiple LR schedules: constant, cosine, linear_decay
 * - Warmup steps for gradual learning rate ramp-up
 * - Early stopping with patience-based convergence detection
 */
export class PRMTrainer {
  config: TrainingConfig

  constructor(config?: Partial<TrainingConfig>) {
    this.config = { ...DEFAULT_TRAINING_CONFIG, ...config }
  }

  computeLoss(predictions: number[], labels: number[], confidences: number[]): number {
    const n = Math.min(predictions.length, labels.length, confidences.length)
    if (n === 0) return 0

    let totalWeightedError = 0
    let totalWeight = 0

    for (let i = 0; i < n; i++) {
      const w = confidences[i]!
      const diff = predictions[i]! - labels[i]!
      totalWeightedError += w * diff * diff
      totalWeight += w
    }

    if (totalWeight === 0) return 0
    return totalWeightedError / totalWeight
  }

  train(
    samples: TrainingSample[],
    onEpoch?: (epoch: number, loss: number) => void,
  ): { history: number[]; finalLoss: number } {
    const { numEpochs, batchSize, learningRate, earlyStopPatience, warmupSteps, lrSchedule } = this.config

    const totalSteps = numEpochs * Math.ceil(samples.length / batchSize)
    const history: number[] = []
    const predictions: number[] = samples.map((s) => s.label * 0.5 + 0.25)
    let bestLoss = Number.POSITIVE_INFINITY
    let patienceCounter = 0
    let globalStep = 0

    for (let epoch = 0; epoch < numEpochs; epoch++) {
      const indices = this.shuffleIndices(samples.length)

      for (let b = 0; b < samples.length; b += batchSize) {
        const batchIndices = indices.slice(b, b + batchSize)

        let lr = learningRate
        if (globalStep < warmupSteps) {
          lr = learningRate * ((globalStep + 1) / warmupSteps)
        } else if (lrSchedule === "cosine") {
          lr = this.cosineLR(globalStep, totalSteps, learningRate)
        } else if (lrSchedule === "linear_decay") {
          lr = this.linearDecayLR(globalStep, totalSteps, learningRate)
        }

        for (const bi of batchIndices) {
          const grad = predictions[bi]! - samples[bi]!.label
          predictions[bi] = predictions[bi]! - lr * grad * samples[bi]!.confidence
          predictions[bi] = Math.max(0, Math.min(1, predictions[bi]!))
        }

        globalStep++
      }

      const labels = samples.map((s) => s.label)
      const confs = samples.map((s) => s.confidence)
      const loss = this.computeLoss(predictions, labels, confs)
      history.push(loss)

      if (onEpoch) onEpoch(epoch, loss)

      if (loss < bestLoss - 1e-8) {
        bestLoss = loss
        patienceCounter = 0
      } else {
        patienceCounter++
      }

      if (earlyStopPatience > 0 && patienceCounter >= earlyStopPatience) {
        break
      }
    }

    return {
      history,
      finalLoss: history.length > 0 ? history[history.length - 1]! : 0,
    }
  }

  validate(samples: TrainingSample[]): number {
    if (samples.length === 0) return 0

    const labels = samples.map((s) => s.label)
    const confs = samples.map((s) => s.confidence)

    let totalWeightedError = 0
    let totalWeight = 0

    for (let i = 0; i < samples.length; i++) {
      const pred = samples[i]!.label * 0.5 + 0.25
      const w = confs[i]!
      const diff = pred - labels[i]!
      totalWeightedError += w * diff * diff
      totalWeight += w
    }

    if (totalWeight === 0) return 0
    return totalWeightedError / totalWeight
  }

  private cosineLR(currentStep: number, totalSteps: number, baseLR: number): number {
    if (totalSteps <= 0) return baseLR
    const progress = currentStep / totalSteps
    return baseLR * 0.5 * (1 + Math.cos(Math.PI * progress))
  }

  private linearDecayLR(currentStep: number, totalSteps: number, baseLR: number): number {
    if (totalSteps <= 0) return baseLR
    const progress = currentStep / totalSteps
    return baseLR * (1 - progress)
  }

  private shuffleIndices(n: number): number[] {
    const arr = Array.from({ length: n }, (_, i) => i)
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const temp = arr[i]!
      arr[i] = arr[j]!
      arr[j] = temp
    }
    return arr
  }
}

/**
 * Create a {@link PRMTrainer} instance.
 *
 * @param args - Constructor arguments forwarded to {@link PRMTrainer}.
 * @returns A new {@link PRMTrainer}.
 */
export function createPRMTrainer(...args: ConstructorParameters<typeof PRMTrainer>): PRMTrainer {
  return new PRMTrainer(...args)
}
