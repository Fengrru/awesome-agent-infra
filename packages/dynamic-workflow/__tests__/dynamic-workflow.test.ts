import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  DEFAULT_WORKFLOW_CONFIG,
  DynamicWorkflowEngine,
  type IAgentDispatcher,
  type WorkflowContext,
  createDynamicWorkflowEngine,
} from "../src/index"

async function withTempEngine(
  fn: (engine: DynamicWorkflowEngine, dirs: { stateDir: string; workflowDir: string }) => Promise<void>,
  config?: Partial<ConstructorParameters<typeof DynamicWorkflowEngine>[0] & object>,
): Promise<void> {
  const base = await mkdtemp(join(tmpdir(), "dynwf-test-"))
  const stateDir = join(base, "state")
  const workflowDir = join(base, "workflows")
  const engine = new DynamicWorkflowEngine({ stateDir, workflowDir, ...config })
  try {
    await fn(engine, { stateDir, workflowDir })
  } finally {
    await rm(base, { recursive: true, force: true })
  }
}

class FakeDispatcher implements IAgentDispatcher {
  dispatched: Array<{ task: string; options?: unknown }> = []
  async dispatchTask(task: string, options?: unknown): Promise<unknown> {
    this.dispatched.push({ task, options })
    return `result-of-${task}`
  }
  async getTaskResult(): Promise<unknown> {
    return null
  }
}

describe("configuration", () => {
  test("defaults are applied and overridable", () => {
    const engine = new DynamicWorkflowEngine()
    expect(engine.config.executionTimeoutMs).toBe(DEFAULT_WORKFLOW_CONFIG.executionTimeoutMs)
    expect(engine.config.maxNestingDepth).toBe(5)

    const custom = new DynamicWorkflowEngine({ maxNestingDepth: 2 })
    expect(custom.config.maxNestingDepth).toBe(2)
  })
})

describe("execute — sandbox basics", () => {
  test("returns the value of the last expression", async () => {
    await withTempEngine(async (engine) => {
      const result = await engine.execute("s1", "const x = 40;\nx + 2")
      expect(result).toBe(42)
    })
  })

  test("input is available inside the sandbox", async () => {
    await withTempEngine(async (engine) => {
      const result = await engine.execute("s1", "input.a + input.b", { a: 1, b: 2 })
      expect(result).toBe(3)
    })
  })

  test("dangerous globals are not exposed", async () => {
    await withTempEngine(async (engine) => {
      expect(await engine.execute("s1", "typeof setTimeout")).toBe("undefined")
      expect(await engine.execute("s1", "typeof process")).toBe("undefined")
      expect(await engine.execute("s1", "typeof require")).toBe("undefined")
    })
  })

  test("host realm is not reachable via function constructor chains", async () => {
    await withTempEngine(async (engine) => {
      await expect(engine.execute("s1", "log.constructor.constructor('return process')()")).rejects.toThrow()
      expect(await engine.execute("s1", "readFile.constructor.constructor('return typeof process')()")).toBe(
        "undefined",
      )
    })
  })

  test("input crosses the boundary as plain context-realm data", async () => {
    await withTempEngine(async (engine) => {
      const result = await engine.execute("s1", "input.constructor === Object", { a: 1 })
      expect(result).toBe(true)
    })
  })

  test("non-serializable input is rejected", async () => {
    await withTempEngine(async (engine) => {
      const circular: Record<string, unknown> = {}
      circular.self = circular
      await expect(engine.execute("s1", "1 + 1", circular)).rejects.toThrow("JSON-serializable")
    })
  })

  test("script errors mark execution failed and rethrow", async () => {
    await withTempEngine(async (engine) => {
      const script = "const f = () => { throw new Error('boom') }\nf()"
      await expect(engine.execute("s1", script)).rejects.toThrow("boom")
    })
  })

  test("execution times out on a never-resolving script", async () => {
    await withTempEngine(
      async (engine) => {
        await expect(engine.execute("s1", "await new Promise(() => {})")).rejects.toThrow("timed out")
      },
      { executionTimeoutMs: 100 },
    )
  })
})

