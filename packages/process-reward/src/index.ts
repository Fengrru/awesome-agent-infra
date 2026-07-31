/**
 * Process Reward Model — unified PRM package.
 *
 * Merges @fengru/process-reward and @fengru/prm-trainer into a single
 * cohesive package for step-level reasoning quality scoring, labeling,
 * verification, training, and guided inference.
 *
 * ## Module layout
 * - `types`     — shared types, configs, and constants
 * - `scoring`   — heuristic step scoring functions (math, code, logic, general)
 * - `labeler`   — PRMLabeler: 3-tier step labeling for training data
 * - `trainer`   — PRMTrainer: confidence-weighted MSE training + HeuristicStepScorer
 * - `model`     — ProcessRewardModel: core scorer + save/load
 * - `inference` — StepSegmenter, VerifierPool, GuidedInferenceEngine
 *
 * @module process-reward
 */

// ─── Types ────────────────────────────────────────────────────────────
export type {
  TaskType,
  LabelingMethod,
  StepScore,
  PRMConfig,
  HeuristicConfig,
  MathHeuristicOptions,
  CodeHeuristicOptions,
  LogicHeuristicOptions,
  GenerateFn,
  VerifyFn,
  TrainingSample,
  TrainingConfig,
  StepSegmentKind,
  SegmentedPRMStep,
  VerificationResult,
  PRMModelData,
} from "./types"

export {
  DEFAULT_PRM_CONFIG,
  DEFAULT_TRAINING_CONFIG,
  DEFAULT_MATH_OPTIONS,
  DEFAULT_CODE_OPTIONS,
  DEFAULT_LOGIC_OPTIONS,
} from "./types"

// ─── Scoring ──────────────────────────────────────────────────────────
export {
  rolloutConfidence,
  scoreMathStep,
  scoreCodeStep,
  scoreLogicStep,
  scoreGeneralStep,
  heuristicScore,
  weakSupervisionLabel,
  mcRolloutLabel,
} from "./scoring"

// ─── Labeler ──────────────────────────────────────────────────────────
export { PRMLabeler } from "./labeler"

// ─── Trainer ──────────────────────────────────────────────────────────
export { HeuristicStepScorer, PRMTrainer, createPRMTrainer } from "./trainer"

// ─── Model ────────────────────────────────────────────────────────────
export { ProcessRewardModel, createProcessRewardModel, savePRMModel, loadPRMModel } from "./model"

// ─── Inference ────────────────────────────────────────────────────────
export { StepSegmenter, VerifierPool, GuidedInferenceEngine } from "./inference"
