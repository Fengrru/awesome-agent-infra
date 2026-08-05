/**
 * DynamicWorkflowEngine — VM-Sandboxed Agentic Workflow Engine
 *
 * Provides an isolated JavaScript sandbox where agents can write imperative
 * orchestration scripts using high-level primitives. This gives a lower-level,
 * more flexible execution model than DAG-based planners for complex workflows.
 *
 * ## Sandbox Primitives
 * - agent(task, options)  → dispatch a sub-agent for a task
 * - parallel(tasks)       → execute multiple tasks concurrently
 * - pipeline(stages)      → chain stages where output of N feeds into N+1
 * - workflow(name)        → import & compose another workflow
 * - readFile(path)        → read a file from the workspace
 * - writeFile(path, data) → write a file to the workspace
 * - log(message)          → emit a structured log entry
 *
 * ## Features
 * - Node.js `vm` module sandbox with controlled primitives
 * - Auto-checkpoint every 5 steps (crash-resilient)
 * - Timeout protection per script execution
 * - Max nesting depth protection
 * - State persistence to disk for resume
 *
 * @module dynamic-workflow
 */

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Script, createContext, runInContext } from "node:vm"

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WorkflowContext {
  executionId: string
  sessionId: string
  scriptPath?: string
  startedAt: number
  status: WorkflowStatus
  results: WorkflowStepResult[]
  error?: string
  checkpoint?: WorkflowCheckpoint
}

export type WorkflowStatus = "pending" | "running" | "paused" | "completed" | "failed"

export interface WorkflowStepResult {
  stepId: number
  primitive: "agent" | "parallel" | "pipeline" | "workflow" | "file_read" | "file_write" | "log"
  args: unknown
  result: unknown
  timestamp: string
  durationMs: number
}

export interface WorkflowCheckpoint {
  lastStepId: number
  state: Record<string, unknown>
  savedAt: string
}

export interface WorkflowPrimitives {
  agent: (task: string, options?: AgentTaskOptions) => Promise<unknown>
  parallel: (tasks: Array<() => Promise<unknown>>) => Promise<unknown[]>
  pipeline: (...stages: Array<(input?: unknown) => Promise<unknown>>) => Promise<unknown>
  workflow: (name: string, input?: unknown) => Promise<unknown>
}

export interface AgentTaskOptions {
  capability?: string
  maxSteps?: number
  context?: string
}

export interface WorkflowConfig {
  workflowDir: string
  stateDir: string
  executionTimeoutMs: number
  maxNestingDepth: number
}

export const DEFAULT_WORKFLOW_CONFIG: WorkflowConfig = {
  workflowDir: ".fengru/workflows",
  stateDir: ".fengru/workflow-state",
  executionTimeoutMs: 300_000,
  maxNestingDepth: 5,
}

/** Agent dispatcher interface — inject your own sub-agent execution */
export interface IAgentDispatcher {
  dispatchTask(task: string, options?: AgentTaskOptions): Promise<unknown>
  getTaskResult(taskId: string): Promise<unknown>
}

// ─── DynamicWorkflowEngine ──────────────────────────────────────────────────

export class DynamicWorkflowEngine {
  readonly config: WorkflowConfig
  private agentDispatcher: IAgentDispatcher | null = null
  private workflows = new Map<string, string>()
  private activeExecutions = new Map<string, WorkflowContext>()
  private nestingDepth = 0

  constructor(config?: Partial<WorkflowConfig>) {
    this.config = { ...DEFAULT_WORKFLOW_CONFIG, ...config }
  }

  setAgentDispatcher(dispatcher: IAgentDispatcher): void {
    this.agentDispatcher = dispatcher
  }

  // ── Script Registration ───────────────────────────────────────────────

  registerWorkflow(name: string, script: string): void {
    this.workflows.set(name, script)
  }