describe("primitives", () => {
  test("agent dispatches through the injected dispatcher", async () => {
    await withTempEngine(async (engine) => {
      const dispatcher = new FakeDispatcher()
      engine.setAgentDispatcher(dispatcher)
      const result = await engine.execute("s1", "await agent('fix-bug', { maxSteps: 3 })")
      expect(result).toBe("result-of-fix-bug")
      expect(dispatcher.dispatched[0]!.task).toBe("fix-bug")
      expect(dispatcher.dispatched[0]!.options).toEqual({ maxSteps: 3 })
    })
  })

  test("agent without dispatcher throws a clear error", async () => {
    await withTempEngine(async (engine) => {
      await expect(engine.execute("s1", "await agent('x')")).rejects.toThrow("No agent dispatcher")
    })
  })

  test("parallel runs tasks and returns all results", async () => {
    await withTempEngine(async (engine) => {
      const result = await engine.execute("s1", "await parallel([async () => 1, async () => 2, async () => 3])")
      expect(result).toEqual([1, 2, 3])
    })
  })

  test("pipeline chains stages feeding output to next stage", async () => {
    await withTempEngine(async (engine) => {
      const result = await engine.execute("s1", "await pipeline(async (x) => x * 2, async (x) => x + 1)", 10)
      expect(result).toBe(21)
    })
  })

  test("workflow primitive composes a registered sub-workflow", async () => {
    await withTempEngine(async (engine) => {
      engine.registerWorkflow("double", "input * 2")
      const result = await engine.execute("s1", "await workflow('double', 21)")
      expect(result).toBe(42)
    })
  })

  test("unknown sub-workflow throws not-found", async () => {
    await withTempEngine(async (engine) => {
      await expect(engine.execute("s1", "await workflow('ghost')")).rejects.toThrow("not found")
    })
  })

  test("recursive workflow hits max nesting depth", async () => {
    await withTempEngine(
      async (engine) => {
        engine.registerWorkflow("recurse", "await workflow('recurse')")
        await expect(engine.execute("s1", "await workflow('recurse')")).rejects.toThrow("nesting depth")
      },
      { maxNestingDepth: 3 },
    )
  })
})

describe("file primitives", () => {
  test("writeFile then readFile round-trips inside the sandbox", async () => {
    await withTempEngine(async (engine, dirs) => {
      const target = join(dirs.workflowDir, "note.txt").replace(/\\/g, "/")
      await engine.execute("s1", `await writeFile('${target}', 'hello sandbox')`)
      const result = await engine.execute("s1", `await readFile('${target}')`)
      expect(result).toBe("hello sandbox")
    })
  })

  test("reading a missing file throws sandbox-safe error", async () => {
    await withTempEngine(async (engine) => {
      await expect(engine.execute("s1", "await readFile('no/such/file.txt')")).rejects.toThrow("Cannot read file")
    })
  })
})

describe("state persistence", () => {
  test("completed execution state is persisted to stateDir", async () => {
    await withTempEngine(async (engine, dirs) => {
      await engine.execute("s1", "1 + 1")
      const files = await readdir(dirs.stateDir)
      expect(files.length).toBe(1)
      const ctx = JSON.parse(await readFile(join(dirs.stateDir, files[0]!), "utf-8")) as WorkflowContext
      expect(ctx.status).toBe("completed")
      expect(ctx.sessionId).toBe("s1")
    })
  })

  test("failed execution state records the error", async () => {
    await withTempEngine(async (engine, dirs) => {
      const script = "const f = () => { throw new Error('kaput') }\nf()"
      await engine.execute("s1", script).catch(() => {})
      const files = await readdir(dirs.stateDir)
      const ctx = JSON.parse(await readFile(join(dirs.stateDir, files[0]!), "utf-8")) as WorkflowContext
      expect(ctx.status).toBe("failed")
      expect(ctx.error).toContain("kaput")
    })
  })

  test("resume without state throws", async () => {
    await withTempEngine(async (engine) => {
      await expect(engine.resume("wf_missing")).rejects.toThrow("No state found")
    })
  })
})

describe("log primitive", () => {
  test("log writes to console without error", async () => {
    await withTempEngine(async (engine) => {
      const result = await engine.execute("s1", "await log('hello from sandbox')\n42")
      expect(result).toBe(42)
    })
  })
})

describe("factory function", () => {
  test("createDynamicWorkflowEngine returns a DynamicWorkflowEngine", () => {
    const engine = createDynamicWorkflowEngine()
    expect(engine).toBeInstanceOf(DynamicWorkflowEngine)
    expect(engine.config.executionTimeoutMs).toBe(DEFAULT_WORKFLOW_CONFIG.executionTimeoutMs)
  })
})

describe("execution registry", () => {
  test("active executions are cleaned up after completion", async () => {
    await withTempEngine(async (engine) => {
      await engine.execute("s1", "1")
      expect(engine.listActiveExecutions()).toEqual([])
      expect(engine.getExecution("anything")).toBeUndefined()
    })
  })
})
