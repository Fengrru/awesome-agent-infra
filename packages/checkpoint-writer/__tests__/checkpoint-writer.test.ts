import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  CheckpointWriter,
  DEFAULT_WRITER_CONFIG,
  type Discovery,
  type IProjectMemoryWriter,
  type ProviderAdapter,
  type StructuredCheckpoint,
} from "../src/index"

async function withTempWriter(
  fn: (writer: CheckpointWriter, outputDir: string) => Promise<void>,
): Promise<void> {
  const outputDir = await mkdtemp(join(tmpdir(), "ckwriter-test-"))
  const writer = new CheckpointWriter({ outputDir })
  try {
    await fn(writer, outputDir)
  } finally {
    await rm(outputDir, { recursive: true, force: true })
  }
}

function llmFields(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    current_intent: "refactor auth module",
    next_action: "run the test suite",
    working_constraints: ["no new deps"],
    task_tree: [
      { id: "t1", description: "root", status: "in_progress", children: [{ id: "t2", description: "child", status: "pending", children: [] }] },
    ],
    current_work: [{ turn_number: 3, action: "edited file", result_summary: "ok", files_changed: ["src/auth.ts"] }],
    involved_files: [{ path: "src/auth.ts", role: "modified", summary: "token refresh" }],
    cross_task_discoveries: [],
    errors_and_fixes: [{ error_summary: "TS2345", root_cause: "bad type", fix_applied: "cast", verified: true }],
    runtime_state: { current_branch: "main", active_ports: [3000] },
    design_decisions: [{ id: "d1", decision: "use JWT", rationale: "stateless", alternatives_considered: ["sessions"], timestamp: "2026-01-01" }],
    miscellaneous_notes: ["remember to bump version"],
    ...overrides,
  }
}

function makeProvider(content: string): ProviderAdapter & { calls: number } {
  const provider = {
    calls: 0,
    async chat() {
      provider.calls++
      return { content }
    },
  }
  return provider
}

class FakeMemoryWriter implements IProjectMemoryWriter {
  promoted: Array<{ sessionId: string; discovery: Discovery; stabilityCount: number }> = []
  async promoteFact(sessionId: string, discovery: Discovery, stabilityCount: number): Promise<void> {
    this.promoted.push({ sessionId, discovery, stabilityCount })
  }
}

const HISTORY = [
  { role: "user", content: "please fix src/auth.ts" },
  { role: "assistant", content: "done, but hit an error: TS2345 in src/auth.ts" },
]

describe("configuration", () => {
  test("defaults are applied and overridable", () => {
    const writer = new CheckpointWriter()
    expect(writer.config.outputDir).toBe(DEFAULT_WRITER_CONFIG.outputDir)
    expect(writer.config.maxTokens).toBe(4096)

    const custom = new CheckpointWriter({ maxTokens: 1024 })
    expect(custom.config.maxTokens).toBe(1024)
    expect(custom.config.temperature).toBe(DEFAULT_WRITER_CONFIG.temperature)
  })
})

