// ─── Types ────────────────────────────────────────────────────────────────────

/** A node in the MCTS reasoning tree. */
export interface MCTSNode {
  /** Unique node identifier. */
  id: string
  /** The accumulated reasoning text at this node (all steps so far). */
  state: string
  /** The action (reasoning step) that led to this node, null for root. */
  action: string | null
  /** Parent node, null for root. */
  parent: MCTSNode | null
  /** Child nodes. */
  children: MCTSNode[]
  /** Number of times this node has been visited. */
  visits: number
  /** Cumulative value from backpropagation. */
  value: number
  /** Depth in the tree (root = 0). */
  depth: number
}

/** Search strategies. */
export type SearchStrategy =
  | "mcts"
  | "true_guided_beam_search"
  | "importance_sampling"
  | "best_of_n"
  | "legacy_beam_search"
  | "standard_sampling"

/** Task types for completion detection. */
export type SearchTaskType = "math" | "code" | "logic" | "general"

// ─── Step Segmentation Types ──────────────────────────────────────────────

/** Classification of a reasoning step. */
export type StepKind = "implication" | "assertion" | "equation" | "conclusion" | "unknown"

/** A segmented reasoning step with its classification. */
export interface SegmentedStep {
  /** Original step text. */
  text: string
  /** Classified step kind. */
  kind: StepKind
  /** Confidence in the classification [0, 1]. */
  confidence: number
  /** 0-based index of this step in the reasoning path. */
  index: number
}

// ─── Hallucination Types ─────────────────────────────────────────────────

/** A factual claim extracted from text. */
export interface FactualClaim {
  /** The claim text. */
  claim: string
  /** Confidence in this claim [0, 1]. */
  confidence: number
}

/** Result of verifying a single claim via self-consistency. */
export interface VerifiedClaim {
  /** The original claim. */
  claim: string
  /** Whether the claim appears to be hallucinated. */
  isHallucination: boolean
  /** Consistency score from self-consistency voting [0, 1]. */
  consistencyScore: number
  /** Raw verification results. */
  verifications: string[]
}

/** Full result of hallucination suppression. */
export interface HallucinationReport {
  /** Original text before correction. */
  originalText: string
  /** Corrected text (same as original if no hallucinations found). */
  correctedText: string
  /** All extracted claims. */
  claims: string[]
  /** Claims flagged as hallucinations. */
  hallucinations: { claim: string; confidence: number }[]
  /** Number of verified (non-hallucinated) claims. */
  verifiedCount: number
  /** Number of hallucinated claims. */
  hallucinationCount: number
  /** Overall confidence = verifiedCount / totalClaims. */
  overallConfidence: number
}

// ─── Evaluation Metric Types ─────────────────────────────────────────────

/** Full evaluation metrics for a batch of predictions. */
export interface EvaluationMetrics {
  /** Number of samples evaluated. */
  numSamples: number
  /** Exact match accuracy. */
  exactMatch: number
  /** Partial (substring) match accuracy. */
  partialMatch: number
  /** Token-level F1 score. */
  f1: number
  /** ROUGE-1 F-measure. */
  rouge1: number
  /** ROUGE-2 F-measure. */
  rouge2: number
  /** ROUGE-L F-measure. */
  rougeL: number
  /** Corpus-level BLEU score. */
  bleu: number
  /** Expected Calibration Error. */
  ece: number
  /** Efficiency metrics. */
  efficiency: {
    avgCalls: number
    avgTime: number
    harmonicEfficiency: number
  }
}

/** Configuration for the search engine. */
export interface SearchConfig {
  /** Maximum depth of the reasoning tree. */
  maxDepth: number
  /** Beam width for guided beam search and MCTS expansion. */
  beamWidth: number
  /** Exploration constant for UCT formula. Higher = more exploration. */
  explorationConstant: number
  /** Temperature for softmax reward normalization in MCTS. */
  temperature: number
  /** Depth discount factor. Values at depth d are multiplied by discount^d. */
  discountFactor: number
  /** Number of MCTS iterations (select-expand-simulate-backpropagate cycles). */
  mctsIterations: number
  /** PRM influence weight in exp(beta * PRM_score) for guided beam search. */
  prmBeta: number
}

