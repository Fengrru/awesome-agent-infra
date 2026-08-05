/**
 * LifecycleManager — Declarative Module Lifecycle Manager
 *
 * Replaces hardcoded module calls with declarative lifecycle hook registration.
 * Modules declare which states/phases they need to hook into, and the manager
 * automatically triggers them at the right time with priority-based ordering.
 *
 * ## Design Principles
 * - Module failures never block state transitions (error isolation)
 * - Priority controls execution order (lower = earlier)
 * - Hot-pluggable modules (register / unregister at runtime)
 * - Type-safe dependency injection via generic TModules
 *
 * @module lifecycle-manager
 */

// ─── Inlined State Types (zero deps) ────────────────────────────────────────

export const AgentState = {
  IDLE: "IDLE",
  INITIALIZING: "INITIALIZING",
  READY: "READY",
  PLANNING: "PLANNING",
  THINKING: "THINKING",
  EXECUTING: "EXECUTING",
  VERIFYING: "VERIFYING",
  COMPACTING: "COMPACTING",
  PAUSED: "PAUSED",
  FAILED: "FAILED",
  COMPLETED: "COMPLETED",
  ERROR: "ERROR",
  RECOVERING: "RECOVERING",
  SHUTTING_DOWN: "SHUTTING_DOWN",
} as const

export type AgentState = (typeof AgentState)[keyof typeof AgentState]

/** Minimal state machine interface — implement with @fengrru/state-machine or your own */
export interface IStateMachine {
  onEnter(state: string, callback: (prev: string, next: string, reason?: string) => Promise<void>): void
  readonly state: string
}

// ─── Execution Phase ─────────────────────────────────────────────────────────

export type ExecutionPhase =
  | "before_plan"
  | "after_plan"
  | "before_step"
  | "after_step"
  | "before_verify"
  | "after_verify"
  | "on_error"
  | "on_complete"
  | "on_shutdown"

// ─── Engine Context ──────────────────────────────────────────────────────────

export interface EngineContext<TModules extends Record<string, unknown> = Record<string, unknown>> {
  sessionId: string
  goal: string
  stepCount: number
  tokenUsage: number
  currentDAG: unknown | null
  modules: TModules
  [key: string]: unknown
}

// ─── Module Lifecycle Definition ─────────────────────────────────────────────

export interface ModuleLifecycle<TModules extends Record<string, unknown> = Record<string, unknown>> {
  id: string
  priority?: number
  onEnter?: Partial<Record<AgentState, (ctx: EngineContext<TModules>) => Promise<void>>>
  onExit?: Partial<Record<AgentState, (ctx: EngineContext<TModules>) => Promise<void>>>
  onPhase?: Partial<Record<ExecutionPhase, (ctx: EngineContext<TModules>) => Promise<void>>>
  dependsOn?: string[]
}

// ─── Internal ────────────────────────────────────────────────────────────────

interface RegisteredModule {
  lifecycle: ModuleLifecycle
  deps: Record<string, unknown>
}

// ─── LifecycleManager ────────────────────────────────────────────────────────

export class LifecycleManager {
  private modules = new Map<string, RegisteredModule>()
  private stateMachine: IStateMachine
  private hooked = false

  constructor(stateMachine: IStateMachine) {
    this.stateMachine = stateMachine
  }

  /** Register a module's lifecycle with typed dependencies */
  register<TModules extends Record<string, unknown>>(lifecycle: ModuleLifecycle<TModules>, deps: TModules): void {
    this.modules.set(lifecycle.id, { lifecycle: lifecycle as ModuleLifecycle, deps })
  }

  unregister(id: string): void {
    this.modules.delete(id)
  }

  getRegisteredIds(): string[] {
    return Array.from(this.modules.keys())
  }

  getRegistered(): ModuleLifecycle[] {
    return Array.from(this.modules.values()).map((m) => m.lifecycle)
  }

  // ── State Machine Hooks ───────────────────────────────────────────────

  hookStateMachine(): void {
    if (this.hooked) return
    this.hooked = true

    const allStates = Object.values(AgentState)
    for (const state of allStates) {
      this.stateMachine.onEnter(state, async (_prev, _reason) => {
        await this.triggerStateEnter(state)
      })
    }
  }

  async triggerStateEnter(state: AgentState, ctx?: Partial<EngineContext>): Promise<void> {
    const matched = Array.from(this.modules.values())
      .filter((m) => m.lifecycle.onEnter?.[state])
      .sort((a, b) => (a.lifecycle.priority ?? 50) - (b.lifecycle.priority ?? 50))

    const context = this.buildContext(ctx)
    for (const { lifecycle, deps } of matched) {
      const handler = lifecycle.onEnter![state]!
      try {
        await handler({ ...context, modules: deps })
      } catch (err) {
        console.warn(`[LifecycleManager] Module "${lifecycle.id}" onEnter(${state}) failed:`, err)
      }
    }
  }

  async triggerStateExit(state: AgentState, ctx?: Partial<EngineContext>): Promise<void> {
    const matched = Array.from(this.modules.values())
      .filter((m) => m.lifecycle.onExit?.[state])
      .sort((a, b) => (a.lifecycle.priority ?? 50) - (b.lifecycle.priority ?? 50))

    const context = this.buildContext(ctx)
    for (const { lifecycle, deps } of matched) {
      const handler = lifecycle.onExit![state]!
      try {
        await handler({ ...context, modules: deps })
      } catch (err) {
        console.warn(`[LifecycleManager] Module "${lifecycle.id}" onExit(${state}) failed:`, err)
      }
    }
  }

  // ── Execution Phase Hooks ─────────────────────────────────────────────

  async triggerPhase(phase: ExecutionPhase, ctx?: Partial<EngineContext>): Promise<void> {
    const matched = Array.from(this.modules.values())
      .filter((m) => m.lifecycle.onPhase?.[phase])
      .sort((a, b) => (a.lifecycle.priority ?? 50) - (b.lifecycle.priority ?? 50))

    const context = this.buildContext(ctx)
    for (const { lifecycle, deps } of matched) {
      const handler = lifecycle.onPhase![phase]!
      try {
        await handler({ ...context, modules: deps })
      } catch (err) {
        console.warn(`[LifecycleManager] Module "${lifecycle.id}" onPhase(${phase}) failed:`, err)
      }
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private buildContext(ctx?: Partial<EngineContext>): EngineContext {
    return {
      sessionId: ctx?.sessionId ?? "",
      goal: ctx?.goal ?? "",
      stepCount: ctx?.stepCount ?? 0,
      tokenUsage: ctx?.tokenUsage ?? 0,
      currentDAG: ctx?.currentDAG ?? null,
      modules: {},
      ...ctx,
    }
  }
}

/**
 * Create a {@link LifecycleManager} instance.
 *
 * @param args - Constructor arguments forwarded to {@link LifecycleManager}.
 * @returns A new {@link LifecycleManager}.
 */
export function createLifecycleManager(...args: ConstructorParameters<typeof LifecycleManager>): LifecycleManager {
  return new LifecycleManager(...args)
}
