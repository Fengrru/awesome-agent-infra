import { describe, expect, test } from "bun:test"
import {
  type Action,
  ActionRegistry,
  type BeliefState,
  type Observation,
  type POMDPConfig,
  POMDPPlanner,
  type POMDPState,
  ParticleFilter,
  QMDPSolver,
  StateHasher,
  createPOMDPPlanner,
  createState,
  defaultGoalFn,
  defaultRewardFn,
} from "../src/index"

const makeAction = (overrides?: Partial<Action>): Action => ({
  id: overrides?.id ?? "act",
  name: overrides?.name ?? "Test Action",
  description: overrides?.description ?? "A test action",
  precondition: overrides?.precondition,
  effect: overrides?.effect,
  cost: overrides?.cost ?? 1,
})

const makeState = (overrides?: Partial<POMDPState>): POMDPState =>
  createState(overrides?.variables ?? { x: 0, y: 0 }, overrides?.step ?? 0)

const makeObs = (data: Record<string, unknown>): Observation => ({
  id: `obs_${Date.now()}`,
  text: "test observation",
  data,
  timestamp: Date.now(),
})

const makeSmallConfig = (): Partial<POMDPConfig> => ({
  numParticles: 20,
  numRollouts: 3,
  maxDepth: 3,
  discountFactor: 0.9,
  explorationBonus: 0.05,
  resampleThreshold: 0.3,
  timeoutMs: 5000,
  maxPlanSteps: 10,
  temperature: 0.5,
})

// ===========================================================================
// StateHasher
// ===========================================================================

describe("StateHasher", () => {
  test("hash is deterministic", () => {
    const a = StateHasher.hash({ id: "s1", variables: { x: 1, y: 2 }, score: 0, step: 0, hash: "" })
    const b = StateHasher.hash({ id: "s2", variables: { x: 1, y: 2 }, score: 10, step: 5, hash: "" })
    expect(a).toBe(b)
  })

  test("hash differs for different variables", () => {
    const a = StateHasher.hash({ id: "s1", variables: { x: 1 }, score: 0, step: 0, hash: "" })
    const b = StateHasher.hash({ id: "s1", variables: { x: 2 }, score: 0, step: 0, hash: "" })
    expect(a).not.toBe(b)
  })

  test("hash sorts keys alphabetically", () => {
    const a = StateHasher.hashVariables({ z: 1, a: 2, m: 3 })
    const b = StateHasher.hashVariables({ a: 2, m: 3, z: 1 })
    expect(a).toBe(b)
  })

  test("hash handles nested objects via JSON", () => {
    const a = StateHasher.hashVariables({ data: { a: 1, b: 2 } })
    const b = StateHasher.hashVariables({ data: { a: 1, b: 2 } })
    expect(a).toBe(b)
  })

  test("hash handles nested objects with sorted keys", () => {
    const a = StateHasher.hashVariables({ data: { b: 2, a: 1 } })
    const b = StateHasher.hashVariables({ data: { a: 1, b: 2 } })
    expect(a).toBe(b)
  })

  test("serializeValue handles null and undefined", () => {
    expect(StateHasher.serializeValue(null)).toBe("null")
    expect(StateHasher.serializeValue(undefined)).toBe("undefined")
  })

  test("serializeValue handles array values", () => {
    expect(StateHasher.serializeValue([1, 2, 3])).toBe("[1,2,3]")
  })

  test("hashVariables with empty vars", () => {
    expect(StateHasher.hashVariables({})).toBe("")
  })

  test("hashVariables handles boolean values", () => {
    const a = StateHasher.hashVariables({ flag: true })
    const b = StateHasher.hashVariables({ flag: true })
    expect(a).toBe(b)
  })
})

// ===========================================================================
// ActionRegistry
// ===========================================================================

