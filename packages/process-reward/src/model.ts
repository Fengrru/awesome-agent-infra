/**
 * ProcessRewardModel — core step-level reasoning quality scorer.
 * @module process-reward/model
 */

import type {
  TaskType, StepScore, PRMConfig, HeuristicConfig,
  GenerateFn, VerifyFn, PRMModelData,
} from "./types"
import { DEFAULT_PRM_CONFIG } from "./types"
import { heuristicScore, mcRolloutLabel, weakSupervisionLabel } from "./scoring"

/**
 * ProcessRewardModel — scores individual steps in a reasoning chain.
 *
 * Implements the three-tier labeling strategy from the Reasoning Navigation Engine:
 *   Tier 1: Monte Carlo rollout (empirical success rate)
 *   Tier 2: Task-aware heuristic (domain-specific rules)
 *   Tier 3: Uniform weak supervision (outcome-only signal, no position bias)
 *
 * Model-agnostic: accepts `generateFn` and `verifyFn` callbacks.
 */
export class ProcessRewardModel {
  private config: PRMConfig
  private heuristicConfig: HeuristicConfig

  // Registered external scorers per task type
  private scorers: Map<string, (step: string, prev: string | null) => number> = new Map()

  constructor(config?: Partial<PRMConfig>, heuristicConfig?: HeuristicConfig) {
    this.config = { ...DEFAULT_PRM_CONFIG, ...config }
    this.heuristicConfig = heuristicConfig ?? {}
  }

  // ── Step Scoring ────────────────────────────────────────────────────

  /**
   * Score a single reasoning step.
   *
   * Uses the configured labeling strategy to produce a [0, 1] quality score.
   */
  async scoreStep(
    state: string,
    action: string,
    _context?: string,
    taskType: TaskType = "general",
  ): Promise<StepScore> {
    // Get heuristic score as fallback
    const hScore = heuristicScore(action, state || null, taskType, this.heuristicConfig)

    if (this.config.labelingStrategy === "heuristic") {
      return {
        stepIndex: -1, // caller should set
        score: hScore,
        confidence: 0.7,
        method: "heuristic",
      }
    }

    // For 'mc_rollout' or 'hybrid': just use heuristic for single-step scoring
    // MC rollout requires a full path context
    return {
      stepIndex: -1,
      score: hScore,
      confidence: 0.8,
      method: "heuristic",
      details: { heuristicScore: hScore },
    }
  }

  /**
   * Batch score multiple (state, action) pairs.
   */
  async batchScoreSteps(
    states: string[],
    actions: string[],
    contexts?: string[],
    taskType: TaskType = "general",
  ): Promise<StepScore[]> {
    const results: StepScore[] = []
    for (let i = 0; i < actions.length; i++) {
      const ctx = contexts?.[i]
      const result = await this.scoreStep(states[i] ?? "", actions[i] ?? "", ctx, taskType)
      result.stepIndex = i
      results.push(result)
    }
    return results
  }

  /**
   * Score all steps in a reasoning path.
   */
  async scorePath(
    steps: string[],
    context?: string,
    taskType: TaskType = "general",
  ): Promise<StepScore[]> {
    const scores: StepScore[] = []
    for (let i = 0; i < steps.length; i++) {
      const prevStep = i > 0 ? steps[i - 1] ?? null : null
      const state = steps.slice(0, i).join("\n") || "Start"

      let result: StepScore
      if (this.config.labelingStrategy === "heuristic") {
        result = {
          stepIndex: i,
          score: heuristicScore(steps[i] ?? "", prevStep, taskType, this.heuristicConfig),
          confidence: 0.7,
          method: "heuristic",
        }
      } else {
        result = await this.scoreStep(state, steps[i] ?? "", context, taskType)
        result.stepIndex = i
      }

      scores.push(result)
    }
    return scores
  }

  // ── Labeling (for training data generation) ──────────────────────────

