/**
 * Benchmark: reasoning-search
 *
 * Measures performance of MCTS tree operations:
 * - Tree construction (100, 500, 1000 nodes)
 * - Best-child selection (UCT)
 * - Backpropagation
 * - Softmax reward computation
 * - Adaptive floor
 * - Full MCTS simulation (50 iterations, mock generateFn/scoreFn)
 *
 * NOTE: This is a benchmark file, not a strict correctness test.
 * Run with: bun test packages/reasoning-search/__tests__/benchmark.test.ts
 */

import { describe, test } from "bun:test"
import { adaptiveFloor, createNode, selectBestChild, softmaxRewards, uctValue } from "../src/index"
import { resetNodeCounter } from "../src/utils"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function measure(
  label: string,
  fn: () => void,
  iterations = 100,
): { opsPerSec: number; avgMs: number; totalMs: number } {
  const start = performance.now()
  for (let i = 0; i < iterations; i++) fn()
  const totalMs = performance.now() - start
  return {
    opsPerSec: Math.round(iterations / (totalMs / 1000)),
    avgMs: totalMs / iterations,
    totalMs,
  }
}

function makeDeepTree(nodeCount: number) {
  resetNodeCounter()
  const root = createNode("root state", null, null)
  const nodes = [root]
  let parent = root
  // Build a deep chain with branching at each level (beam width = 3)
  while (nodes.length < nodeCount) {
    const remaining = nodeCount - nodes.length
    const branchFactor = Math.min(3, Math.max(1, Math.ceil(remaining / 2)))
    for (let i = 0; i < branchFactor && nodes.length < nodeCount; i++) {
      const child = createNode(`state at depth ${parent.depth + 1} branch ${i}`, `step-${parent.depth}-${i}`, parent)
      parent.children.push(child)
      nodes.push(child)
    }
    // Move to first child to grow deeper
    if (parent.children.length > 0) parent = parent.children[0]!
  }
  return { root, nodes }
}

function makeWideTree(nodeCount: number, branchFactor = 4) {
  resetNodeCounter()
  const root = createNode("root", null, null)
  const queue = [root]
  const allNodes = [root]
  while (allNodes.length < nodeCount && queue.length > 0) {
    const parent = queue.shift()!
    for (let i = 0; i < branchFactor && allNodes.length < nodeCount; i++) {
      const child = createNode(`state d${parent.depth + 1}_b${i}`, `step-${parent.depth}-${i}`, parent)
      parent.children.push(child)
      allNodes.push(child)
      queue.push(child)
    }
  }
  return { root, nodes: allNodes }
}

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

describe("benchmark: tree construction", () => {
  for (const nodeCount of [100, 500, 1000]) {
    test(`deep chain: ${nodeCount} nodes`, () => {
      const result = measure("", () => makeDeepTree(nodeCount), 20)
      console.log(
        `  deep ${nodeCount} nodes: ${result.opsPerSec.toLocaleString()} ops/sec, avg ${result.avgMs.toFixed(3)}ms`,
      )
    })

    test(`wide tree (bf=4): ${nodeCount} nodes`, () => {
      const result = measure("", () => makeWideTree(nodeCount, 4), 20)
      console.log(
        `  wide ${nodeCount} nodes: ${result.opsPerSec.toLocaleString()} ops/sec, avg ${result.avgMs.toFixed(3)}ms`,
      )
    })
  }
})

describe("benchmark: best-child selection (UCT)", () => {
  for (const branchFactor of [10, 50, 200]) {
    test(`select best among ${branchFactor} children`, () => {
      resetNodeCounter()
      const root = createNode("root", null, null)
      root.visits = 500
      for (let i = 0; i < branchFactor; i++) {
        const child = createNode(`child-${i}`, `action-${i}`, root)
        child.visits = Math.floor(Math.random() * 100) + 1
        child.value = Math.random() * child.visits
        root.children.push(child)
      }

      const result = measure("", () => selectBestChild(root, Math.SQRT2), 5000)
      console.log(
        `  branchFactor=${branchFactor}: ${result.opsPerSec.toLocaleString()} ops/sec, avg ${(result.avgMs * 1000).toFixed(3)}us`,
      )
    })
  }
})