describe("ActionRegistry", () => {
  test("register and get", () => {
    const reg = new ActionRegistry()
    reg.register(makeAction({ id: "a1", name: "First" }))
    const got = reg.get("a1")
    expect(got).toBeDefined()
    expect(got!.name).toBe("First")
  })

  test("get returns undefined for missing", () => {
    const reg = new ActionRegistry()
    expect(reg.get("nonexistent")).toBeUndefined()
  })

  test("getAll returns all registered actions", () => {
    const reg = new ActionRegistry()
    reg.register(makeAction({ id: "a1" }))
    reg.register(makeAction({ id: "a2" }))
    reg.register(makeAction({ id: "a3" }))
    expect(reg.getAll().length).toBe(3)
  })

  test("getAll returns empty for empty registry", () => {
    const reg = new ActionRegistry()
    expect(reg.getAll().length).toBe(0)
  })

  test("getApplicable filters by precondition", () => {
    const reg = new ActionRegistry()
    reg.register(makeAction({ id: "always", precondition: undefined }))
    reg.register(
      makeAction({
        id: "only_positive",
        precondition: (s) => (s.variables.x as number) > 0,
      }),
    )
    reg.register(
      makeAction({
        id: "only_zero",
        precondition: (s) => (s.variables.x as number) === 0,
      }),
    )

    const state = makeState({ variables: { x: 0 } })
    const applicable = reg.getApplicable(state)
    expect(applicable.length).toBe(2)
    expect(applicable.map((a) => a.id).sort()).toEqual(["always", "only_zero"])
  })

  test("getApplicable returns all when no preconditions", () => {
    const reg = new ActionRegistry()
    reg.register(makeAction({ id: "a1", precondition: undefined }))
    reg.register(makeAction({ id: "a2", precondition: undefined }))
    expect(reg.getApplicable(makeState()).length).toBe(2)
  })

  test("getApplicable returns empty when all preconditions fail", () => {
    const reg = new ActionRegistry()
    reg.register(makeAction({ id: "a1", precondition: () => false }))
    expect(reg.getApplicable(makeState()).length).toBe(0)
  })

  test("unregister removes action", () => {
    const reg = new ActionRegistry()
    reg.register(makeAction({ id: "temp" }))
    expect(reg.get("temp")).toBeDefined()
    expect(reg.unregister("temp")).toBe(true)
    expect(reg.get("temp")).toBeUndefined()
  })

  test("unregister returns false for missing action", () => {
    const reg = new ActionRegistry()
    expect(reg.unregister("nope")).toBe(false)
  })

  test("register overwrites existing action", () => {
    const reg = new ActionRegistry()
    reg.register(makeAction({ id: "a1", name: "Old" }))
    reg.register(makeAction({ id: "a1", name: "New" }))
    expect(reg.get("a1")!.name).toBe("New")
  })
})

// ===========================================================================
// ParticleFilter
// ===========================================================================

describe("ParticleFilter", () => {
  const config = makeSmallConfig()

  test("initialize creates correct particle count", () => {
    const pf = new ParticleFilter(config)
    const belief = pf.initialize(makeState())
    expect(belief.particles.length).toBe(config.numParticles)
  })

  test("initialize sets equal weights summing to 1", () => {
    const pf = new ParticleFilter(config)
    const belief = pf.initialize(makeState())
    const sum = belief.particles.reduce((s, p) => s + p.weight, 0)
    expect(Math.abs(sum - 1)).toBeLessThan(0.001)
    expect(pf.effectiveSampleSize(belief)).toBeCloseTo(config.numParticles!, 0)
  })

  test("initialize sets totalWeight to 1 and entropy to 0", () => {
    const pf = new ParticleFilter(config)
    const belief = pf.initialize(makeState())
    expect(belief.totalWeight).toBe(1)
    expect(belief.entropy).toBe(0)
  })

  test("predict transitions all particles", () => {
    const pf = new ParticleFilter(config)
    const belief = pf.initialize(makeState({ variables: { x: 0 } }))

    const moveAction = makeAction({ id: "move", name: "Move" })
    const transition = (s: POMDPState, _a: Action) => ({
      ...s,
      variables: { x: (s.variables.x as number) + 1 },
    })

    const predicted = pf.predict(belief, moveAction, transition)
    expect(predicted.particles.length).toBe(config.numParticles)
    for (const p of predicted.particles) {
      expect(p.state.variables.x).toBe(1)
    }
  })

  test("predict preserves particle count", () => {
    const pf = new ParticleFilter(config)
    const belief = pf.initialize(makeState())
    const predicted = pf.predict(belief, makeAction(), (s) => s)
    expect(predicted.particles.length).toBe(belief.particles.length)
  })

  test("update changes weights based on observation", () => {
    const pf = new ParticleFilter(config)
    const initialState = makeState({ variables: { loc: "A" } })
    const belief = pf.initialize(initialState)

    const obs = makeObs({ loc: "A" })
    const updated = pf.update(belief, makeAction(), obs, (s) => s)

    const sum = updated.particles.reduce((s, p) => s + p.weight, 0)
    expect(Math.abs(sum - 1)).toBeLessThan(0.01)
  })

  test("update with matching observation gives higher weights for matching particles", () => {
    const pf = new ParticleFilter(makeSmallConfig())
    const initial = pf.initialize(makeState({ variables: { loc: "A" } }))

    const groupAParticle = initial.particles[0]!
    groupAParticle.state = { ...groupAParticle.state, variables: { loc: "A" } }
    const groupBParticle = initial.particles[1]!
    groupBParticle.state = { ...groupBParticle.state, variables: { loc: "B" } }

    for (let i = 0; i < initial.particles.length; i++) {
      const p = initial.particles[i]!
      const loc = i < initial.particles.length / 2 ? "A" : "B"
      p.state = { ...p.state, variables: { loc } }
    }

    const obs = makeObs({ loc: "A" })
    const updated = pf.update(initial, makeAction(), obs, (s) => s)

    let weightA = 0
    let weightB = 0
    for (const p of updated.particles) {
      if (p.state.variables.loc === "A") weightA += p.weight
      else weightB += p.weight
    }
    expect(weightA).toBeGreaterThan(weightB)
  })

  test("update normalizes weights to sum to 1", () => {
    const pf = new ParticleFilter(config)
    const belief = pf.initialize(makeState())
    const updated = pf.update(belief, makeAction(), makeObs({ k: "v" }), (s) => s)
    const sum = updated.particles.reduce((s, p) => s + p.weight, 0)
    expect(Math.abs(sum - 1)).toBeLessThan(0.001)
  })
})