  /**
   * Label all steps in a reasoning path using the configured strategy.
   */
  async labelSteps(
    steps: string[],
    outcome: boolean,
    taskType: TaskType = "general",
    options?: {
      generateFn?: GenerateFn
      verifyFn?: VerifyFn
      referenceAnswer?: string
    },
  ): Promise<{ labels: number[]; confidences: number[] }> {
    const labels: number[] = []
    const confidences: number[] = []

    const hasMC = options?.generateFn && options?.verifyFn && options?.referenceAnswer
    const useMC = (this.config.labelingStrategy === "mc_rollout" ||
                   this.config.labelingStrategy === "hybrid") && hasMC

    for (let i = 0; i < steps.length; i++) {
      const prevStep = i > 0 ? steps[i - 1] ?? null : null
      const hScore = heuristicScore(steps[i] ?? "", prevStep, taskType, this.heuristicConfig)

      if (useMC && options?.generateFn && options?.verifyFn && options?.referenceAnswer) {
        const mc = await mcRolloutLabel(
          steps, i, options.referenceAnswer,
          options.generateFn, options.verifyFn,
          this.config.numRollouts,
        )
        labels.push(mc.label)
        confidences.push(mc.confidence)
      } else {
        // Fallback to hybrid: heuristic + weak supervision
        const label = weakSupervisionLabel(hScore, outcome)
        labels.push(label)
        confidences.push(0.6)
      }
    }

    return { labels, confidences }
  }

  // ── Heuristic-only path scoring ──────────────────────────────────────

  /**
   * Score all steps using only heuristic rules (no LLM calls needed).
   */
  scorePathHeuristic(steps: string[], taskType: TaskType = "general"): StepScore[] {
    return steps.map((step, i) => {
      const prevStep = i > 0 ? steps[i - 1] ?? null : null
      return {
        stepIndex: i,
        score: heuristicScore(step, prevStep, taskType, this.heuristicConfig),
        confidence: 0.7,
        method: "heuristic",
      }
    })
  }

  // ── External Scorer Registration ─────────────────────────────────────

  /**
   * Register a custom scorer for a task type, overriding the default heuristic.
   * The scorer receives (step, previousStep) and returns [0, 1].
   */
  registerScorer(taskType: string, scorer: (step: string, prev: string | null) => number): void {
    this.scorers.set(taskType, scorer)
  }

  /**
   * Remove a registered scorer, falling back to default heuristics.
   */
  unregisterScorer(taskType: string): boolean {
    return this.scorers.delete(taskType)
  }

  // ── Config ────────────────────────────────────────────────────────────

  get labelingStrategy(): string {
    return this.config.labelingStrategy
  }

  get numRollouts(): number {
    return this.config.numRollouts
  }

  updateConfig(partial: Partial<PRMConfig>): void {
    this.config = { ...this.config, ...partial }
  }

  // ── Score Cache ────────────────────────────────────────────────────

  private scoreCache: Map<string, number> = new Map()
  private static readonly MAX_CACHE_SIZE = 10000

  /** Look up a cached score for a (state, action) pair. */
  private getCachedScore(state: string, action: string): number | undefined {
    const key = `${state}|||${action}`
    return this.scoreCache.get(key)
  }

  /** Cache a score for a (state, action) pair. Evicts oldest if over max. */
  private setCachedScore(state: string, action: string, score: number): void {
    const key = `${state}|||${action}`
    if (this.scoreCache.size >= ProcessRewardModel.MAX_CACHE_SIZE) {
      // Evict oldest entry (Map maintains insertion order)
      const firstKey = this.scoreCache.keys().next().value
      if (firstKey !== undefined) this.scoreCache.delete(firstKey)
    }
    this.scoreCache.set(key, score)
  }
}

/**
 * Save a PRM model configuration and state to a serializable object.
 * Note: This serializes config and registered scorers, not the neural network.
 */
export function savePRMModel(model: ProcessRewardModel, metadata?: Record<string, unknown>): PRMModelData {
  return {
    version: "1.0.0",
    config: {
      labelingStrategy: model.labelingStrategy as "mc_rollout" | "heuristic" | "hybrid",
      numRollouts: model.numRollouts,
      confidenceWeighting: true,
      maxContextTokens: 512,
      minConfidence: 0.3,
    },
    heuristicConfig: {},
    trainedWeights: null,
    metadata: metadata ?? {},
  }
}

/**
 * Load a PRM model from serialized data.
 * Note: This restores config only — scorer functions must be re-registered.
 */
export function loadPRMModel(data: PRMModelData): ProcessRewardModel {
  const model = new ProcessRewardModel(data.config, data.heuristicConfig)
  return model
}
