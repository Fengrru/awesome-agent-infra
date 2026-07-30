/**
 * Benchmark: pomdp-planner
 *
 * Measures performance of POMDP operations:
 * - Particle filter initialize & update (100/500/1000 particles)
 * - QMDP value computation
 * - Belief state sampling / resampling
 * - Effective sample size & entropy computation
 *
 * NOTE: This is a benchmark file, not a strict correctness test.
 * Run with: bun test packages/pomdp-planner/__tests__/benchmark.test.ts
 */

import { describe, test } from "bun:test"
import {
  ParticleFilter,
  QMDPSolver,
  ActionRegistry,
  createState,
  defaultRewardFn,
  StateHasher,
} from "../src/index"
import type {
  POMDPState,
  Action,
  Observation,
  BeliefState,
} from "../src/index"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function measure(label: string, fn: () => void, iterations = 100): { opsPerSec: number; avgMs: number; totalMs: number } {
  const start = performance.now()
  for (let i = 0; i < iterations; i++) fn()
  const totalMs = performance.now() - start
  return {
    opsPerSec: Math.round(iterations / (totalMs / 1000)),
    avgMs: totalMs / iterations,
    totalMs,
  }
}

function makeInitialState(): POMDPState {
  return createState({
    position: 0,
    velocity: 0,
    targetFound: false,
    energy: 100,
  }, 0, undefined, 0, "robot")
}

function makeActions(): Action[] {
  return [
    {
      id: "move_forward",
      name: "Move Forward",
      description: "Move the robot forward by one unit",
      cost: 1,
    },
    {
      id: "move_backward",
      name: "Move Backward",
      description: "Move the robot backward by one unit",
      cost: 1,
    },
    {
      id: "turn_left",
      name: "Turn Left",
      description: "Rotate the robot 90 degrees left",
      cost: 0.5,
    },
    {
      id: "turn_right",
      name: "Turn Right",
      description: "Rotate the robot 90 degrees right",
      cost: 0.5,
    },
    {
      id: "scan",
      name: "Scan Environment",
      description: "Use sensors to scan the surrounding area",
      cost: 2,
    },
    {
      id: "charge",
      name: "Charge Battery",
      description: "Return to dock and recharge energy",
      cost: 5,
    },
    {
      id: "grab_object",
      name: "Grab Object",
      description: "Pick up the target object if in range",
      cost: 3,
    },
    {
      id: "drop_object",
      name: "Drop Object",
      description: "Release the currently held object",
      cost: 1,
    },
  ]
}

function stateTransition(state: POMDPState, action: Action): POMDPState {
  const vars = { ...state.variables }
  if (action.id === "move_forward") {
    vars.position = (vars.position as number) + 1
    vars.energy = Math.max(0, (vars.energy as number) - 0.2)
  } else if (action.id === "move_backward") {
    vars.position = (vars.position as number) - 1
    vars.energy = Math.max(0, (vars.energy as number) - 0.2)
  } else if (action.id === "scan") {
    if (Math.random() < 0.3) vars.targetFound = true
    vars.energy = Math.max(0, (vars.energy as number) - 0.5)
  } else if (action.id === "charge") {
    vars.energy = 100
  }
  vars.position = (vars.position as number) + (Math.random() - 0.5) * 0.1 // process noise
  return createState(vars, state.step + 1, state.id)
}

function rewardFn(state: POMDPState, action: Action, nextState: POMDPState): number {
  return defaultRewardFn(state, action, nextState)
}

function makeObservation(data: Record<string, unknown> = {}): Observation {
  return {
    id: `obs_${Date.now()}`,
    text: "Sensor reading",
    data: {
      position: 5,
      energy: 80,
      ...data,
    },
    timestamp: Date.now(),
  }
}

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

describe("benchmark: particle filter initialize", () => {
  for (const numParticles of [100, 500, 1000]) {
    test(`initialize ${numParticles} particles`, () => {
      const config = { numParticles }
      const filter = new ParticleFilter(config)
      const initialState = makeInitialState()

      const result = measure("", () => filter.initialize(initialState), numParticles >= 500 ? 20 : 50)
      console.log(`  ${numParticles} particles: ${result.avgMs.toFixed(3)}ms avg`)
    })
  }
})

describe("benchmark: particle filter predict", () => {
  for (const numParticles of [100, 500, 1000]) {
    test(`predict step with ${numParticles} particles`, () => {
      const config = { numParticles }
      const filter = new ParticleFilter(config)
      const initialState = makeInitialState()
      const belief = filter.initialize(initialState)
      const action = makeActions()[0]!

      const result = measure("", () => filter.predict(belief, action, stateTransition), numParticles >= 500 ? 20 : 50)
      console.log(`  ${numParticles} particles: ${result.avgMs.toFixed(3)}ms avg`)
    })
  }
})

describe("benchmark: particle filter update (predict + weight + resample)", () => {
  for (const numParticles of [100, 500, 1000]) {
    test(`full update with ${numParticles} particles`, () => {
      const config = { numParticles, resampleThreshold: 0.3 }
      const filter = new ParticleFilter(config)
      const initialState = makeInitialState()
      const belief = filter.initialize(initialState)
      const action = makeActions()[0]!
      const observation = makeObservation()

      const result = measure("", () => filter.update(belief, action, observation, stateTransition), numParticles >= 500 ? 10 : 30)
      console.log(`  ${numParticles} particles: ${result.avgMs.toFixed(3)}ms avg`)
    })
  }
})