/** Result of a search operation. */
export interface SearchResult {
  /** The final solution text (complete reasoning chain). */
  solution: string
  /** Individual reasoning steps that led to the solution. */
  reasoningChain: string[]
  /** Final score of the best path. */
  finalScore: number
  /** Number of reasoning steps. */
  numSteps: number
  /** Statistics about the search process. */
  searchStats: {
    /** Number of nodes explored. */
    nodesExplored: number
    /** Wall-clock time in milliseconds. */
    timeMs: number
    /** Which search strategy was used. */
    strategy: SearchStrategy
    /** Number of LLM generate calls. */
    generateCalls: number
  }
}

// ─── Model-agnostic interfaces ──────────────────────────────────────────────

/**
 * Generate completions from a given prompt/state.
 * @param prompt - The accumulated reasoning text so far.
 * @param n - Number of candidate completions to generate.
 * @returns Array of completion strings.
 */
export type ReasoningGenerateFn = (prompt: string, n: number) => Promise<string[]>

/**
 * Score a single reasoning step (process reward).
 * @param state - The reasoning text before this step.
 * @param action - The candidate step text.
 * @returns Score in [0, 1]. Higher = better step.
 */
export type ReasoningScoreFn = (state: string, action: string) => Promise<number> | number

// ─── Node Helpers ───────────────────────────────────────────────────────────

let nodeIdCounter = 0

export function createNode(state: string, action: string | null, parent: MCTSNode | null): MCTSNode {
  return {
    id: `node_${++nodeIdCounter}`,
    state,
    action,
    parent,
    children: [],
    visits: 0,
    value: 0,
    depth: parent ? parent.depth + 1 : 0,
  }
}

export function resetNodeCounter(): void {
  nodeIdCounter = 0
}

// ─── UCT Formula ────────────────────────────────────────────────────────────

/**
 * Compute the UCT (Upper Confidence Bound for Trees) value for a node.
 *
 * UCT(n) = V(n)/N(n) + c * sqrt(ln(N(parent)) / N(n))
 *
 * If N(n) = 0, returns +Infinity (unvisited nodes should be explored).
 */
export function uctValue(node: MCTSNode, parentVisits: number, explorationConstant: number): number {
  if (node.visits === 0) return Number.POSITIVE_INFINITY
  const exploitation = node.value / node.visits
  const exploration = explorationConstant * Math.sqrt(Math.log(parentVisits) / node.visits)
  return exploitation + exploration
}

/**
 * Select the best child via UCT with fair tie-breaking.
 *
 * When multiple children have UCT = Infinity (unvisited),
 * randomly selects among them rather than deterministically
 * picking the first — fixing the insertion-order bias.
 */
export function selectBestChild(node: MCTSNode, explorationConstant: number): MCTSNode {
  if (node.children.length === 0) {
    throw new Error("Cannot select from empty children")
  }

  const unvisited = node.children.filter((c) => c.visits === 0)
  if (unvisited.length > 0) {
    // Fair tie-breaking: random among unvisited
    return unvisited[Math.floor(Math.random() * unvisited.length)]!
  }

  let best = node.children[0]!
  let bestValue = uctValue(best, node.visits, explorationConstant)

  for (let i = 1; i < node.children.length; i++) {
    const child = node.children[i]!
    const value = uctValue(child, node.visits, explorationConstant)
    if (value > bestValue) {
      bestValue = value
      best = child
    }
  }

  return best
}

// ─── Temperature-Scaled Softmax Reward ──────────────────────────────────────

/**
 * Compute temperature-scaled softmax rewards from raw scores.
 *
 * reward_i = exp((score_i - max(score_j)) / τ) / Σ_k exp((score_k - max(score_j)) / τ)
 *
 * This expands the dynamic range compared to naive normalization,
 * providing stronger exploitation gradients for UCT selection.
 */
export function softmaxRewards(scores: number[], temperature: number): number[] {
  if (scores.length === 0) return []
  const maxScore = Math.max(...scores)
  const expScores = scores.map((s) => Math.exp((s - maxScore) / temperature))
  const sumExp = expScores.reduce((a, b) => a + b, 0)
  return expScores.map((e) => e / sumExp)
}

// ─── Adaptive Value Floor ───────────────────────────────────────────────────