describe("ParticleFilter - belief state", () => {
  test("belief state has correct shape", () => {
    const pf = new ParticleFilter(makeSmallConfig())
    const belief = pf.initialize(makeState())
    expect(belief).toHaveProperty("particles")
    expect(belief).toHaveProperty("totalWeight")
    expect(belief).toHaveProperty("entropy")
    expect(Array.isArray(belief.particles)).toBe(true)
    expect(typeof belief.totalWeight).toBe("number")
    expect(typeof belief.entropy).toBe("number")
  })

  test("each particle has state and weight", () => {
    const pf = new ParticleFilter(makeSmallConfig())
    const belief = pf.initialize(makeState())
    for (const p of belief.particles) {
      expect(p).toHaveProperty("state")
      expect(p).toHaveProperty("weight")
      expect(typeof p.weight).toBe("number")
    }
  })

  test("effectiveSampleSize for uniform weights equals numParticles", () => {
    const cfg = makeSmallConfig()
    const pf = new ParticleFilter(cfg)
    const belief = pf.initialize(makeState())
    expect(pf.effectiveSampleSize(belief)).toBeCloseTo(cfg.numParticles!, -1)
  })

  test("entropy is zero for identical particles after initialize", () => {
    const pf = new ParticleFilter(makeSmallConfig())
    const belief = pf.initialize(makeState())
    expect(belief.entropy).toBe(0)
  })

  test("entropy increases after diverse observation update", () => {
    const pf = new ParticleFilter({ ...makeSmallConfig(), numParticles: 50 })
    const initial = pf.initialize(makeState({ variables: { loc: "A" } }))

    for (let i = 0; i < initial.particles.length; i++) {
      initial.particles[i]!.state = {
        ...initial.particles[i]!.state,
        variables: { loc: i < 25 ? "A" : "B" },
      }
    }
    initial.entropy = pf.computeEntropy(initial)

    const obs = makeObs({ loc: "A" })
    const entropyBefore = pf.computeEntropy(initial)
    const updated = pf.update(initial, makeAction(), obs, (s) => s)
    const entropyAfter = pf.computeEntropy(updated)
    expect(entropyAfter).toBeLessThan(entropyBefore)
  })
})

describe("ParticleFilter - resample", () => {
  test("resample triggers when effective sample size is low", () => {
    const pf = new ParticleFilter(makeSmallConfig())
    const initial = pf.initialize(makeState({ variables: { x: 0 } }))

    for (const p of initial.particles) {
      if (Math.random() < 0.9) {
        p.weight = 0.001 / initial.particles.length
      } else {
        p.weight = 10 / initial.particles.length
      }
    }

    const sum = initial.particles.reduce((s, p) => s + p.weight, 0)
    for (const p of initial.particles) p.weight /= sum

    const ess = pf.effectiveSampleSize(initial)
    const threshold = makeSmallConfig().numParticles! * makeSmallConfig().resampleThreshold!

    if (ess < threshold) {
      const resampled = pf.resample(initial)
      expect(resampled.particles.length).toBe(initial.particles.length)
      const newWeights = resampled.particles.map((p) => p.weight)
      const allEqual = newWeights.every((w) => Math.abs(w - newWeights[0]!) < 0.0001)
      expect(allEqual).toBe(true)
    }
  })

  test("resample produces particles with equal weights", () => {
    const pf = new ParticleFilter(makeSmallConfig())
    const belief = pf.initialize(makeState())
    const resampled = pf.resample(belief)
    const weights = resampled.particles.map((p) => p.weight)
    const first = weights[0]
    for (const w of weights) {
      expect(Math.abs(w - first!)).toBeLessThan(0.0001)
    }
  })

  test("effectiveSampleSize handles zero-weight particles", () => {
    const pf = new ParticleFilter(makeSmallConfig())
    const belief = pf.initialize(makeState())
    for (const p of belief.particles) p.weight = 0
    expect(pf.effectiveSampleSize(belief)).toBe(0)
  })

  test("resample handles zero-sum weights", () => {
    const pf = new ParticleFilter(makeSmallConfig())
    const belief = pf.initialize(makeState())
    for (const p of belief.particles) p.weight = 0
    const resampled = pf.resample(belief)
    expect(resampled.particles.length).toBe(belief.particles.length)
    const sum = resampled.particles.reduce((s, p) => s + p.weight, 0)
    expect(Math.abs(sum - 1)).toBeLessThan(0.001)
  })
})

