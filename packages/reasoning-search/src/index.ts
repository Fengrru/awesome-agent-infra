// ─── ReasoningSearch — Model-agnostic search over reasoning trajectories ─────

import {
  type MCTSNode,
  type ReasoningGenerateFn,
  type ReasoningScoreFn,
  type SearchConfig,
  type SearchResult,
  type SearchStrategy,
  type SearchTaskType,
  adaptiveFloor,
  createNode,
  isComplete,
  resetNodeCounter,
  selectBestChild,
  softmaxRewards,
} from "./utils"

// Re-export from utility modules
export {
  type MCTSNode,
  type SearchStrategy,
  type SearchTaskType,
  type SearchConfig,
  type SearchResult,
  type ReasoningGenerateFn,
  type ReasoningScoreFn,
  type SegmentedStep,
  type StepKind,
  type FactualClaim,
  type VerifiedClaim,
  type HallucinationReport,
  type EvaluationMetrics,
  uctValue,
  selectBestChild,
  softmaxRewards,
  adaptiveFloor,
  isComplete,
  isCompleteMath,
  isCompleteCode,
  isCompleteLogic,
  classifyStep,
  segmentSteps,
  isRefusal,
  createNode,
} from "./utils"

export {
  HallucinationSuppressor,
  type HallucinationSuppressorConfig,
} from "./hallucination-suppressor"

export {
  MetricCalculator,
  selfConsistencyEvaluate,
} from "./metrics"

// ─── Default Config ─────────────────────────────────────────────────────────

const DEFAULT_CONFIG: SearchConfig = {
  maxDepth: 15,
  beamWidth: 3,
  explorationConstant: Math.SQRT2,
  temperature: 2.0,
  discountFactor: 0.95,
  mctsIterations: 50,
  prmBeta: 1.0,
}

/**
 * ReasoningSearch — model-agnostic search over reasoning trajectories.
 *
 * Supports six search strategies:
 * - `mcts`: Monte Carlo Tree Search with UCT selection
 * - `true_guided_beam_search`: Interleaved PRM scoring at every expansion step
 * - `importance_sampling`: Step-wise PRM-weighted candidate selection
 * - `best_of_n`: Generate N completions and pick the highest-scoring
 * - `legacy_beam_search`: Simple beam search without PRM interleaving (baseline)
 * - `standard_sampling`: Single-pass generation (baseline)
 */
export class ReasoningSearch {
  private config: SearchConfig
  private generateFn: ReasoningGenerateFn
  private scoreFn: ReasoningScoreFn | null

  constructor(
    generateFn: ReasoningGenerateFn,
    options?: {
      scoreFn?: ReasoningScoreFn
      config?: Partial<SearchConfig>
    },
  ) {
    this.generateFn = generateFn
    this.scoreFn = options?.scoreFn ?? null
    this.config = { ...DEFAULT_CONFIG, ...options?.config }
  }

  // ── Public API ──────────────────────────────────────────────────────

  /**
   * Solve a problem using the specified search strategy.
   */
  async solve(
    problem: string,
    strategy: SearchStrategy = "mcts",
    taskType: SearchTaskType = "general",
    configOverride?: Partial<SearchConfig>,
  ): Promise<SearchResult> {
    const effectiveConfig = { ...this.config, ...configOverride }
    const startTime = Date.now()

    resetNodeCounter()

    switch (strategy) {
      case "mcts":
        return this.mctsSearch(problem, effectiveConfig, taskType, startTime)
      case "true_guided_beam_search":
        return this.guidedBeamSearch(problem, effectiveConfig, taskType, startTime)
      case "importance_sampling":
        return this.importanceSampling(problem, effectiveConfig, taskType, startTime)
      case "best_of_n":
        return this.bestOfNSearch(problem, effectiveConfig, taskType, startTime)
      case "legacy_beam_search":
        return this.legacyBeamSearch(problem, effectiveConfig, taskType, startTime)
      case "standard_sampling":
        return this.standardSampling(problem, effectiveConfig, taskType, startTime)
      default:
        throw new Error(`Unknown search strategy: ${strategy}`)
    }
  }

  // ── MCTS Search ─────────────────────────────────────────────────────

