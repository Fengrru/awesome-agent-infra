export interface POMDPState {
  id: string
  variables: Record<string, unknown>
  score: number
  step: number
  parentId?: string
  hash: string
}

export interface Action {
  id: string
  name: string
  description: string
  precondition?: (state: POMDPState) => boolean
  effect?: (state: POMDPState) => POMDPState
  cost: number
}

export interface Observation {
  id: string
  text: string
  data: Record<string, unknown>
  timestamp: number
}

export interface Particle {
  state: POMDPState
  weight: number
}

export interface BeliefState {
  particles: Particle[]
  totalWeight: number
  entropy: number
}

export interface POMDPConfig {
  numParticles: number
  numRollouts: number
  maxDepth: number
  discountFactor: number
  explorationBonus: number
  resampleThreshold: number
  timeoutMs: number
  maxPlanSteps: number
  temperature: number
}

export interface QValue {
  actionId: string
  qValue: number
  uncertainty: number
  rolloutCount: number
}

export interface PlanStep {
  state: POMDPState
  action: Action
  qValues: QValue[]
  chosenQValue: number
  step: number
}

export interface PlanResult {
  steps: PlanStep[]
  finalState: POMDPState
  totalCost: number
  expectedReward: number
  planDurationMs: number
  converged: boolean
  metadata: Record<string, unknown>
}

export interface PlanningMetadata {
  particlesGenerated: number
  rolloutsPerformed: number
  statesExplored: number
  resamplesPerformed: number
  timeouts: number
  [key: string]: unknown
}

export class StateHasher {
  static hash(state: POMDPState): string {
    return StateHasher.hashVariables(state.variables)
  }

  static hashVariables(vars: Record<string, unknown>): string {
    const keys = Object.keys(vars).sort()
    const parts: string[] = []
    for (const key of keys) {
      parts.push(`${key}:${StateHasher.serializeValue(vars[key])}`)
    }
    return parts.join("|")
  }

  static serializeValue(value: unknown): string {
    if (value === null) return "null"
    if (value === undefined) return "undefined"
    if (typeof value === "boolean" || typeof value === "number" || typeof value === "bigint") {
      return String(value)
    }
    if (typeof value === "string") {
      if (/^[a-zA-Z0-9_\-.]*$/.test(value) && value.length < 40) return value
      return JSON.stringify(value)
    }
    return JSON.stringify(value, Object.keys(value as object).sort())
  }
}

export class ActionRegistry {
  private actions: Map<string, Action>

  constructor() {
    this.actions = new Map()
  }

  register(action: Action): void {
    this.actions.set(action.id, action)
  }

  unregister(actionId: string): boolean {
    return this.actions.delete(actionId)
  }

  get(actionId: string): Action | undefined {
    return this.actions.get(actionId)
  }

  getAll(): Action[] {
    return Array.from(this.actions.values())
  }

  getApplicable(state: POMDPState): Action[] {
    const applicable: Action[] = []
    for (const action of this.actions.values()) {
      if (!action.precondition || action.precondition(state)) {
        applicable.push(action)
      }
    }
    return applicable
  }
}

export const DEFAULT_POMDP_CONFIG: POMDPConfig = {
  numParticles: 100,
  numRollouts: 10,
  maxDepth: 5,
  discountFactor: 0.95,
  explorationBonus: 0.1,
  resampleThreshold: 0.5,
  timeoutMs: 30000,
  maxPlanSteps: 20,
  temperature: 0.5,
}

export class ParticleFilter {
  private config: POMDPConfig
  private resampleCount = 0

  constructor(config?: Partial<POMDPConfig>) {
    this.config = { ...DEFAULT_POMDP_CONFIG, ...config }
  }

  initialize(initialState: POMDPState): BeliefState {
    const particles: Particle[] = []
    const weight = 1 / this.config.numParticles
    for (let i = 0; i < this.config.numParticles; i++) {
      const state: POMDPState = {
        ...initialState,
        id: `${initialState.id}_p${i}`,
        variables: { ...initialState.variables },
        hash: initialState.hash,
        step: initialState.step,
      }
      particles.push({ state, weight })
    }
    return {
      particles,
      totalWeight: 1,
      entropy: 0,
    }
  }