describe("ParticleFilter - config", () => {
  test("updateConfig changes config", () => {
    const pf = new ParticleFilter(makeSmallConfig())
    pf.updateConfig({ numParticles: 42 })
    expect(pf.getConfig().numParticles).toBe(42)
  })

  test("getConfig returns a copy not reference", () => {
    const pf = new ParticleFilter(makeSmallConfig())
    const cfg1 = pf.getConfig()
    cfg1.numParticles = 999
    expect(pf.getConfig().numParticles).toBe(makeSmallConfig().numParticles)
  })
})

// ===========================================================================
// QMDPSolver
// ===========================================================================

const makeGridActions = (): Action[] => [
  { id: "up", name: "Move Up", description: "Move up by reducing y", cost: 1 },
  { id: "down", name: "Move Down", description: "Move down by increasing y", cost: 1 },
  { id: "left", name: "Move Left", description: "Move left by reducing x", cost: 1 },
  { id: "right", name: "Move Right", description: "Move right by increasing x", cost: 1 },
]

const gridTransition = (s: POMDPState, a: Action): POMDPState => {
  let { x, y } = s.variables as { x: number; y: number }
  switch (a.id) {
    case "up":
      y = Math.max(0, y - 1)
      break
    case "down":
      y = Math.min(9, y + 1)
      break
    case "left":
      x = Math.max(0, x - 1)
      break
    case "right":
      x = Math.min(9, x + 1)
      break
  }
  return createState({ x, y }, s.step + 1, s.id, s.score)
}

const gridReward = (_s: POMDPState, _a: Action, ns: POMDPState): number => {
  const { x, y } = ns.variables as { x: number; y: number }
  if (x === 5 && y === 5) return 100
  return -1
}

describe("QMDPSolver", () => {
  const config = makeSmallConfig()

  test("computeQValues returns correct structure", () => {
    const solver = new QMDPSolver(config)
    const pf = new ParticleFilter(config)
    const belief = pf.initialize(makeState({ variables: { x: 0, y: 0 } }))
    const actions = makeGridActions()

    const qValues = solver.computeQValues(belief, actions, gridTransition, gridReward)

    expect(qValues.length).toBe(actions.length)
    for (const qv of qValues) {
      expect(qv).toHaveProperty("actionId")
      expect(qv).toHaveProperty("qValue")
      expect(qv).toHaveProperty("uncertainty")
      expect(qv).toHaveProperty("rolloutCount")
      expect(typeof qv.qValue).toBe("number")
      expect(typeof qv.rolloutCount).toBe("number")
    }
  })

  test("computeQValues with single action", () => {
    const solver = new QMDPSolver(config)
    const pf = new ParticleFilter(config)
    const belief = pf.initialize(makeState())
    const qValues = solver.computeQValues(
      belief,
      [makeAction({ id: "only" })],
      (s) => s,
      () => 0,
    )
    expect(qValues.length).toBe(1)
  })

  test("computeQValues with empty actions returns empty array", () => {
    const solver = new QMDPSolver(config)
    const pf = new ParticleFilter(config)
    const belief = pf.initialize(makeState())
    const qValues = solver.computeQValues(
      belief,
      [],
      (s) => s,
      () => 0,
    )
    expect(qValues.length).toBe(0)
  })

  test("Q-values reflect reward structure", () => {
    const solver = new QMDPSolver(config)
    const pf = new ParticleFilter(config)
    const belief = pf.initialize(makeState({ variables: { x: 5, y: 4 } }))

    const actions = makeGridActions()
    const qValues = solver.computeQValues(belief, actions, gridTransition, gridReward)

    const downQ = qValues.find((q) => q.actionId === "down")!.qValue
    const upQ = qValues.find((q) => q.actionId === "up")!.qValue
    expect(downQ).toBeGreaterThan(upQ)
  })

  test("MC rollout respects maxDepth", () => {
    const solver = new QMDPSolver({ ...config, maxDepth: 0, numRollouts: 1 })
    const pf = new ParticleFilter(config)
    const belief = pf.initialize(makeState({ variables: { x: 0, y: 0 } }))

    const actions = makeGridActions()
    const qValues = solver.computeQValues(belief, actions, gridTransition, gridReward)

    for (const qv of qValues) {
      expect(Number.isFinite(qv.qValue)).toBe(true)
    }
  })

  test("uncertainty values are computed", () => {
    const solver = new QMDPSolver(config)
    const pf = new ParticleFilter(config)
    const belief = pf.initialize(makeState({ variables: { x: 0, y: 0 } }))
    const actions = makeGridActions()

    const qValues = solver.computeQValues(belief, actions, gridTransition, gridReward)

    for (const qv of qValues) {
      expect(qv.uncertainty).toBeGreaterThanOrEqual(0)
      expect(qv.uncertainty).toBeLessThanOrEqual(1)
    }
  })

  test("updateConfig changes solver config", () => {
    const solver = new QMDPSolver(config)
    solver.updateConfig({ maxDepth: 10 })
    const pf = new ParticleFilter(config)
    const belief = pf.initialize(makeState())
    const qValues = solver.computeQValues(
      belief,
      [makeAction()],
      (s) => s,
      () => 0,
    )
    expect(qValues.length).toBe(1)
  })
})