/**
 * Compute the adaptive value floor for a node at a given depth.
 *
 * floor(d) = 10^{-4} * discountFactor^{d}
 *
 * This shrinks exponentially with depth, preventing both:
 * - Artificial prop-up of deeply wrong branches
 * - Penalization of genuinely insightful deep paths
 */
export function adaptiveFloor(depth: number, discountFactor: number): number {
  return 1e-4 * discountFactor ** depth
}

// ─── Completion Detection ───────────────────────────────────────────────────

/** Check if the reasoning is complete for a math task. */
export function isCompleteMath(text: string): boolean {
  return /####\s*\S|the\s+answer\s+is|\\boxed\{/.test(text)
}

/** Check if the reasoning is complete for a code task. */
export function isCompleteCode(text: string): boolean {
  // Strip markdown code fences
  const stripped = text.replace(/```[\s\S]*?```/g, "").trim()
  // A reasonable heuristic: contains a complete function/class with enough body
  return /(?:def|class|function)\s+\w+/.test(stripped) && stripped.length > 10
}

/** Check if the reasoning is complete for a logic task. */
export function isCompleteLogic(text: string): boolean {
  return /Q\.?E\.?D\.?|proved|contradiction|hence\s+the\s+statement|it\s+follows\s+that/i.test(text)
}

/** Task-dispatched completion detection. */
export function isComplete(text: string, taskType: SearchTaskType): boolean {
  switch (taskType) {
    case "math":
      return isCompleteMath(text)
    case "code":
      return isCompleteCode(text)
    case "logic":
      return isCompleteLogic(text)
    default:
      return text.trim().length > 0
  }
}

// ─── Step Segmenter ───────────────────────────────────────────────────────

/**
 * Classify a single reasoning step into its rhetorical kind.
 *
 * Priority order (first match wins):
 *   CONCLUSION → IMPLICATION → EQUATION → ASSERTION → UNKNOWN
 */
export function classifyStep(text: string): StepKind {
  const t = text.trim()

  // Conclusion: "QED", "proved", "contradiction", "in conclusion"
  if (/\b(Q\.?E\.?D\.?|proved|in\s+conclusion|to\s+summarize|contradiction)\b/i.test(t)) {
    return "conclusion"
  }

  // Implication: "therefore", "implies", "since...then", etc.
  if (/\b(therefore|thus|hence|so|consequently|it\s+follows|implies)\b/i.test(t)) {
    return "implication"
  }

  // Equation: lines with structured math (=, +, *, etc.)
  if (/=\s*[-]?\d|\d\s*=\s*\d|[+\-*/×÷]\s*\d/.test(t)) {
    return "equation"
  }

  // Assertion: "assume", "let", "given", "by definition", "suppose"
  if (/\b(assume|let|given|suppose|consider|by\s+definition)\b/i.test(t)) {
    return "assertion"
  }

  return "unknown"
}

/**
 * Segment a full reasoning chain into individually classified steps.
 *
 * Steps are delimited by double-newlines or numbered patterns like "Step N:".
 */
export function segmentSteps(text: string): SegmentedStep[] {
  // Split on double newlines or explicit step markers
  const rawSteps = text
    .split(/\n\n+|(?=\n(?:Step\s*\d+|\d+\.)\s*[A-Z])/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  return rawSteps.map((stepText, index) => ({
    text: stepText,
    kind: classifyStep(stepText),
    confidence: 0.8, // default confidence
    index,
  }))
}

// ─── Refusal Pattern Detection ────────────────────────────────────────────

const REFUSAL_PATTERNS = [
  /I\s+don'?t\s+know/i,
  /I\s+am\s+(not|unable)\s+(sure|certain|able)/i,
  /I\s+cannot\s+(answer|solve|determine)/i,
  /unable\s+to\s+(answer|determine|provide)/i,
  /insufficient\s+information/i,
  /cannot\s+be\s+(determined|solved|answered)/i,
  /not\s+enough\s+(information|context|data)/i,
  /beyond\s+(my|the)\s+(scope|capability|knowledge)/i,
]

/** Check if the output contains a model refusal pattern. */
export function isRefusal(text: string): boolean {
  return REFUSAL_PATTERNS.some((p) => p.test(text))
}