describe("benchmark: UCT value computation", () => {
  resetNodeCounter()
  const node = createNode("test", "action", null)
  node.visits = 10
  node.value = 5
  const parentVisits = 100

  test("UCT value (micro-benchmark)", () => {
    const result = measure(
      "",
      () => {
        uctValue(node, parentVisits, Math.SQRT2)
      },
      50000,
    )
    console.log(`  UCT: ${result.opsPerSec.toLocaleString()} ops/sec, avg ${(result.avgMs * 1000).toFixed(3)}us`)
  })
})

describe("benchmark: backpropagation", () => {
  for (const depth of [5, 20, 100]) {
    test(`backprop through ${depth} levels`, () => {
      resetNodeCounter()
      const root = createNode("root", null, null)
      let current = root
      for (let i = 0; i < depth; i++) {
        const child = createNode(`layer-${i}`, `action-${i}`, current)
        current.children.push(child)
        current = child
      }

      const result = measure(
        "",
        () => {
          let node: typeof root | null = current
          let reward = 1.0
          while (node !== null) {
            node.visits++
            node.value += reward
            reward *= 0.95
            node = node.parent
          }
        },
        2000,
      )
      console.log(`  depth=${depth}: ${result.opsPerSec.toLocaleString()} ops/sec, avg ${result.avgMs.toFixed(3)}ms`)
    })
  }
})

describe("benchmark: softmax rewards", () => {
  for (const numScores of [50, 200, 1000]) {
    test(`softmax on ${numScores} scores`, () => {
      const scores = Array.from({ length: numScores }, () => Math.random())

      const result = measure("", () => softmaxRewards(scores, 2.0), 500)
      console.log(
        `  ${numScores} scores: ${result.opsPerSec.toLocaleString()} ops/sec, avg ${result.avgMs.toFixed(4)}ms`,
      )
    })
  }
})

describe("benchmark: adaptive floor", () => {
  test("adaptiveFloor micro-benchmark", () => {
    const result = measure(
      "",
      () => {
        for (let d = 0; d < 100; d++) adaptiveFloor(d, 0.95)
      },
      1000,
    )
    console.log(`  floor (100 depths): ${result.opsPerSec.toLocaleString()} ops/sec, avg ${result.avgMs.toFixed(4)}ms`)
  })
})

describe("benchmark: full MCTS simulation (mock)", () => {
  for (const iterations of [10, 50, 100]) {
    test(`MCTS ${iterations} iterations`, async () => {
      resetNodeCounter()
      const root = createNode("problem: prove x + 0 = x", null, null)
      const explorationConstant = Math.SQRT2

      const mockGenerate = async (_prompt: string, n: number): Promise<string[]> =>
        Array.from({ length: Math.min(n, 3) }, (_, i) => `step-${i}: reasoning in progress...`)

      const mockScore = (_state: string, _action: string): number => 0.4 + Math.random() * 0.3

      const start = performance.now()

      for (let iter = 0; iter < iterations; iter++) {
        // Selection
        let node = root
        while (node.children.length > 0 && node.children.every((c) => c.visits > 0)) {
          node = selectBestChild(node, explorationConstant)
        }

        // Expansion
        if (node.depth < 15) {
          const candidates = await mockGenerate(node.state, 3)
          for (const candidate of candidates) {
            const child = createNode(node.state + "\n" + candidate, candidate, node)
            node.children.push(child)
          }

          if (node.children.length > 0) {
            // Simulation
            const unvisited = node.children.filter((c) => c.visits === 0)
            const selected =
              unvisited.length > 0
                ? unvisited[Math.floor(Math.random() * unvisited.length)]!
                : node.children[Math.floor(Math.random() * node.children.length)]!

            const reward = mockScore(selected.state, selected.action ?? "")
            // Backpropagation
            let current: typeof selected | null = selected
            while (current !== null) {
              current.visits++
              current.value += reward
              current = current.parent
            }
          }
        }
      }

      const totalMs = performance.now() - start
      console.log(
        `  ${iterations} iter: ${totalMs.toFixed(1)}ms total, avg ${(totalMs / iterations).toFixed(2)}ms/iter`,
      )
    })
  }
})