  update(
    belief: BeliefState,
    action: Action,
    observation: Observation,
    stateTransition: (state: POMDPState, action: Action) => POMDPState,
  ): BeliefState {
    const predicted = this.predict(belief, action, stateTransition)

    for (const particle of predicted.particles) {
      const likelihood = this.observationLikelihood(particle.state, observation)
      particle.weight *= likelihood
    }

    let totalWeight = 0
    for (const particle of predicted.particles) {
      totalWeight += particle.weight
    }

    if (totalWeight === 0) {
      for (const particle of predicted.particles) {
        particle.weight = 1 / predicted.particles.length
      }
      totalWeight = 1
    } else {
      for (const particle of predicted.particles) {
        particle.weight /= totalWeight
      }
    }

    predicted.totalWeight = 1
    predicted.entropy = this.computeEntropy(predicted)

    const ess = this.effectiveSampleSize(predicted)
    if (ess < this.config.resampleThreshold * this.config.numParticles) {
      return this.resample(predicted)
    }

    return predicted
  }

  private observationLikelihood(state: POMDPState, observation: Observation): number {
    const obsKeys = Object.keys(observation.data)
    if (obsKeys.length === 0) return 1

    let matches = 0
    for (const key of obsKeys) {
      if (Object.prototype.hasOwnProperty.call(state.variables, key)) {
        const stateVal = state.variables[key]
        const obsVal = observation.data[key]
        if (StateHasher.serializeValue(stateVal) === StateHasher.serializeValue(obsVal)) {
          matches++
        }
      }
    }

    const ratio = matches / obsKeys.length
    return 0.05 + 0.95 * ratio
  }

  resample(belief: BeliefState): BeliefState {
    const n = belief.particles.length
    if (n === 0) return belief

    const weights = belief.particles.map((p) => Math.max(0, p.weight))
    const weightSum = weights.reduce((a, b) => a + b, 0)

    if (weightSum === 0) {
      const equalWeight = 1 / n
      const resampled: Particle[] = []
      for (let i = 0; i < n; i++) {
        const orig = belief.particles[i]!
        resampled.push({
          state: {
            ...orig.state,
            id: `${orig.state.id}_r${i}`,
            variables: { ...orig.state.variables },
          },
          weight: equalWeight,
        })
      }
      this.resampleCount++
      return {
        particles: resampled,
        totalWeight: 1,
        entropy: this.computeEntropy({ particles: resampled, totalWeight: 1, entropy: 0 }),
      }
    }

    const cumulativeWeights: number[] = []
    let cumsum = 0
    for (const w of weights) {
      cumsum += w / weightSum
      cumulativeWeights.push(cumsum)
    }

    const resampled: Particle[] = []
    for (let i = 0; i < n; i++) {
      const r = Math.random()
      let idx = 0
      while (idx < n && cumulativeWeights[idx]! < r) {
        idx++
      }
      if (idx >= n) idx = n - 1
      const orig = belief.particles[idx]!
      resampled.push({
        state: {
          ...orig.state,
          id: `${orig.state.id}_r${i}`,
          variables: { ...orig.state.variables },
        },
        weight: 1 / n,
      })
    }

    this.resampleCount++
    return {
      particles: resampled,
      totalWeight: 1,
      entropy: this.computeEntropy({ particles: resampled, totalWeight: 1, entropy: 0 }),
    }
  }

  effectiveSampleSize(belief: BeliefState): number {
    let sumSq = 0
    for (const p of belief.particles) {
      sumSq += p.weight * p.weight
    }
    if (sumSq === 0) return 0
    return 1 / sumSq
  }

  computeEntropy(belief: BeliefState): number {
    let entropy = 0
    for (const p of belief.particles) {
      if (p.weight > 0) {
        entropy -= p.weight * Math.log2(p.weight)
      }
    }
    return entropy
  }

  predict(
    belief: BeliefState,
    action: Action,
    stateTransition: (state: POMDPState, action: Action) => POMDPState,
  ): BeliefState {
    const particles: Particle[] = []
    for (const particle of belief.particles) {
      const nextState = stateTransition(particle.state, action)
      particles.push({
        state: {
          ...nextState,
          id: `${nextState.id}_pred`,
          variables: { ...nextState.variables },
        },
        weight: particle.weight,
      })
    }
    return {
      particles,
      totalWeight: belief.totalWeight,
      entropy: this.computeEntropy({ particles, totalWeight: belief.totalWeight, entropy: 0 }),
    }
  }

  updateConfig(config: Partial<POMDPConfig>): void {
    this.config = { ...this.config, ...config }
  }

  getConfig(): POMDPConfig {
    return { ...this.config }
  }

  getResampleCount(): number {
    return this.resampleCount
  }
}

export class QMDPSolver {
  private config: POMDPConfig

  constructor(config?: Partial<POMDPConfig>) {
    this.config = { ...DEFAULT_POMDP_CONFIG, ...config }
  }