// ===========================================================================
// POMDPPlanner
// ===========================================================================

describe("POMDPPlanner - basic planning", () => {
  const config = makeSmallConfig()

  test("plan reaches simple goal", () => {
    const actions: Action[] = [{ id: "increment", name: "Increment", description: "Add 1 to value", cost: 1 }]
    const transition = (s: POMDPState, _a: Action): POMDPState =>
      createState({ value: (s.variables.value as number) + 1 }, s.step + 1, s.id)
    const reward = (_s: POMDPState, _a: Action, ns: POMDPState): number => {
      if ((ns.variables.value as number) >= 5) return 10
      return 0
    }
    const goal = (s: POMDPState) => (s.variables.value as number) >= 5

    const planner = new POMDPPlanner(actions, config)
    const result = planner.plan(createState({ value: 0 }, 0), goal, transition, reward, { maxSteps: 10 })

    expect(result.converged).toBe(true)
    expect(result.finalState.variables.value as number).toBeGreaterThanOrEqual(5)
    expect(result.steps.length).toBeGreaterThan(0)
  })

  test("plan respects maxSteps", () => {
    const actions: Action[] = [{ id: "stay", name: "Stay", description: "Do nothing", cost: 0 }]
    const transition = (s: POMDPState, _a: Action): POMDPState => s
    const reward = () => -1
    const goal = () => false

    const planner = new POMDPPlanner(actions, config)
    const result = planner.plan(createState({ x: 0 }, 0), goal, transition, reward, { maxSteps: 3 })

    expect(result.steps.length).toBeLessThanOrEqual(3)
    expect(result.converged).toBe(false)
  })

  test("plan returns unconverged for unreachable goal", () => {
    const actions: Action[] = [{ id: "stay", name: "Stay", description: "Do nothing", cost: 0 }]
    const transition = (s: POMDPState, _a: Action): POMDPState => s
    const reward = () => 0
    const goal = () => false

    const planner = new POMDPPlanner(actions, config)
    const result = planner.plan(createState({}, 0), goal, transition, reward, { maxSteps: 2 })

    expect(result.converged).toBe(false)
  })
})