describe("benchmark: resample", () => {
  for (const numParticles of [100, 500, 1000]) {
    test(`resample ${numParticles} particles`, () => {
      const config = { numParticles }
      const filter = new ParticleFilter(config)
      const initialState = makeInitialState()
      const belief = filter.initialize(initialState)
      // Give particles varied weights to trigger a non-trivial resample
      for (const p of belief.particles) {
        p.weight = Math.random()
      }

      const result = measure("", () => filter.resample(belief), numParticles >= 500 ? 20 : 50)
      console.log(`  ${numParticles} particles: ${result.avgMs.toFixed(3)}ms avg`)
    })
  }
})

describe("benchmark: effective sample size & entropy", () => {
  test("compute ESS on 1000-particle belief", () => {
    const filter = new ParticleFilter({ numParticles: 1000 })
    const initialState = makeInitialState()
    const belief = filter.initialize(initialState)
    for (const p of belief.particles) {
      p.weight = Math.random()
    }
    // Normalize
    const total = belief.particles.reduce((s, p) => s + p.weight, 0)
    for (const p of belief.particles) p.weight /= total

    const result = measure("", () => {
      filter.effectiveSampleSize(belief)
      filter.computeEntropy(belief)
    }, 500)
    console.log(`  ESS + entropy (1000 particles): ${result.avgMs.toFixed(4)}ms avg`)
  })
})

describe("benchmark: QMDP value computation", () => {
  for (const numParticles of [100, 500, 1000]) {
    test(`QMDP computeQValues with ${numParticles} particles`, () => {
      const config = { numParticles, numRollouts: 5, maxDepth: 3 }
      const solver = new QMDPSolver(config)
      const filter = new ParticleFilter(config)
      const initialState = makeInitialState()
      const belief = filter.initialize(initialState)
      const actions = makeActions()

      const result = measure("", () => solver.computeQValues(belief, actions, stateTransition, rewardFn), numParticles >= 500 ? 5 : 15)
      console.log(`  ${numParticles} particles × ${actions.length} actions: ${result.avgMs.toFixed(3)}ms avg`)
    })
  }
})

describe("benchmark: QMDP per-action estimate", () => {
  test("QMDP estimate with 100 particles × 10 rollouts", () => {
    const config = { numParticles: 100, numRollouts: 10, maxDepth: 3 }
    const solver = new QMDPSolver(config)
    const filter = new ParticleFilter(config)
    const initialState = makeInitialState()
    const belief = filter.initialize(initialState)
    const action = makeActions()[0]!
    const actions = makeActions()

    // Access private qmdpEstimate via any cast
    const result = measure("", () => (solver as any).qmdpEstimate(belief, action, actions, stateTransition, rewardFn), 5)
    console.log(`  100 particles × 10 rollouts: ${result.avgMs.toFixed(3)}ms avg`)
  })
})

describe("benchmark: state hashing", () => {
  test("hash 1000 state objects", () => {
    const states = Array.from({ length: 1000 }, (_, i) =>
      createState({
        x: i,
        y: i * 2,
        name: `state_${i}`,
        active: i % 2 === 0,
        tags: ["a", "b", "c"],
      }, 0)
    )

    const result = measure("", () => {
      for (const s of states) StateHasher.hash(s)
    }, 10)
    console.log(`  1000 hashes: ${result.avgMs.toFixed(3)}ms avg`)
  })
})

describe("benchmark: ActionRegistry", () => {
  test("getApplicable with 50 actions", () => {
    const registry = new ActionRegistry()
    for (let i = 0; i < 50; i++) {
      registry.register({
        id: `action_${i}`,
        name: `Action ${i}`,
        description: `Action number ${i}`,
        precondition: i % 5 === 0 ? (s: POMDPState) => (s.variables.energy as number) > 10 : undefined,
        cost: 1,
      })
    }
    const state = makeInitialState()

    const result = measure("", () => registry.getApplicable(state), 2000)
    console.log(`  getApplicable (50 actions): ${result.opsPerSec.toLocaleString()} ops/sec, avg ${(result.avgMs * 1000).toFixed(3)}us`)
  })
})

describe("benchmark: belief state sampling", () => {
  for (const numParticles of [100, 500, 1000]) {
    test(`sample from belief with ${numParticles} particles`, () => {
      const filter = new ParticleFilter({ numParticles })
      const initialState = makeInitialState()
      const belief = filter.initialize(initialState)
      // Weighted distribution
      for (const p of belief.particles) {
        p.weight = Math.random()
      }
      const total = belief.particles.reduce((s, p) => s + p.weight, 0)
      for (const p of belief.particles) p.weight /= total

      const result = measure("", () => {
        // Weighted random sampling: select particle by cumulative weight
        const r = Math.random()
        let cum = 0
        for (const p of belief.particles) {
          cum += p.weight
          if (r <= cum) break
        }
      }, numParticles >= 500 ? 1000 : 5000)
      console.log(`  ${numParticles} particles: ${result.opsPerSec.toLocaleString()} ops/sec, avg ${(result.avgMs * 1000).toFixed(3)}us`)
    })
  }
})