  async loadWorkflow(name: string): Promise<string> {
    const cached = this.workflows.get(name)
    if (cached) return cached

    const filePath = join(this.config.workflowDir, `${name}.js`)
    try {
      const script = await readFile(filePath, "utf-8")
      this.workflows.set(name, script)
      return script
    } catch {
      throw new Error(`Workflow '${name}' not found at ${filePath}`)
    }
  }

  // ── Execute ───────────────────────────────────────────────────────────

  async execute(sessionId: string, script: string, input?: unknown): Promise<unknown> {
    const executionId = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const ctx: WorkflowContext = {
      executionId,
      sessionId,
      startedAt: Date.now(),
      status: "running",
      results: [],
    }

    this.activeExecutions.set(executionId, ctx)

    try {
      const result = await this.runInSandbox(ctx, script, input)
      ctx.status = "completed"
      await this.persistState(ctx)
      return result
    } catch (err) {
      ctx.status = "failed"
      ctx.error = err instanceof Error ? err.message : String(err)
      await this.persistState(ctx)
      throw err
    } finally {
      this.activeExecutions.delete(executionId)
    }
  }

  async resume(executionId: string): Promise<unknown> {
    const ctx = this.activeExecutions.get(executionId)
    if (!ctx) {
      const loaded = await this.loadState(executionId)
      if (!loaded) {
        throw new Error(`No state found for execution ${executionId}`)
      }
      this.activeExecutions.set(executionId, loaded)
      return this.resume(executionId)
    }

    if (ctx.checkpoint) {
      ctx.status = "running"
      const script = ctx.scriptPath ? await readFile(ctx.scriptPath, "utf-8") : ""
      if (!script) throw new Error("Cannot resume: no script available")
      return this.runInSandbox(ctx, script, ctx.checkpoint.state)
    }

    throw new Error(`Cannot resume execution ${executionId}: no checkpoint found`)
  }

  // ── Sandbox Execution ─────────────────────────────────────────────────