describe("write with provider", () => {
  test("writes JSON + Markdown files and returns the JSON path", async () => {
    await withTempWriter(async (writer, outputDir) => {
      writer.setProvider(makeProvider(JSON.stringify(llmFields())))
      const path = await writer.write("sess1", HISTORY, false, 0)

      expect(path).toBe(join(outputDir, "sess1", "checkpoint_v1_cycle0.json"))
      const files = await readdir(join(outputDir, "sess1"))
      expect(files.sort()).toEqual(["checkpoint.md", "checkpoint_v1_cycle0.json"])

      const cp = JSON.parse(await readFile(path, "utf-8")) as StructuredCheckpoint
      expect(cp.version).toBe(1)
      expect(cp.session_id).toBe("sess1")
      expect(cp.is_incremental).toBe(false)
      expect(cp.fields.current_intent).toBe("refactor auth module")
      expect(cp.fields.task_tree[0]!.children[0]!.id).toBe("t2")
    })
  })

  test("markdown checkpoint renders the 11 sections", async () => {
    await withTempWriter(async (writer, outputDir) => {
      writer.setProvider(makeProvider(JSON.stringify(llmFields())))
      await writer.write("sess1", HISTORY, false, 0)

      const md = await readFile(join(outputDir, "sess1", "checkpoint.md"), "utf-8")
      expect(md).toContain("# Session Checkpoint")
      expect(md).toContain("## Current Intent")
      expect(md).toContain("refactor auth module")
      expect(md).toContain("- ● root")
      expect(md).toContain("  - ○ child")
      expect(md).toContain("**TS2345** → cast ✓")
      expect(md).toContain("- current_branch: \"main\"")
      expect(md).toContain("## Miscellaneous Notes")
    })
  })

  test("version increments across writes and previousCheckpoint updates", async () => {
    await withTempWriter(async (writer, outputDir) => {
      writer.setProvider(makeProvider(JSON.stringify(llmFields())))
      await writer.write("sess1", HISTORY, false, 0)
      const path2 = await writer.write("sess1", HISTORY, true, 1)

      expect(path2).toBe(join(outputDir, "sess1", "checkpoint_v2_cycle1.json"))
      expect(writer.getPreviousCheckpoint()!.version).toBe(2)
      expect(writer.getPreviousCheckpoint()!.is_incremental).toBe(true)
    })
  })

  test("JSON embedded in surrounding prose is still extracted", async () => {
    await withTempWriter(async (writer) => {
      const content = `Here is the checkpoint:\n${JSON.stringify(llmFields())}\nHope that helps!`
      writer.setProvider(makeProvider(content))
      const path = await writer.write("sess1", HISTORY, false, 0)
      const cp = JSON.parse(await readFile(path, "utf-8")) as StructuredCheckpoint
      expect(cp.fields.next_action).toBe("run the test suite")
    })
  })

  test("provider error falls back to regex extraction", async () => {
    await withTempWriter(async (writer) => {
      const provider: ProviderAdapter = {
        async chat() { throw new Error("outage") },
      }
      writer.setProvider(provider)
      const path = await writer.write("sess1", HISTORY, false, 0)
      const cp = JSON.parse(await readFile(path, "utf-8")) as StructuredCheckpoint
      expect(cp.fields.current_intent).toContain("no LLM available")
    })
  })

  test("garbage LLM output falls back to regex extraction", async () => {
    await withTempWriter(async (writer) => {
      writer.setProvider(makeProvider("sorry, I can't do that"))
      const path = await writer.write("sess1", HISTORY, false, 0)
      const cp = JSON.parse(await readFile(path, "utf-8")) as StructuredCheckpoint
      expect(cp.fields.current_intent).toContain("no LLM available")
    })
  })
})

describe("normalization", () => {
  test("invalid statuses, roles and missing fields get safe defaults", async () => {
    await withTempWriter(async (writer) => {
      const raw = llmFields({
        task_tree: [{ id: "t1", description: "x", status: "exploded", children: "nope" }],
        involved_files: [{ path: "a.ts", role: "vaporized" }],
        working_constraints: "not an array",
        errors_and_fixes: [{}],
        runtime_state: { active_ports: ["8080"] },
        miscellaneous_notes: [1, true],
      })
      writer.setProvider(makeProvider(JSON.stringify(raw)))
      const path = await writer.write("sess1", HISTORY, false, 0)
      const cp = JSON.parse(await readFile(path, "utf-8")) as StructuredCheckpoint

      expect(cp.fields.task_tree[0]!.status).toBe("pending")
      expect(cp.fields.task_tree[0]!.children).toEqual([])
      expect(cp.fields.involved_files[0]!.role).toBe("read")
      expect(cp.fields.working_constraints).toEqual([])
      expect(cp.fields.errors_and_fixes[0]!.verified).toBe(false)
      expect(cp.fields.runtime_state.active_ports).toEqual([8080])
      expect(cp.fields.miscellaneous_notes).toEqual(["1", "true"])
    })
  })

  test("intent falls back to legacy 'intent' key", async () => {
    await withTempWriter(async (writer) => {
      const raw = llmFields()
      delete raw.current_intent
      raw.intent = "legacy intent"
      writer.setProvider(makeProvider(JSON.stringify(raw)))
      const path = await writer.write("sess1", HISTORY, false, 0)
      const cp = JSON.parse(await readFile(path, "utf-8")) as StructuredCheckpoint
      expect(cp.fields.current_intent).toBe("legacy intent")
    })
  })
})