  private async mctsSearch(
    problem: string,
    config: SearchConfig,
    taskType: SearchTaskType,
    startTime: number,
  ): Promise<SearchResult> {
    const root = createNode(problem, null, null)
    let generateCalls = 0
    let nodesExplored = 1 // root

    for (let iter = 0; iter < config.mctsIterations; iter++) {
      // 1. Selection: traverse to a leaf
      let node = root
      while (node.children.length > 0 && node.children.every((c) => c.visits > 0)) {
        node = selectBestChild(node, config.explorationConstant)
      }

      // 2. Expansion: if leaf is not terminal, expand it
      if (!isComplete(node.state, taskType) && node.depth < config.maxDepth) {
        const candidates = await this.generateFn(node.state, config.beamWidth)
        generateCalls++

        for (const candidate of candidates) {
          const child = createNode(`${node.state}\n${candidate}`, candidate, node)
          node.children.push(child)
          nodesExplored++
        }

        // 3. Simulation: pick a random unvisited child and simulate
        if (node.children.length > 0) {
          const unvisited = node.children.filter((c) => c.visits === 0)
          const selected =
            unvisited.length > 0
              ? unvisited[Math.floor(Math.random() * unvisited.length)]!
              : node.children[Math.floor(Math.random() * node.children.length)]!

          const reward = await this.simulate(selected, config, taskType)
          // 4. Backpropagation
          this.backpropagate(selected, reward)
        }
      } else {
        // Terminal node: simulate directly
        const reward = await this.simulate(node, config, taskType)
        this.backpropagate(node, reward)
      }
    }

    // Extract best path
    const bestPath = this.extractBestPath(root)

    return {
      solution: bestPath
        .map((n) => n.action)
        .filter((a): a is string => a !== null)
        .join("\n"),
      reasoningChain: bestPath.map((n) => n.action).filter((a): a is string => a !== null),
      finalScore:
        bestPath.length > 0
          ? bestPath[bestPath.length - 1]!.value / Math.max(1, bestPath[bestPath.length - 1]!.visits)
          : 0,
      numSteps: bestPath.length - 1,
      searchStats: {
        nodesExplored,
        timeMs: Date.now() - startTime,
        strategy: "mcts",
        generateCalls,
      },
    }
  }

  /**
   * Simulate: deep rollout estimate of a node's value.
   *
   * Performs a multi-step rollout (up to maxRolloutDepth steps) from the node,
   * scoring each step via PRM if available. Returns the discounted cumulative reward.
   *
   * V(n) = max(Σ_{k=1..D} r_k * discountFactor^{d+k}, adaptiveFloor(d))
   */
  private async simulate(
    node: MCTSNode,
    config: SearchConfig,
    taskType: SearchTaskType,
    rolloutDepth = 3,
  ): Promise<number> {
    // Terminal node: high reward
    if (isComplete(node.state, taskType)) {
      return 0.9 * config.discountFactor ** node.depth
    }

    if (node.depth >= config.maxDepth) {
      return adaptiveFloor(node.depth, config.discountFactor)
    }

    // Deep rollout: simulate multiple steps
    let cumulativeReward = 0
    let currentState = node.state
    let currentDepth = node.depth

    for (let k = 0; k < rolloutDepth && currentDepth < config.maxDepth; k++) {
      // Generate one candidate step
      const candidates = await this.generateFn(currentState, 1)
      if (candidates.length === 0) break

      const step = candidates[0]!
      currentState += `\n${step}`
      currentDepth++

      // Score the step
      let stepReward = 0.5 // neutral default
      if (this.scoreFn) {
        stepReward = await this.scoreFn(currentState.replace(`\n${step}`, ""), step)
      }

      // Discounted step reward
      cumulativeReward += stepReward * config.discountFactor ** currentDepth

      // Early termination on completion
      if (isComplete(currentState, taskType)) {
        cumulativeReward += 0.2 * config.discountFactor ** currentDepth
        break
      }
    }

    const floor = adaptiveFloor(node.depth, config.discountFactor)
    return Math.max(cumulativeReward, floor)
  }

  /**
   * Backpropagate value from leaf to root via parent pointers.
   */
  private backpropagate(node: MCTSNode, reward: number): void {
    let current: MCTSNode | null = node
    while (current !== null) {
      current.visits++
      current.value += reward
      current = current.parent
    }
  }

  /**
   * Extract the best path from root to the highest-value leaf.
   */
  private extractBestPath(root: MCTSNode): MCTSNode[] {
    const path: MCTSNode[] = [root]
    let current = root

    while (current.children.length > 0) {
      // Pick child with highest average value
      let best = current.children[0]!
      let bestAvg = best.visits > 0 ? best.value / best.visits : 0

      for (let i = 1; i < current.children.length; i++) {
        const child = current.children[i]!
        const avg = child.visits > 0 ? child.value / child.visits : 0
        if (avg > bestAvg) {
          bestAvg = avg
          best = child
        }
      }

      // Stop if best is worse than current (shouldn't happen normally)
      if (bestAvg < 0) break

      path.push(best)
      current = best
    }

    return path
  }