  /**
   * Execute a workflow script inside a `node:vm` context.
   *
   * Security notes:
   *   - `node:vm` is NOT a security mechanism per Node.js documentation. This
   *     method hardens the common escape vectors (host intrinsics and host
   *     function constructor chains) so workflow scripts cannot reach the host
   *     realm through the usual prototype/constructor tricks, but it must not
   *     be relied upon against adversarial code. Use OS-level isolation for
   *     untrusted scripts.
   *   - Host functions are wrapped in context-realm functions before being
   *     exposed, so `.constructor.constructor(...)` on them cannot evaluate
   *     code in the host realm.
   *   - The `input` value crosses the boundary as a JSON string only; host
   *     object references and prototypes never enter the context.
   */
  private async runInSandbox(ctx: WorkflowContext, script: string, input?: unknown): Promise<unknown> {
    this.nestingDepth++

    if (this.nestingDepth > this.config.maxNestingDepth) {
      this.nestingDepth--
      throw new Error(`Max workflow nesting depth (${this.config.maxNestingDepth}) exceeded`)
    }

    const primitives = this.buildPrimitives(ctx, input)

    let inputJson = "null"
    if (input !== undefined) {
      try {
        inputJson = JSON.stringify(input) ?? "null"
      } catch {
        this.nestingDepth--
        throw new Error("Workflow input must be JSON-serializable")
      }
    }

    // The sandbox object becomes the context's globalThis. Do NOT pass host
    // realm intrinsics (JSON, Object, Promise, ...) or raw host functions:
    // their constructor chains would let script code reach the host realm.
    const sandbox: Record<string, unknown> = { __inputJson: inputJson }

    const vmContext = createContext(sandbox)

    // Wrapper compiled in the context realm: exposed functions carry the
    // context's Function in their prototype chain, not the host's.
    const wrapFn = runInContext("(fn) => (...args) => fn(...args)", vmContext) as <F>(fn: F) => F

    sandbox.agent = wrapFn(primitives.agent)
    sandbox.parallel = wrapFn(primitives.parallel)
    sandbox.pipeline = wrapFn(primitives.pipeline)
    sandbox.workflow = wrapFn(primitives.workflow)
    sandbox.readFile = wrapFn(async (path: string) => {
      const result = await this.sandboxReadFile(path)
      await this.recordStep(ctx, "file_read", { path }, result)
      return result
    })
    sandbox.writeFile = wrapFn(async (path: string, data: string) => {
      await this.sandboxWriteFile(path, data)
      await this.recordStep(ctx, "file_write", { path, dataLength: data.length }, true)
    })
    sandbox.log = wrapFn(async (message: string) => {
      await this.recordStep(ctx, "log", { message }, undefined)
      console.log(`[Workflow:${ctx.executionId}] ${message}`)
    })

    sandbox.__cl = wrapFn((...args: unknown[]) => console.log(`[Workflow:${ctx.executionId}]`, ...args))
    sandbox.__ce = wrapFn((...args: unknown[]) => console.error(`[Workflow:${ctx.executionId}]`, ...args))
    sandbox.__cw = wrapFn((...args: unknown[]) => console.warn(`[Workflow:${ctx.executionId}]`, ...args))
    runInContext(
      "globalThis.console = { log: globalThis.__cl, error: globalThis.__ce, warn: globalThis.__cw };" +
        "globalThis.__cl = undefined; globalThis.__ce = undefined; globalThis.__cw = undefined;",
      vmContext,
    )

    try {
      const executable = this.transformScript(script)

      const wrapped = `
        (async () => {
          const input = JSON.parse(globalThis.__inputJson);
          try {
            ${executable}
          } catch (err) {
            throw err;
          }
        })()
      `

      const vmScript = new Script(wrapped, {
        filename: ctx.scriptPath ?? `workflow-${ctx.executionId}.js`,
      })

      const result = await Promise.race([
        vmScript.runInContext(vmContext, { timeout: this.config.executionTimeoutMs }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Workflow execution timed out")), this.config.executionTimeoutMs),
        ),
      ])

      this.nestingDepth--
      return result
    } catch (err) {
      this.nestingDepth--
      throw err
    }
  }