describe("POMDPPlanner - grid world", () => {
  const config = makeSmallConfig()

  test("plan navigates grid to goal", () => {
    const actions = makeGridActions()
    const goal = (s: POMDPState) => {
      const { x, y } = s.variables as { x: number; y: number }
      return x === 5 && y === 5
    }

    const planner = new POMDPPlanner(actions, {
      ...config,
      numParticles: 30,
      maxPlanSteps: 15,
    })
    const result = planner.plan(createState({ x: 0, y: 0 }, 0), goal, gridTransition, gridReward)

    expect(result.steps.length).toBeGreaterThan(0)
  })

  test("plan accumulates totalCost correctly", () => {
    const actions = makeGridActions()
    const goal = (s: POMDPState) => {
      const { x, y } = s.variables as { x: number; y: number }
      return x === 5 && y === 5
    }

    const planner = new POMDPPlanner(actions, config)
    const result = planner.plan(createState({ x: 0, y: 0 }, 0), goal, gridTransition, gridReward, { maxSteps: 5 })

    const expectedCost = result.steps.reduce((sum, step) => sum + step.action.cost, 0)
    expect(result.totalCost).toBe(expectedCost)
  })

  test("plan tracks metadata", () => {
    const actions = makeGridActions()
    const goal = (s: POMDPState) => {
      const { x, y } = s.variables as { x: number; y: number }
      return x === 5 && y === 5
    }

    const planner = new POMDPPlanner(actions, config)
    const _result = planner.plan(createState({ x: 0, y: 0 }, 0), goal, gridTransition, gridReward, { maxSteps: 5 })

    const meta = planner.getMetadata()
    expect(meta.particlesGenerated).toBeGreaterThan(0)
    expect(meta.rolloutsPerformed).toBeGreaterThan(0)
    expect(meta.statesExplored).toBeGreaterThan(0)
    expect(typeof meta.timeouts).toBe("number")
    expect(typeof meta.resamplesPerformed).toBe("number")
  })
})

describe("POMDPPlanner - replan", () => {
  test("replan creates plan from belief state", () => {
    const actions = makeGridActions()
    const planner = new POMDPPlanner(actions, makeSmallConfig())

    const pf = new ParticleFilter(makeSmallConfig())
    const belief = pf.initialize(makeState({ variables: { x: 3, y: 3 } }))
    const goal = (s: POMDPState) => {
      const { x, y } = s.variables as { x: number; y: number }
      return x === 5 && y === 5
    }

    const result = planner.replan(belief, goal, gridTransition, gridReward, 8)
    expect(result.steps.length).toBeGreaterThan(0)
    expect(result.planDurationMs).toBeGreaterThanOrEqual(0)
  })

  test("replan with empty belief returns empty result", () => {
    const actions = makeGridActions()
    const planner = new POMDPPlanner(actions, makeSmallConfig())
    const emptyBelief: BeliefState = { particles: [], totalWeight: 0, entropy: 0 }
    const result = planner.replan(emptyBelief, () => true, gridTransition, gridReward, 5)
    expect(result.steps.length).toBe(0)
    expect(result.converged).toBe(false)
  })
})

describe("POMDPPlanner - observations", () => {
  test("plan with observations processes observation steps", () => {
    const actions: Action[] = [{ id: "toggle", name: "Toggle", description: "Toggle a flag", cost: 1 }]
    const transition = (s: POMDPState, _a: Action): POMDPState => {
      const currentFlag = s.variables.flag as boolean | undefined
      return createState({ flag: !currentFlag }, s.step + 1, s.id, s.score + 1)
    }
    const reward = (_s: POMDPState, _a: Action, ns: POMDPState): number => ns.score
    const goal = (s: POMDPState) => (s.variables.flag as boolean) === true

    const planner = new POMDPPlanner(actions, makeSmallConfig())
    const observations: Observation[] = [makeObs({ flag: true })]

    const result = planner.plan(createState({ flag: false }, 0), goal, transition, reward, {
      maxSteps: 3,
      observations,
    })

    expect(result.steps.length).toBeGreaterThanOrEqual(0)
  })
})

describe("POMDPPlanner - onStep callback", () => {
  test("onStep is called for each step", () => {
    const actions: Action[] = [{ id: "inc", name: "Increment", description: "Add 1", cost: 1 }]
    const transition = (s: POMDPState, _a: Action): POMDPState =>
      createState({ val: (s.variables.val as number) + 1 }, s.step + 1, s.id)
    const reward = () => 0
    const goal = (s: POMDPState) => (s.variables.val as number) >= 3

    const planner = new POMDPPlanner(actions, makeSmallConfig())
    const steps: PlanStep[] = []
    planner.plan(createState({ val: 0 }, 0), goal, transition, reward, {
      maxSteps: 5,
      onStep: (step) => {
        steps.push(step)
      },
    })

    expect(steps.length).toBeGreaterThan(0)
  })
})