  // ── Guided Beam Search ──────────────────────────────────────────────

  private async guidedBeamSearch(
    problem: string,
    config: SearchConfig,
    taskType: SearchTaskType,
    startTime: number,
  ): Promise<SearchResult> {
    interface BeamState {
      text: string
      steps: string[]
      score: number
    }

    let beams: BeamState[] = [{ text: problem, steps: [], score: 1.0 }]
    let generateCalls = 0

    for (let step = 0; step < config.maxDepth; step++) {
      const allCandidates: BeamState[] = []

      for (const beam of beams) {
        // Generate 2x beam_width candidates per beam
        const candTexts = await this.generateFn(beam.text, config.beamWidth * 2)
        generateCalls++

        for (const candText of candTexts) {
          // Score the step if a scorer is available
          let prmScore = 0.5
          if (this.scoreFn) {
            const state = beam.steps.join("\n") || "Start"
            prmScore = await this.scoreFn(state, candText)
          }

          const newText = `${beam.text}\n${candText}`
          const newSteps = [...beam.steps, candText]
          const adjustedScore = beam.score * Math.exp(config.prmBeta * prmScore)

          allCandidates.push({ text: newText, steps: newSteps, score: adjustedScore })

          // Early termination on completion
          if (isComplete(newText, taskType)) {
            return {
              solution: newSteps.join("\n"),
              reasoningChain: newSteps,
              finalScore: adjustedScore,
              numSteps: newSteps.length,
              searchStats: {
                nodesExplored: 0,
                timeMs: Date.now() - startTime,
                strategy: "true_guided_beam_search",
                generateCalls,
              },
            }
          }
        }
      }

      // Sort by adjusted score and prune to beam_width
      allCandidates.sort((a, b) => b.score - a.score)
      beams = allCandidates.slice(0, config.beamWidth)

      if (beams.length === 0) break
    }

    // Return best beam after max steps
    const best = beams[0] ?? { text: problem, steps: [], score: 0 }
    return {
      solution: best.steps.join("\n"),
      reasoningChain: best.steps,
      finalScore: best.score,
      numSteps: best.steps.length,
      searchStats: {
        nodesExplored: 0,
        timeMs: Date.now() - startTime,
        strategy: "true_guided_beam_search",
        generateCalls,
      },
    }
  }

  // ── Importance Sampling ─────────────────────────────────────────────

  private async importanceSampling(
    problem: string,
    config: SearchConfig,
    taskType: SearchTaskType,
    startTime: number,
  ): Promise<SearchResult> {
    let currentText = problem
    const steps: string[] = []
    let generateCalls = 0

    for (let step = 0; step < config.maxDepth; step++) {
      const candidates = await this.generateFn(currentText, config.beamWidth * 2)
      generateCalls++

      if (candidates.length === 0) break

      // Score all candidates
      const scores: number[] = []
      for (const candidate of candidates) {
        const state = steps.join("\n") || "Start"
        if (this.scoreFn) {
          scores.push(await this.scoreFn(state, candidate))
        } else {
          scores.push(0.5)
        }
      }

      // Softmax to get selection probabilities
      const probs = softmaxRewards(scores, config.temperature)

      // Sample one candidate based on probabilities
      const r = Math.random()
      let cumulative = 0
      let selectedIdx = 0
      for (let i = 0; i < probs.length; i++) {
        cumulative += probs[i]!
        if (r <= cumulative) {
          selectedIdx = i
          break
        }
      }

      const selected = candidates[selectedIdx]!
      steps.push(selected)
      currentText = `${currentText}\n${selected}`

      if (isComplete(currentText, taskType)) break
    }

    return {
      solution: steps.join("\n"),
      reasoningChain: steps,
      finalScore: 0,
      numSteps: steps.length,
      searchStats: {
        nodesExplored: 0,
        timeMs: Date.now() - startTime,
        strategy: "importance_sampling",
        generateCalls,
      },
    }
  }

  // ── Best-of-N Search ───────────────────────────────────────────────