  computeQValues(
    belief: BeliefState,
    actions: Action[],
    stateTransition: (state: POMDPState, action: Action) => POMDPState,
    rewardFn: (state: POMDPState, action: Action, nextState: POMDPState) => number,
  ): QValue[] {
    const qValues: QValue[] = []

    for (const action of actions) {
      const qValue = this.qmdpEstimate(belief, action, actions, stateTransition, rewardFn)
      qValues.push({
        actionId: action.id,
        qValue,
        uncertainty: 0,
        rolloutCount: this.config.numRollouts,
      })
    }

    if (qValues.length > 0) {
      const maxQ = qValues.reduce((m, qv) => Math.max(m, qv.qValue), -Infinity)
      const minQ = qValues.reduce((m, qv) => Math.min(m, qv.qValue), Infinity)
      const range = maxQ - minQ || 1
      for (const qv of qValues) {
        qv.uncertainty = 1 - Math.exp(-((qv.qValue - minQ) / range) / this.config.temperature)
      }
    }

    return qValues
  }

  private qmdpEstimate(
    belief: BeliefState,
    action: Action,
    actions: Action[],
    stateTransition: (state: POMDPState, action: Action) => POMDPState,
    rewardFn: (state: POMDPState, action: Action, nextState: POMDPState) => number,
  ): number {
    let totalQ = 0
    for (const particle of belief.particles) {
      let rolloutSum = 0
      for (let r = 0; r < this.config.numRollouts; r++) {
        rolloutSum += this.mcRollout(particle.state, action, 0, actions, stateTransition, rewardFn)
      }
      totalQ += particle.weight * (rolloutSum / this.config.numRollouts)
    }
    return totalQ
  }

  private mcRollout(
    state: POMDPState,
    action: Action,
    depth: number,
    actions: Action[],
    stateTransition: (state: POMDPState, action: Action) => POMDPState,
    rewardFn: (state: POMDPState, action: Action, nextState: POMDPState) => number,
  ): number {
    if (depth >= this.config.maxDepth) return 0

    const nextState = stateTransition(state, action)
    const immediateReward = rewardFn(state, action, nextState)

    if (depth >= this.config.maxDepth - 1) return immediateReward

    const applicableActions = actions.filter((a) => {
      if (a.precondition) return a.precondition(nextState)
      return true
    })

    if (applicableActions.length === 0) return immediateReward

    let selectedAction: Action
    if (Math.random() < this.config.explorationBonus) {
      selectedAction = applicableActions[Math.floor(Math.random() * applicableActions.length)]!
    } else {
      let bestAction = applicableActions[0]!
      let bestReward = -Infinity
      for (const a of applicableActions) {
        const ns = stateTransition(nextState, a)
        const r = rewardFn(nextState, a, ns)
        if (r > bestReward) {
          bestReward = r
          bestAction = a
        }
      }
      selectedAction = bestAction
    }

    const futureReward = this.mcRollout(
      nextState, selectedAction, depth + 1, actions, stateTransition, rewardFn,
    )

    return immediateReward + this.config.discountFactor * futureReward
  }

  updateConfig(config: Partial<POMDPConfig>): void {
    this.config = { ...this.config, ...config }
  }
}

export class POMDPPlanner {
  private config: POMDPConfig
  private filter: ParticleFilter
  private solver: QMDPSolver
  private registry: ActionRegistry
  private metadata: PlanningMetadata

  constructor(
    actions: Action[],
    config?: Partial<POMDPConfig>,
  ) {
    this.config = { ...DEFAULT_POMDP_CONFIG, ...config }
    this.filter = new ParticleFilter(this.config)
    this.solver = new QMDPSolver(this.config)
    this.registry = new ActionRegistry()
    for (const action of actions) {
      this.registry.register(action)
    }
    this.metadata = {
      particlesGenerated: 0,
      rolloutsPerformed: 0,
      statesExplored: 0,
      resamplesPerformed: 0,
      timeouts: 0,
    }
  }