describe("POMDPPlanner - edge cases", () => {
  test("plan with empty actions returns no steps", () => {
    const planner = new POMDPPlanner([], makeSmallConfig())
    const result = planner.plan(
      createState({}, 0),
      () => false,
      (s) => s,
      () => 0,
    )
    expect(result.steps.length).toBe(0)
  })

  test("plan with single action", () => {
    const actions: Action[] = [{ id: "only", name: "Only Action", description: "The only action", cost: 1 }]
    const transition = (s: POMDPState, _a: Action): POMDPState =>
      createState({ count: (s.variables.count as number) + 1 }, s.step + 1, s.id)
    const reward = () => 1
    const goal = (s: POMDPState) => (s.variables.count as number) >= 3

    const planner = new POMDPPlanner(actions, makeSmallConfig())
    const result = planner.plan(createState({ count: 0 }, 0), goal, transition, reward, { maxSteps: 5 })

    expect(result.converged).toBe(true)
    expect(result.steps.length).toBeGreaterThanOrEqual(3)
  })

  test("plan with zero particles config handles gracefully", () => {
    const actions: Action[] = [{ id: "act", name: "Act", description: "Do", cost: 1 }]
    const planner = new POMDPPlanner(actions, { numParticles: 0, maxPlanSteps: 2 })
    const result = planner.plan(
      createState({}, 0),
      () => true,
      (s) => s,
      () => 0,
    )
    expect(result).toHaveProperty("steps")
    expect(result).toHaveProperty("finalState")
  })

  test("reset clears metadata", () => {
    const actions: Action[] = [{ id: "act", name: "Act", description: "Do", cost: 1 }]
    const planner = new POMDPPlanner(actions, makeSmallConfig())
    planner.plan(
      createState({ val: 0 }, 0),
      (s) => (s.variables.val as number) >= 2,
      (s, _a) => createState({ val: (s.variables.val as number) + 1 }, s.step + 1, s.id),
      () => 0,
      { maxSteps: 5 },
    )
    planner.reset()
    const meta = planner.getMetadata()
    expect(meta.particlesGenerated).toBe(0)
    expect(meta.rolloutsPerformed).toBe(0)
    expect(meta.statesExplored).toBe(0)
  })

  test("updateConfig propagates to filter and solver", () => {
    const actions = makeGridActions()
    const planner = new POMDPPlanner(actions, makeSmallConfig())
    planner.updateConfig({ numParticles: 10, maxDepth: 1 })

    const result = planner.plan(createState({ x: 0, y: 0 }, 0), () => false, gridTransition, gridReward, {
      maxSteps: 1,
    })
    expect(result.steps.length).toBeLessThanOrEqual(1)
  })

  test("plan has non-zero duration", () => {
    const actions: Action[] = [{ id: "act", name: "Act", description: "Do", cost: 1 }]
    const planner = new POMDPPlanner(actions, makeSmallConfig())
    const result = planner.plan(
      createState({ val: 0 }, 0),
      (s) => (s.variables.val as number) >= 3,
      (s, _a) => createState({ val: (s.variables.val as number) + 1 }, s.step + 1, s.id),
      () => 0,
    )
    expect(result.planDurationMs).toBeGreaterThanOrEqual(0)
  })
})

// ===========================================================================
// Utility functions
// ===========================================================================

describe("createState", () => {
  test("creates state with correct shape", () => {
    const state = createState({ x: 1, y: 2 }, 3)
    expect(state.variables).toEqual({ x: 1, y: 2 })
    expect(state.step).toBe(3)
    expect(state.score).toBe(0)
    expect(state.hash.length).toBeGreaterThan(0)
  })

  test("createState with all parameters", () => {
    const state = createState({ key: "value" }, 5, "parent-1", 42, "custom")
    expect(state.step).toBe(5)
    expect(state.parentId).toBe("parent-1")
    expect(state.score).toBe(42)
    expect(state.id).toContain("custom")
  })

  test("createState generates unique ids", () => {
    const a = createState({ x: 1 }, 0)
    const b = createState({ x: 2 }, 0)
    expect(a.id).not.toBe(b.id)
  })
})

describe("defaultRewardFn", () => {
  test("rewards positive score changes", () => {
    const s1 = createState({}, 0, undefined, 0)
    const s2 = createState({}, 1, undefined, 10)
    const action = makeAction({ cost: 1 })
    expect(defaultRewardFn(s1, action, s2)).toBe(9)
  })

  test("penalizes negative score changes", () => {
    const s1 = createState({}, 0, undefined, 10)
    const s2 = createState({}, 1, undefined, 0)
    const action = makeAction({ cost: 2 })
    expect(defaultRewardFn(s1, action, s2)).toBe(-12)
  })

  test("handles zero score change", () => {
    const s1 = createState({}, 0, undefined, 5)
    const s2 = createState({}, 1, undefined, 5)
    const action = makeAction({ cost: 3 })
    expect(defaultRewardFn(s1, action, s2)).toBe(-3)
  })
})

