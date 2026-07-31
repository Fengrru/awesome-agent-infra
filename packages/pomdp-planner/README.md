# @fengru/pomdp-planner

[![npm version](https://img.shields.io/npm/v/@fengru/pomdp-planner)](https://www.npmjs.com/package/@fengru/pomdp-planner) [![npm downloads](https://img.shields.io/npm/dm/@fengru/pomdp-planner)](https://www.npmjs.com/package/@fengru/pomdp-planner) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)

> ⚠️ **Experimental** — API may break in minor versions. See [STABILITY.md](../../STABILITY.md).

Zero-dependency POMDP LLM planner with particle filter belief tracking and iterative rollout.

## Quick Start

```ts
import { POMDPPlanner, ParticleFilter, QMDPSolver, createState, defaultGoalFn, defaultRewardFn } from "@fengru/pomdp-planner"

const actions = [
  { id: "up", name: "Move Up", description: "Move up", cost: 1 },
  { id: "down", name: "Move Down", description: "Move down", cost: 1 },
  { id: "left", name: "Move Left", description: "Move left", cost: 1 },
  { id: "right", name: "Move Right", description: "Move right", cost: 1 },
]

const gridTransition = (state, action) => {
  let { x, y } = state.variables
  if (action.id === "up") y--
  if (action.id === "down") y++
  if (action.id === "left") x--
  if (action.id === "right") x++
  return createState({ x, y }, state.step + 1, state.id)
}

const planner = new POMDPPlanner(actions, { numParticles: 30, maxPlanSteps: 10 })
const result = planner.plan(
  createState({ x: 0, y: 0 }, 0),
  (s) => s.variables.x === 5 && s.variables.y === 5,
  gridTransition,
  (_, __, ns) => ns.variables.x === 5 && ns.variables.y === 5 ? 100 : -1,
)

console.log(result.converged, result.steps.length, result.totalCost)
```

## Architecture

- **ParticleFilter** — Belief state tracking using sequential importance resampling (SIR)
- **QMDPSolver** — Approximate POMDP solving via QMDP + Monte Carlo rollouts
- **POMDPPlanner** — Main planning engine combining belief tracking and QMDP solving

## Configuration

| Option              | Default | Description                        |
|---------------------|---------|------------------------------------|
| numParticles        | 100     | Particle count in belief state     |
| numRollouts         | 10      | MC rollouts per action             |
| maxDepth            | 5       | Max rollout depth                  |
| discountFactor      | 0.95    | Discount factor (gamma)            |
| explorationBonus    | 0.1     | UCB exploration probability        |
| resampleThreshold   | 0.5     | Resample when effective N < 0.5    |
| timeoutMs           | 30000   | Planning timeout                   |
| maxPlanSteps        | 20      | Max steps in plan                  |
| temperature         | 0.5     | Q-value softmax temperature        |


## Documentation

- [API Reference](https://fengrru.github.io/awesome-agent-infra/api/) — TypeDoc-generated API docs
- [Source Code](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/pomdp-planner)
- [Examples](https://github.com/Fengrru/awesome-agent-infra/tree/main/examples)
## License

MIT
