import { describe, expect, test } from "bun:test"
import {
  MaxModeSampler,
  DEFAULT_MAX_MODE_CONFIG,
  type Capability,
  type ProviderAdapter,
} from "../src/index"

function makeCapability(id: string): Capability {
  return { capability_id: id, description: `does ${id}` }
}

const CAPS = [makeCapability("read"), makeCapability("write")]

function candidateJSON(overrides?: Record<string, unknown>): string {
  return JSON.stringify({
    approach: "top-down decomposition",
    steps: [
      { order: 1, action: "analyze", expectedOutcome: "understanding", requiredCapabilities: ["read"] },
      { order: 2, action: "implement", expectedOutcome: "done", requiredCapabilities: ["write"] },
      { order: 3, action: "verify", expectedOutcome: "verified", requiredCapabilities: [] },
    ],
    complexity: 5,
    estimatedTurns: 8,
    risks: ["scope creep"],
    ...overrides,
  })
}

/** Provider that returns candidate JSON for generation and judge JSON for evaluation */
function makeProvider(judgeContent: string, candidateContent = candidateJSON()): ProviderAdapter & { calls: string[] } {
  const provider = {
    calls: [] as string[],
    async chat(params: { messages: Array<{ role: string; content: string }> }) {
      const system = params.messages[0]!.content
      provider.calls.push(system.includes("evaluator") ? "judge" : "candidate")
      return { content: system.includes("evaluator") ? judgeContent : candidateContent }
    },
  }
  return provider
}

describe("configuration", () => {
  test("defaults applied and overridable", () => {
    const sampler = new MaxModeSampler()
    expect(sampler.config.candidateCount).toBe(DEFAULT_MAX_MODE_CONFIG.candidateCount)
    expect(sampler.config.exploreTemperature).toBe(1.0)
    expect(sampler.config.judgeTemperature).toBe(0.0)

    const custom = new MaxModeSampler({ candidateCount: 2 })
    expect(custom.config.candidateCount).toBe(2)
  })
})

describe("sampleAndSelect without provider", () => {
  test("falls back to single heuristic candidate with score 100", async () => {
    const sampler = new MaxModeSampler()
    const result = await sampler.sampleAndSelect("build feature", CAPS)

    expect(result.allCandidates.length).toBe(1)
    expect(result.winner.id).toBe("candidate_heuristic")
    expect(result.winner.steps.length).toBe(4)
    expect(result.judgeResult.scores[result.winner.id]).toBe(100)
    expect(result.judgeResult.reasoning).toContain("Only one candidate")
  })
})