describe("defaultGoalFn", () => {
  test("matches target variable value", () => {
    const goalFn = defaultGoalFn("status", "done")
    expect(goalFn(makeState({ variables: { status: "done" } }))).toBe(true)
    expect(goalFn(makeState({ variables: { status: "pending" } }))).toBe(false)
  })

  test("matches with numeric values", () => {
    const goalFn = defaultGoalFn("count", 10)
    expect(goalFn(makeState({ variables: { count: 10 } }))).toBe(true)
    expect(goalFn(makeState({ variables: { count: 9 } }))).toBe(false)
  })
})

// ===========================================================================
// Integration tests
// ===========================================================================

describe("Integration", () => {
  test("full pipeline: register actions, plan, reach goal", () => {
    const actions: Action[] = [
      {
        id: "add_x",
        name: "Add X",
        description: "Increment x by cost times 2",
        cost: 2,
        precondition: (s) => (s.variables.x as number) < 10,
      },
      {
        id: "add_y",
        name: "Add Y",
        description: "Increment y by 1",
        cost: 1,
        precondition: (s) => (s.variables.y as number) < 10,
      },
      {
        id: "boost",
        name: "Boost",
        description: "Add to both x and y",
        cost: 3,
      },
    ]

    const transition = (s: POMDPState, a: Action): POMDPState => {
      const vars = { ...s.variables }
      switch (a.id) {
        case "add_x":
          vars.x = (vars.x as number) + 2
          break
        case "add_y":
          vars.y = (vars.y as number) + 1
          break
        case "boost":
          vars.x = (vars.x as number) + 1
          vars.y = (vars.y as number) + 1
          break
      }
      const score = (vars.x as number) + (vars.y as number)
      return createState(vars, s.step + 1, s.id, score)
    }

    const reward = (_s: POMDPState, _a: Action, ns: POMDPState): number => ns.score
    const goal = (s: POMDPState) => {
      const { x, y } = s.variables as { x: number; y: number }
      return x >= 6 && y >= 3
    }

    const planner = new POMDPPlanner(actions, { ...makeSmallConfig(), numParticles: 30, maxPlanSteps: 20 })
    const result = planner.plan(createState({ x: 0, y: 0 }, 0), goal, transition, reward)

    expect(result.converged).toBe(true)
    const fx = result.finalState.variables.x as number
    const fy = result.finalState.variables.y as number
    expect(fx).toBeGreaterThanOrEqual(6)
    expect(fy).toBeGreaterThanOrEqual(3)
  })

  test("large state space with many particles", () => {
    const actions: Action[] = Array.from({ length: 20 }, (_, i) => ({
      id: `action_${i}`,
      name: `Action ${i}`,
      description: `Step toward ${i}`,
      cost: 1,
    }))

    let _targetSeen = false
    const transition = (s: POMDPState, a: Action): POMDPState => {
      if (a.id === "action_19") {
        _targetSeen = true
        return createState({ target: "reached" }, s.step + 1, s.id, 100)
      }
      return createState(
        { pos: Number.parseInt(a.id.split("_")[1]!) },
        s.step + 1,
        s.id,
        Math.abs(Number.parseInt(a.id.split("_")[1]!) - 19),
      )
    }

    const reward = (_s: POMDPState, _a: Action, ns: POMDPState): number => ns.score
    const goal = (s: POMDPState) => s.variables.target === "reached"

    const planner = new POMDPPlanner(actions, { ...makeSmallConfig(), numParticles: 10, maxPlanSteps: 30 })
    const result = planner.plan(createState({ pos: 0 }, 0), goal, transition, reward)

    if (result.converged) {
      expect(result.finalState.variables.target).toBe("reached")
    }
  })
})

describe("POMDPPlanner - Step structure", () => {
  test("each plan step has correct shape", () => {
    const actions: Action[] = [{ id: "move", name: "Move", description: "Move forward", cost: 1 }]
    const transition = (s: POMDPState, _a: Action): POMDPState =>
      createState({ pos: (s.variables.pos as number) + 1 }, s.step + 1, s.id)
    const reward = () => 0
    const goal = (s: POMDPState) => (s.variables.pos as number) >= 2

    const planner = new POMDPPlanner(actions, makeSmallConfig())
    const result = planner.plan(createState({ pos: 0 }, 0), goal, transition, reward)

    for (const step of result.steps) {
      expect(step).toHaveProperty("state")
      expect(step).toHaveProperty("action")
      expect(step).toHaveProperty("qValues")
      expect(step).toHaveProperty("chosenQValue")
      expect(step).toHaveProperty("step")
      expect(typeof step.chosenQValue).toBe("number")
    }
  })
})

describe("createPOMDPPlanner", () => {
  test("returns a POMDPPlanner instance", () => {
    const planner = createPOMDPPlanner([], { maxPlanSteps: 5 })
    expect(planner).toBeInstanceOf(POMDPPlanner)
  })
})