  /**
   * Best-of-N: generate N independent completions, score each with PRM,
   * and return the highest-scoring one.
   *
   * The first completion uses greedy decoding (T=0) as a baseline;
   * subsequent completions diversify via temperature.
   */
  private async bestOfNSearch(
    problem: string,
    config: SearchConfig,
    taskType: SearchTaskType,
    startTime: number,
  ): Promise<SearchResult> {
    const N = config.beamWidth * 2
    const candidates: { text: string; score: number }[] = []
    let generateCalls = 0

    // Generate N independent completions
    for (let i = 0; i < N; i++) {
      const completions = await this.generateFn(problem, 1)
      generateCalls++
      const text = completions[0] ?? ""

      // Score the full completion path
      let score = 0.5
      if (this.scoreFn) {
        const steps = text.split("\n").filter((s) => s.trim().length > 0)
        let cumulativeStepScore = 0
        for (let j = 0; j < steps.length; j++) {
          const prevState = steps.slice(0, j).join("\n") || "Start"
          const stepScore = await this.scoreFn(prevState, steps[j]!)
          cumulativeStepScore += stepScore * config.discountFactor ** j
        }
        score = steps.length > 0 ? cumulativeStepScore / steps.length : 0.5
      }

      candidates.push({ text, score })

      // Early return on perfect completion
      if (isComplete(text, taskType) && score > 0.85) break
    }

    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score)
    const best = candidates[0] ?? { text: "", score: 0 }

    return {
      solution: best.text,
      reasoningChain: [best.text],
      finalScore: best.score,
      numSteps: 1,
      searchStats: {
        nodesExplored: candidates.length,
        timeMs: Date.now() - startTime,
        strategy: "best_of_n",
        generateCalls,
      },
    }
  }

  // ── Legacy Beam Search ────────────────────────────────────────────

  /**
   * Legacy beam search: simple beam search without PRM interleaving.
   * At each depth, expand all beams, score candidates, keep top beamWidth.
   * This is the baseline beam search before PRM-guided enhancement.
   */
  private async legacyBeamSearch(
    problem: string,
    config: SearchConfig,
    taskType: SearchTaskType,
    startTime: number,
  ): Promise<SearchResult> {
    interface BeamState {
      text: string
      steps: string[]
      score: number
    }

    let beams: BeamState[] = [{ text: problem, steps: [], score: 1.0 }]
    let generateCalls = 0

    for (let step = 0; step < config.maxDepth; step++) {
      const allCandidates: BeamState[] = []

      for (const beam of beams) {
        const candTexts = await this.generateFn(beam.text, config.beamWidth)
        generateCalls++

        for (const candText of candTexts) {
          const newText = `${beam.text}\n${candText}`
          const newSteps = [...beam.steps, candText]
          // Simple uniform scoring for legacy mode
          const adjustedScore = beam.score * 0.95 // depth penalty

          allCandidates.push({ text: newText, steps: newSteps, score: adjustedScore })

          if (isComplete(newText, taskType)) {
            return {
              solution: newSteps.join("\n"),
              reasoningChain: newSteps,
              finalScore: adjustedScore,
              numSteps: newSteps.length,
              searchStats: {
                nodesExplored: 0,
                timeMs: Date.now() - startTime,
                strategy: "legacy_beam_search",
                generateCalls,
              },
            }
          }
        }
      }

      allCandidates.sort((a, b) => b.score - a.score)
      beams = allCandidates.slice(0, config.beamWidth)

      if (beams.length === 0) break
    }

    const best = beams[0] ?? { text: problem, steps: [], score: 0 }
    return {
      solution: best.steps.join("\n"),
      reasoningChain: best.steps,
      finalScore: best.score,
      numSteps: best.steps.length,
      searchStats: {
        nodesExplored: 0,
        timeMs: Date.now() - startTime,
        strategy: "legacy_beam_search",
        generateCalls,
      },
    }
  }

  // ── Standard Sampling (Baseline) ────────────────────────────────────

  private async standardSampling(
    problem: string,
    _config: SearchConfig,
    _taskType: SearchTaskType,
    startTime: number,
  ): Promise<SearchResult> {
    const completions = await this.generateFn(problem, 1)
    const solution = completions[0] ?? ""

    return {
      solution,
      reasoningChain: [solution],
      finalScore: 0,
      numSteps: 1,
      searchStats: {
        nodesExplored: 1,
        timeMs: Date.now() - startTime,
        strategy: "standard_sampling",
        generateCalls: 1,
      },
    }
  }

  // ── Config ──────────────────────────────────────────────────────────

  updateConfig(partial: Partial<SearchConfig>): void {
    this.config = { ...this.config, ...partial }
  }

  getConfig(): Readonly<SearchConfig> {
    return this.config
  }
}

/**
 * Create a {@link ReasoningSearch} instance.
 *
 * @param args - Constructor arguments forwarded to {@link ReasoningSearch}.
 * @returns A new {@link ReasoningSearch}.
 */
export function createReasoningSearch(...args: ConstructorParameters<typeof ReasoningSearch>): ReasoningSearch {
  return new ReasoningSearch(...args)
}
