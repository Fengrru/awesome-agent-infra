import { describe, expect, test } from "bun:test"
import {
  type Capability,
  DAGGenerator,
  DAG_PROMPT_TEMPLATE,
  LLMDAGGenerator,
  type ProviderAdapter,
  createLLMDAGGenerator,
} from "../src/index"

function makeCapability(id: string, overrides?: Partial<Capability>): Capability {
  return {
    capability_id: id,
    name: `Cap ${id}`,
    risk_level: 0,
    tags: ["tag"],
    success_rate: 0.9,
    description: `does ${id}`,
    ...overrides,
  }
}

const VALID_DAG_JSON = JSON.stringify({
  nodes: [
    {
      node_id: "n1",
      capability_id: "read_file",
      inputs: { path: "a.ts" },
      dependencies: [],
      risk_level: 0,
      estimated_tokens: 200,
      estimated_duration_ms: 1000,
    },
    {
      node_id: "n2",
      capability_id: "write_file",
      inputs: {},
      dependencies: ["n1"],
      risk_level: 1,
      estimated_tokens: 300,
      estimated_duration_ms: 2000,
    },
  ],
  edges: [["n1", "n2"]],
})

function providerReturning(content: string): ProviderAdapter {
  return {
    async chat() {
      return { content }
    },
  }
}

describe("buildPrompt", () => {
  test("interpolates goal and capability list", () => {
    const gen = new DAGGenerator()
    const prompt = gen.buildPrompt("refactor auth", [
      makeCapability("read_file", { risk_level: 0, success_rate: 0.95 }),
    ])
    expect(prompt).toContain("Goal: refactor auth")
    expect(prompt).toContain("id=read_file")
    expect(prompt).toContain("success_rate=95%")
    expect(prompt).not.toContain("{{goal}}")
    expect(prompt).not.toContain("{{capabilities}}")
  })

  test("template exposes JSON output contract", () => {
    expect(DAG_PROMPT_TEMPLATE).toContain('"nodes"')
    expect(DAG_PROMPT_TEMPLATE).toContain('"edges"')
  })
})

describe("generateDAG with LLM caller", () => {
  test("parses valid LLM JSON into a typed DAG", async () => {
    const gen = new DAGGenerator()
    gen.setLLMCaller(async () => VALID_DAG_JSON)
    const dag = await gen.generateDAG("goal", [makeCapability("read_file")])

    expect(dag.version).toBe(1)
    expect(dag.nodes.length).toBe(2)
    expect(dag.nodes[0]!.node_id).toBe("n1")
    expect(dag.nodes[1]!.dependencies).toEqual(["n1"])
    expect(dag.nodes.every((n) => n.status === "pending")).toBe(true)
    expect(dag.edges).toEqual([["n1", "n2"]])
    expect(dag.metadata.goal).toBe("goal")
    expect(dag.metadata.strategy).toBe("STAGED")
  })

  test("extracts JSON embedded in prose (markdown fences)", async () => {
    const gen = new DAGGenerator()
    gen.setLLMCaller(async () => "Here is the plan:\n```json\n" + VALID_DAG_JSON + "\n```\nDone.")
    const dag = await gen.generateDAG("goal", [makeCapability("read_file")])
    expect(dag.nodes.length).toBe(2)
  })

  test("fills defaults for missing node fields", async () => {
    const gen = new DAGGenerator()
    gen.setLLMCaller(async () => JSON.stringify({ nodes: [{}], edges: [] }))
    const dag = await gen.generateDAG("goal", [])
    expect(dag.nodes[0]!.node_id).toBe("n1")
    expect(dag.nodes[0]!.capability_id).toBe("unknown")
    expect(dag.nodes[0]!.estimated_tokens).toBe(100)
    expect(dag.nodes[0]!.risk_level).toBe(0)
  })

  test("malformed edges are filtered out", async () => {
    const gen = new DAGGenerator()
    gen.setLLMCaller(async () => JSON.stringify({ nodes: [], edges: [["a", "b"], ["only-one"], "junk"] }))
    const dag = await gen.generateDAG("goal", [])
    expect(dag.edges).toEqual([["a", "b"]])
  })

  test("falls back to heuristic when LLM output is unparseable", async () => {
    const gen = new DAGGenerator()
    gen.setLLMCaller(async () => "I refuse to output JSON")
    const dag = await gen.generateDAG("goal", [makeCapability("a"), makeCapability("b")])
    expect(dag.nodes.length).toBe(2) // fallback chain from capabilities
  })

  test("falls back to heuristic when LLM caller throws", async () => {
    const gen = new DAGGenerator()
    gen.setLLMCaller(async () => {
      throw new Error("timeout")
    })
    const dag = await gen.generateDAG("goal", [makeCapability("a")])
    expect(dag.nodes.length).toBe(1)
    expect(dag.nodes[0]!.capability_id).toBe("a")
  })
})