describe("fallback extraction (no provider)", () => {
  test("extracts file paths and error lines from history", async () => {
    await withTempWriter(async (writer) => {
      const path = await writer.write("sess1", HISTORY, false, 0)
      const cp = JSON.parse(await readFile(path, "utf-8")) as StructuredCheckpoint

      const paths = cp.fields.involved_files.map((f) => f.path)
      expect(paths).toContain("src/auth.ts")
      expect(cp.fields.errors_and_fixes.length).toBe(1)
      expect(cp.fields.errors_and_fixes[0]!.error_summary).toContain("TS2345")
      expect(cp.fields.errors_and_fixes[0]!.verified).toBe(false)
    })
  })
})

describe("discovery promotion", () => {
  const discovery = { id: "disc-1", description: "API rate limit is 100/min", confidence: 0.9, applicable_to: ["api"] }

  test("promotes only after 3 stable appearances with confidence >= 0.7", async () => {
    await withTempWriter(async (writer) => {
      const memory = new FakeMemoryWriter()
      writer.setProjectMemoryWriter(memory)
      writer.setProvider(makeProvider(JSON.stringify(llmFields({ cross_task_discoveries: [discovery] }))))

      await writer.write("sess1", HISTORY, false, 0)
      await writer.write("sess1", HISTORY, true, 1)
      expect(memory.promoted.length).toBe(0)

      await writer.write("sess1", HISTORY, true, 2)
      expect(memory.promoted.length).toBe(1)
      expect(memory.promoted[0]!.discovery.id).toBe("disc-1")
      expect(memory.promoted[0]!.stabilityCount).toBe(3)
    })
  })

  test("low-confidence discoveries are never promoted", async () => {
    await withTempWriter(async (writer) => {
      const memory = new FakeMemoryWriter()
      writer.setProjectMemoryWriter(memory)
      const weak = { ...discovery, confidence: 0.5 }
      writer.setProvider(makeProvider(JSON.stringify(llmFields({ cross_task_discoveries: [weak] }))))

      for (let i = 0; i < 4; i++) await writer.write("sess1", HISTORY, true, i)
      expect(memory.promoted.length).toBe(0)
    })
  })

  test("without a memory writer nothing is promoted and write still succeeds", async () => {
    await withTempWriter(async (writer) => {
      writer.setProvider(makeProvider(JSON.stringify(llmFields({ cross_task_discoveries: [discovery] }))))
      for (let i = 0; i < 3; i++) await writer.write("sess1", HISTORY, true, i)
      expect(writer.getPreviousCheckpoint()!.version).toBe(3)
    })
  })
})

describe("management", () => {
  test("setPreviousCheckpoint seeds versioning, reset clears state", async () => {
    await withTempWriter(async (writer, outputDir) => {
      writer.setProvider(makeProvider(JSON.stringify(llmFields()))) // valid output
      const seed = {
        version: 41, cycle_index: 9, session_id: "old", created_at: "2026-01-01",
        is_incremental: false,
        fields: (JSON.parse(JSON.stringify(llmFields())) as StructuredCheckpoint["fields"]),
      } as StructuredCheckpoint
      writer.setPreviousCheckpoint(seed)

      const path = await writer.write("sess1", HISTORY, true, 10)
      expect(path).toBe(join(outputDir, "sess1", "checkpoint_v42_cycle10.json"))

      writer.reset()
      expect(writer.getPreviousCheckpoint()).toBeNull()
      const path2 = await writer.write("sess1", HISTORY, false, 11)
      expect(path2).toContain("checkpoint_v1_cycle11.json")
    })
  })
})
