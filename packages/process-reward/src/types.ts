/**
 * Process Reward Model — Unified types.
 * @module process-reward/types
 */

/** Supported task domains for heuristic evaluation. */
export type TaskType = "math" | "code" | "logic" | "general"

/** Labeling strategy tier. */
export type LabelingMethod = "mc_rollout" | "heuristic" | "weak_supervision"

/** A single step score result. */
export interface StepScore {
  stepIndex: number
  score: number
  confidence: number
  method: LabelingMethod
  details?: Record<string, unknown>
}

/** Configuration for the ProcessRewardModel. */
export interface PRMConfig {
  labelingStrategy: "mc_rollout" | "heuristic" | "hybrid" | "weak_supervision"
  numRollouts: number
  confidenceWeighting: boolean
  maxContextTokens: number
  minConfidence: number
}

export const DEFAULT_PRM_CONFIG: PRMConfig = {
  labelingStrategy: "hybrid",
  numRollouts: 8,
  confidenceWeighting: true,
  maxContextTokens: 512,
  minConfidence: 0.3,
}

/** Configuration for heuristic step evaluation. */
export interface HeuristicConfig {
  math?: Partial<MathHeuristicOptions>
  code?: Partial<CodeHeuristicOptions>
  logic?: Partial<LogicHeuristicOptions>
}

export interface MathHeuristicOptions {
  equationWeight: number
  coherenceWeight: number
  errorPenalty: number
}

export interface CodeHeuristicOptions {
  patternWeight: number
  syntaxPenalty: number
  indentWeight: number
}

export interface LogicHeuristicOptions {
  premiseWeight: number
  conclusionWeight: number
  contradictionPenalty: number
}

export const DEFAULT_MATH_OPTIONS: MathHeuristicOptions = {
  equationWeight: 0.1, coherenceWeight: 0.15, errorPenalty: 0.3,
}

export const DEFAULT_CODE_OPTIONS: CodeHeuristicOptions = {
  patternWeight: 0.15, syntaxPenalty: 0.4, indentWeight: 0.05,
}

export const DEFAULT_LOGIC_OPTIONS: LogicHeuristicOptions = {
  premiseWeight: 0.1, conclusionWeight: 0.1, contradictionPenalty: 0.3,
}

/** Generate completions from a given reasoning state. */
export type GenerateFn = (state: string, n: number) => Promise<string[]>

/** Verify whether a completed reasoning path produces the correct answer. */
export type VerifyFn = (fullPath: string, referenceAnswer: string) => Promise<boolean> | boolean

/** Training sample for PRM training. */
export interface TrainingSample {
  state: string
  action: string
  label: number
  confidence: number
}

/** Configuration for PRM model training. */
export interface TrainingConfig {
  numEpochs: number
  batchSize: number
  learningRate: number
  earlyStopPatience: number
  warmupSteps: number
  lrSchedule: "constant" | "cosine" | "linear_decay"
}

export const DEFAULT_TRAINING_CONFIG: TrainingConfig = {
  numEpochs: 3, batchSize: 8, learningRate: 2e-5,
  earlyStopPatience: 0, warmupSteps: 0, lrSchedule: "constant",
}

/** Classification of a single reasoning step. */
export type StepSegmentKind = "implication" | "assertion" | "equation" | "conclusion" | "unknown"

/** A segmented reasoning step. */
export interface SegmentedPRMStep {
  text: string
  kind: StepSegmentKind
  index: number
}

/** Result of a verification check. */
export interface VerificationResult {
  correct: boolean
  confidence: number
  verifier: string
  details?: string
}

/** Serializable PRM model state. */
export interface PRMModelData {
  version: string
  config: PRMConfig
  heuristicConfig: HeuristicConfig
  trainedWeights: Record<string, number[]> | null
  metadata: Record<string, unknown>
}