  plan(
    initialState: POMDPState,
    goalCondition: (state: POMDPState) => boolean,
    stateTransition: (state: POMDPState, action: Action) => POMDPState,
    rewardFn: (state: POMDPState, action: Action, nextState: POMDPState) => number,
    options?: {
      maxSteps?: number
      observations?: Observation[]
      onStep?: (step: PlanStep) => void
    },
  ): PlanResult {
    const startTime = Date.now()
    const maxSteps = options?.maxSteps ?? this.config.maxPlanSteps

    let belief = this.filter.initialize(initialState)
    this.metadata.particlesGenerated += this.config.numParticles

    let currentState = initialState
    const steps: PlanStep[] = []
    let totalCost = 0
    let totalReward = 0
    let prevResampleCount = this.filter.getResampleCount()

    for (let stepIdx = 0; stepIdx < maxSteps; stepIdx++) {
      this.metadata.statesExplored++

      if (Date.now() - startTime >= this.config.timeoutMs) {
        this.metadata.timeouts++
        break
      }

      const applicableActions = this.registry.getApplicable(currentState)
      if (applicableActions.length === 0) break

      const qValues = this.solver.computeQValues(
        belief, applicableActions, stateTransition, rewardFn,
      )
      this.metadata.rolloutsPerformed += applicableActions.length * this.config.numRollouts

      qValues.sort((a, b) => b.qValue - a.qValue)
      const bestQValue = qValues[0]!
      const bestAction = this.registry.get(bestQValue.actionId)!

      const nextState = stateTransition(currentState, bestAction)
      totalCost += bestAction.cost
      totalReward += rewardFn(currentState, bestAction, nextState)

      const planStep: PlanStep = {
        state: currentState,
        action: bestAction,
        qValues,
        chosenQValue: bestQValue.qValue,
        step: stepIdx,
      }
      steps.push(planStep)
      options?.onStep?.(planStep)

      if (goalCondition(nextState)) {
        const newResampleCount = this.filter.getResampleCount()
        this.metadata.resamplesPerformed += newResampleCount - prevResampleCount
        return {
          steps,
          finalState: nextState,
          totalCost,
          expectedReward: totalReward,
          planDurationMs: Date.now() - startTime,
          converged: true,
          metadata: this.getMetadata(),
        }
      }

      const observation = options?.observations?.[stepIdx]
      if (observation) {
        belief = this.filter.update(belief, bestAction, observation, stateTransition)
        this.metadata.particlesGenerated += this.config.numParticles
      } else {
        belief = this.filter.predict(belief, bestAction, stateTransition)
      }

      const newResampleCount = this.filter.getResampleCount()
      this.metadata.resamplesPerformed += newResampleCount - prevResampleCount
      prevResampleCount = newResampleCount

      currentState = nextState
    }

    const newResampleCount = this.filter.getResampleCount()
    this.metadata.resamplesPerformed += newResampleCount - prevResampleCount

    return {
      steps,
      finalState: currentState,
      totalCost,
      expectedReward: totalReward,
      planDurationMs: Date.now() - startTime,
      converged: false,
      metadata: this.getMetadata(),
    }
  }

  replan(
    belief: BeliefState,
    goalCondition: (state: POMDPState) => boolean,
    stateTransition: (state: POMDPState, action: Action) => POMDPState,
    rewardFn: (state: POMDPState, action: Action, nextState: POMDPState) => number,
    maxSteps?: number,
  ): PlanResult {
    let bestParticle: Particle | null = null
    let maxWeight = -1
    for (const p of belief.particles) {
      if (p.weight > maxWeight) {
        maxWeight = p.weight
        bestParticle = p
      }
    }

    if (!bestParticle) {
      return {
        steps: [],
        finalState: belief.particles[0]?.state ?? {
          id: "empty",
          variables: {},
          score: 0,
          step: 0,
          hash: "",
        },
        totalCost: 0,
        expectedReward: 0,
        planDurationMs: 0,
        converged: false,
        metadata: this.getMetadata(),
      }
    }

    const initialState: POMDPState = {
      ...bestParticle.state,
      id: `${bestParticle.state.id}_replan`,
      variables: { ...bestParticle.state.variables },
    }

    return this.plan(initialState, goalCondition, stateTransition, rewardFn, {
      maxSteps: maxSteps ?? this.config.maxPlanSteps,
    })
  }

  getMetadata(): PlanningMetadata {
    return { ...this.metadata }
  }

  reset(): void {
    this.metadata = {
      particlesGenerated: 0,
      rolloutsPerformed: 0,
      statesExplored: 0,
      resamplesPerformed: 0,
      timeouts: 0,
    }
  }

  updateConfig(config: Partial<POMDPConfig>): void {
    this.config = { ...this.config, ...config }
    this.filter.updateConfig(config)
    this.solver.updateConfig(config)
  }
}

export function createState(
  variables: Record<string, unknown>,
  step: number,
  parentId?: string,
  score?: number,
  idPrefix?: string,
): POMDPState {
  const prefix = idPrefix ?? "state"
  const hash = StateHasher.hashVariables(variables)
  const shortHash = hash.slice(0, 8)
  return {
    id: `${prefix}_${step}_${shortHash}`,
    variables,
    score: score ?? 0,
    step,
    parentId,
    hash,
  }
}

export function defaultRewardFn(
  state: POMDPState,
  action: Action,
  nextState: POMDPState,
): number {
  const scoreDiff = nextState.score - state.score
  return scoreDiff - action.cost
}

export function defaultGoalFn(
  targetVar: string,
  targetValue: unknown,
): (state: POMDPState) => boolean {
  return (state: POMDPState) => state.variables[targetVar] === targetValue
}