  /**
   * Transform a user script so the last expression statement is returned.
   * This allows `const x = 1; x + 2` to return 3 without explicit return.
   */
  private transformScript(script: string): string {
    const lines = script.split("\n")

    const skipStart = [
      "if",
      "for",
      "while",
      "}",
      ")",
      "]",
      "return",
      "throw",
      "try",
      "catch",
      "switch",
      "class",
      "function",
      "const",
      "let",
      "var",
      "export",
      "import",
      "else",
      "case",
      "default",
    ]

    // Strategy 1: find last standalone expression line
    for (let i = lines.length - 1; i >= 0; i--) {
      const trimmed = lines[i]!.trim()
      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*")) continue
      if (skipStart.some((p) => trimmed.startsWith(p))) continue
      if (trimmed.endsWith(",")) continue
      lines[i] = lines[i]!.replace(trimmed, `return ${trimmed}`)
      return lines.join("\n")
    }

    // Strategy 2: whole script is one multi-line expression
    const declStart = ["const", "let", "var", "import", "export", "function", "class"]
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i]!.trim()
      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*")) continue
      if (declStart.some((p) => trimmed.startsWith(p))) continue
      lines[i] = lines[i]!.replace(trimmed, `return ${trimmed}`)
      return lines.join("\n")
    }

    return script
  }

  // ── Primitives ────────────────────────────────────────────────────────

  private buildPrimitives(ctx: WorkflowContext, initialInput?: unknown): WorkflowPrimitives {
    return {
      agent: async (task: string, options?: AgentTaskOptions) => {
        if (!this.agentDispatcher) {
          throw new Error("No agent dispatcher configured for workflow engine")
        }
        const result = await this.agentDispatcher.dispatchTask(task, options)
        await this.recordStep(ctx, "agent", { task, options }, result)
        return result
      },

      parallel: async (tasks: Array<() => Promise<unknown>>) => {
        const results = await Promise.all(tasks.map((t) => t()))
        await this.recordStep(ctx, "parallel", { taskCount: tasks.length }, results)
        return results
      },

      pipeline: async (...stages: Array<(input?: unknown) => Promise<unknown>>) => {
        let result: unknown = initialInput
        for (let i = 0; i < stages.length; i++) {
          result = await stages[i]!(result)
          await this.saveCheckpoint(ctx, { stage: i, value: result })
        }
        await this.recordStep(ctx, "pipeline", { stageCount: stages.length }, result)
        return result
      },

      workflow: async (name: string, input?: unknown) => {
        const wfScript = await this.loadWorkflow(name)
        const subResult = await this.runInSandbox(
          { ...ctx, executionId: `${ctx.executionId}_${name}` },
          wfScript,
          input,
        )
        await this.recordStep(ctx, "workflow", { name, input }, subResult)
        return subResult
      },
    }
  }

  // ── File I/O (sandbox-safe) ───────────────────────────────────────────

  private async sandboxReadFile(path: string): Promise<string> {
    try {
      return await readFile(path, "utf-8")
    } catch {
      throw new Error(`Cannot read file: ${path}`)
    }
  }

  private async sandboxWriteFile(path: string, data: string): Promise<void> {
    await mkdir(this.config.workflowDir, { recursive: true })
    await writeFile(path, data, "utf-8")
  }

  // ── Step Recording & Checkpointing ────────────────────────────────────

  private async recordStep(
    ctx: WorkflowContext,
    primitive: WorkflowStepResult["primitive"],
    args: unknown,
    result: unknown,
  ): Promise<void> {
    const stepResult: WorkflowStepResult = {
      stepId: ctx.results.length,
      primitive,
      args,
      result,
      timestamp: new Date().toISOString(),
      durationMs: 0,
    }
    ctx.results.push(stepResult)

    if (ctx.results.length % 5 === 0) {
      await this.saveCheckpoint(ctx, { lastResult: result })
    }
  }

  private async saveCheckpoint(ctx: WorkflowContext, state: Record<string, unknown>): Promise<void> {
    ctx.checkpoint = {
      lastStepId: ctx.results.length - 1,
      state,
      savedAt: new Date().toISOString(),
    }
    await this.persistState(ctx)
  }

  // ── Persistence ───────────────────────────────────────────────────────

  private async persistState(ctx: WorkflowContext): Promise<void> {
    const statePath = this.getStatePath(ctx.executionId)
    await mkdir(this.config.stateDir, { recursive: true })
    await writeFile(statePath, JSON.stringify(ctx, null, 2), "utf-8")
  }

  private async loadState(executionId: string): Promise<WorkflowContext | null> {
    const statePath = this.getStatePath(executionId)
    try {
      const raw = await readFile(statePath, "utf-8")
      return JSON.parse(raw) as WorkflowContext
    } catch {
      return null
    }
  }

  private getStatePath(executionId: string): string {
    return join(this.config.stateDir, `${executionId}.json`)
  }

  // ── Query ─────────────────────────────────────────────────────────────

  getExecution(executionId: string): WorkflowContext | undefined {
    return this.activeExecutions.get(executionId)
  }

  listActiveExecutions(): WorkflowContext[] {
    return [...this.activeExecutions.values()]
  }
}

/**
 * Create a {@link DynamicWorkflowEngine} instance.
 *
 * @param args - Constructor arguments forwarded to {@link DynamicWorkflowEngine}.
 * @returns A new {@link DynamicWorkflowEngine}.
 */
export function createDynamicWorkflowEngine(
  ...args: ConstructorParameters<typeof DynamicWorkflowEngine>
): DynamicWorkflowEngine {
  return new DynamicWorkflowEngine(...args)
}