describe("sampleAndSelect with provider", () => {
  test("generates N candidates and selects the judge's pick", async () => {
    const judgeContent = JSON.stringify({
      selectedId: "candidate_1",
      rankings: ["candidate_1", "candidate_0", "candidate_2"],
      scores: { candidate_1: 90, candidate_0: 80, candidate_2: 70 },
      reasoning: "candidate_1 balances risk",
    })
    const provider = makeProvider(judgeContent)
    const sampler = new MaxModeSampler({ candidateCount: 3 })
    sampler.setProvider(provider)

    const result = await sampler.sampleAndSelect("build feature", CAPS)
    expect(result.allCandidates.length).toBe(3)
    expect(result.winner.id).toBe("candidate_1")
    expect(result.judgeResult.reasoning).toBe("candidate_1 balances risk")
    expect(provider.calls.filter((c) => c === "candidate").length).toBe(3)
    expect(provider.calls.filter((c) => c === "judge").length).toBe(1)
  })

  test("unknown selectedId from judge falls back to first candidate", async () => {
    const judgeContent = JSON.stringify({
      selectedId: "candidate_999",
      rankings: [],
      scores: {},
      reasoning: "confused judge",
    })
    const provider = makeProvider(judgeContent)
    const sampler = new MaxModeSampler({ candidateCount: 2 })
    sampler.setProvider(provider)

    const result = await sampler.sampleAndSelect("goal", CAPS)
    expect(result.winner.id).toBe("candidate_0")
  })

  test("garbage judge output falls back to heuristic judging", async () => {
    const provider = makeProvider("no json here")
    const sampler = new MaxModeSampler({ candidateCount: 2 })
    sampler.setProvider(provider)

    const result = await sampler.sampleAndSelect("goal", CAPS)
    expect(result.judgeResult.reasoning).toContain("Heuristic selection")
    expect(result.judgeResult.rankings.length).toBe(2)
  })

  test("partial candidate failures are tolerated", async () => {
    let call = 0
    const provider: ProviderAdapter = {
      async chat(params) {
        const system = params.messages[0]!.content
        if (system.includes("evaluator")) {
          return {
            content: JSON.stringify({
              selectedId: "candidate_0", rankings: ["candidate_0"], scores: { candidate_0: 80 }, reasoning: "ok",
            }),
          }
        }
        call++
        if (call === 2) throw new Error("rate limit")
        return { content: candidateJSON() }
      },
    }
    const sampler = new MaxModeSampler({ candidateCount: 3 })
    sampler.setProvider(provider)

    const result = await sampler.sampleAndSelect("goal", CAPS)
    expect(result.allCandidates.length).toBe(2) // one failed
  })

  test("all candidates failing throws a clear error", async () => {
    const provider: ProviderAdapter = {
      async chat() { throw new Error("total outage") },
    }
    const sampler = new MaxModeSampler({ candidateCount: 2 })
    sampler.setProvider(provider)

    await expect(sampler.sampleAndSelect("goal", CAPS)).rejects.toThrow(
      "failed to generate any candidates",
    )
  })

  test("single successful candidate skips judging", async () => {
    const provider = makeProvider("should never be called")
    const sampler = new MaxModeSampler({ candidateCount: 1 })
    sampler.setProvider(provider)

    const result = await sampler.sampleAndSelect("goal", CAPS)
    expect(result.winner.id).toBe("candidate_0")
    expect(provider.calls).toEqual(["candidate"]) // no judge call
  })
})

describe("candidate parsing", () => {
  test("clamps out-of-range complexity and estimatedTurns", async () => {
    const provider = makeProvider(
      JSON.stringify({ selectedId: "candidate_0", rankings: [], scores: {}, reasoning: "" }),
      candidateJSON({ complexity: 42, estimatedTurns: -5 }),
    )
    const sampler = new MaxModeSampler({ candidateCount: 1 })
    sampler.setProvider(provider)

    const result = await sampler.sampleAndSelect("goal", CAPS)
    expect(result.winner.complexity).toBe(10) // clamped to max
    expect(result.winner.estimatedTurns).toBe(1) // clamped to min
  })

  test("non-numeric fields fall back to defaults", async () => {
    const provider = makeProvider(
      "irrelevant",
      candidateJSON({ complexity: "very hard", estimatedTurns: null, steps: "oops", risks: null }),
    )
    const sampler = new MaxModeSampler({ candidateCount: 1 })
    sampler.setProvider(provider)

    const result = await sampler.sampleAndSelect("goal", CAPS)
    expect(result.winner.complexity).toBe(5)
    expect(result.winner.steps).toEqual([])
    expect(result.winner.risks).toEqual([])
  })

  test("keeps raw LLM text for audit", async () => {
    const provider = makeProvider("irrelevant")
    const sampler = new MaxModeSampler({ candidateCount: 1 })
    sampler.setProvider(provider)

    const result = await sampler.sampleAndSelect("goal", CAPS)
    expect(result.winner.raw).toBe(candidateJSON())
  })
})

describe("heuristic judge scoring", () => {
  test("rewards moderate complexity, step count and risk awareness", async () => {
    // two candidates, judged heuristically via garbage judge output
    let call = 0
    const provider: ProviderAdapter = {
      async chat(params) {
        const system = params.messages[0]!.content
        if (system.includes("evaluator")) return { content: "garbage" }
        call++
        return {
          content: call === 1
            ? candidateJSON() // complexity 5, 3 steps, has risks → high score
            : candidateJSON({ complexity: 10, steps: [], risks: [], estimatedTurns: 99 }), // low score
        }
      },
    }
    const sampler = new MaxModeSampler({ candidateCount: 2 })
    sampler.setProvider(provider)

    const result = await sampler.sampleAndSelect("goal", CAPS)
    expect(result.winner.id).toBe("candidate_0")
    expect(result.judgeResult.scores["candidate_0"]!).toBeGreaterThan(
      result.judgeResult.scores["candidate_1"]!,
    )
  })
})