describe("fallback DAG heuristic", () => {
  test("without LLM builds risk-sorted sequential chain capped at 5", async () => {
    const gen = new DAGGenerator()
    const caps = [
      makeCapability("destructive", { risk_level: 3 }),
      makeCapability("read", { risk_level: 0 }),
      makeCapability("modify", { risk_level: 1 }),
      makeCapability("global", { risk_level: 2 }),
      makeCapability("read2", { risk_level: 0 }),
      makeCapability("extra", { risk_level: 1 }),
    ]
    const dag = await gen.generateDAG("goal", caps)

    expect(dag.nodes.length).toBe(5) // capped
    // risk-sorted ascending: lowest risk first
    expect(dag.nodes[0]!.risk_level).toBe(0)
    expect(dag.nodes[4]!.risk_level).toBeGreaterThanOrEqual(dag.nodes[0]!.risk_level)
    // sequential chain: node i depends on node i-1
    expect(dag.nodes[0]!.dependencies).toEqual([])
    expect(dag.nodes[1]!.dependencies).toEqual(["n1"])
    expect(dag.edges.length).toBe(4)
  })

  test("empty capabilities produce empty DAG", async () => {
    const gen = new DAGGenerator()
    const dag = await gen.generateDAG("goal", [])
    expect(dag.nodes).toEqual([])
    expect(dag.edges).toEqual([])
  })
})

describe("generateReplanDAG", () => {
  test("replan uses LLM and bumps version and replan_count", async () => {
    const gen = new DAGGenerator()
    let capturedPrompt = ""
    gen.setLLMCaller(async (prompt) => {
      capturedPrompt = prompt
      return VALID_DAG_JSON
    })

    const dag = await gen.generateReplanDAG("goal", [makeCapability("a")], "disk full", ["n1"], "n2")
    expect(dag.version).toBe(2)
    expect(dag.metadata.replan_count).toBe(1)
    expect(capturedPrompt).toContain("disk full")
    expect(capturedPrompt).toContain("COMPLETED NODES: n1")
    expect(capturedPrompt).toContain('Node "n2" failed')
  })

  test("replan without LLM falls back to heuristic", async () => {
    const gen = new DAGGenerator()
    const dag = await gen.generateReplanDAG("goal", [makeCapability("a")], "err", [], "n1")
    expect(dag.nodes.length).toBe(1)
  })
})

describe("LLMDAGGenerator", () => {
  test("setProvider wires chat into DAG generation", async () => {
    const gen = new LLMDAGGenerator()
    gen.setProvider(providerReturning(VALID_DAG_JSON))
    const dag = await gen.generateDAG("goal", [makeCapability("a")])
    expect(dag.nodes.length).toBe(2)
  })

  test("without provider always uses fallback", async () => {
    const gen = new LLMDAGGenerator()
    const dag = await gen.generateDAG("goal", [makeCapability("a"), makeCapability("b")])
    expect(dag.nodes.length).toBe(2)
    expect(dag.metadata.strategy).toBe("STAGED")
  })

  test("generateKParallelDAGs produces k variants with namespaced node ids", async () => {
    const gen = new LLMDAGGenerator()
    gen.setProvider(providerReturning(VALID_DAG_JSON))
    const dags = await gen.generateKParallelDAGs("goal", [makeCapability("a")], 3)

    expect(dags.length).toBe(3)
    expect(dags[0]!.metadata.strategy).toBe("K_PARALLEL")
    expect(dags[0]!.nodes[0]!.node_id).toBe("k0_n0")
    expect(dags[2]!.nodes[0]!.node_id).toBe("k2_n0")
  })

  test("generateKParallelDAGs mixes fallback on provider errors", async () => {
    const gen = new LLMDAGGenerator()
    let calls = 0
    gen.setProvider({
      async chat() {
        calls++
        if (calls === 2) throw new Error("rate limited")
        return { content: VALID_DAG_JSON }
      },
    })
    const dags = await gen.generateKParallelDAGs("goal", [makeCapability("a")], 3)
    expect(dags.length).toBe(3)
    // variant 2 fell back to heuristic (1 node), variants 1 and 3 parsed (2 nodes)
    expect(dags[1]!.nodes.length).toBe(1)
    expect(dags[0]!.nodes.length).toBe(2)
  })

  test("generateKParallelDAGs without provider returns k fallbacks", async () => {
    const gen = new LLMDAGGenerator()
    const dags = await gen.generateKParallelDAGs("goal", [makeCapability("a")], 2)
    expect(dags.length).toBe(2)
    expect(dags.every((d) => d.nodes.length === 1)).toBe(true)
  })
})

describe("createLLMDAGGenerator factory", () => {
  test("creates generator with optional provider", async () => {
    const gen = createLLMDAGGenerator(providerReturning(VALID_DAG_JSON))
    const dag = await gen.generateDAG("goal", [makeCapability("a")])
    expect(dag.nodes.length).toBe(2)

    const bare = createLLMDAGGenerator()
    const fallback = await bare.generateDAG("goal", [makeCapability("a")])
    expect(fallback.nodes.length).toBe(1)
  })
})
