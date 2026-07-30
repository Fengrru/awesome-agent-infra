/**
 * StateMachine — Typed Finite State Machine for AI Agent Sessions
 *
 * Provides a validated state machine with 15 agent states, 40+ valid
 * transitions, onEnter/onExit lifecycle callbacks, state duration metrics,
 * serializable snapshots, and checkpoint restore.
 *
 * ## Features
 * - 15 predefined states: IDLE → INITIALIZING → READY → PLANNING → ...
 * - Validated transitions (throws StateTransitionError on invalid moves)
 * - ERROR state as universal escape hatch
 * - onEnter/onExit callback registration per state
 * - State duration tracking with avg/total time metrics
 * - Prometheus-compatible metrics export
 * - Serializable snapshots for checkpoint/restore
 *
 * @module state-machine
 */

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

const VALID_TRANSITIONS = new Set<string>([
  "IDLE->INITIALIZING",
  "INITIALIZING->READY",
  "READY->PLANNING",
  "READY->THINKING",
  "READY->EXECUTING",
  "READY->RECOVERING",
  "READY->PAUSED",
  "READY->SHUTTING_DOWN",
  "PLANNING->THINKING",
  "PLANNING->EXECUTING",
  "PLANNING->PAUSED",
  "THINKING->EXECUTING",
  "THINKING->VERIFYING",
  "THINKING->PAUSED",
  "EXECUTING->VERIFYING",
  "EXECUTING->THINKING",
  "EXECUTING->PAUSED",
  "EXECUTING->FAILED",
  "EXECUTING->SHUTTING_DOWN",
  "VERIFYING->READY",
  "VERIFYING->THINKING",
  "VERIFYING->COMPACTING",
  "VERIFYING->COMPLETED",
  "VERIFYING->PAUSED",
  "VERIFYING->FAILED",
  "VERIFYING->SHUTTING_DOWN",
  "PAUSED->READY",
  "PAUSED->RECOVERING",
  "FAILED->RECOVERING",
  "FAILED->READY",
  "FAILED->SHUTTING_DOWN",
  "COMPACTING->READY",
  "RECOVERING->READY",
  "RECOVERING->PAUSED",
  "RECOVERING->FAILED",
  "COMPLETED->INITIALIZING",
  "COMPLETED->SHUTTING_DOWN",
  "FAILED->INITIALIZING",
  "SHUTTING_DOWN->INITIALIZING",
  "THINKING->INITIALIZING",
  "VERIFYING->INITIALIZING",
  "PAUSED->INITIALIZING",
  "PLANNING->INITIALIZING",
  "READY->INITIALIZING",
  "ERROR->READY",
  "ERROR->RECOVERING",
  "ERROR->SHUTTING_DOWN",
])

export class StateTransitionError extends Error {
  constructor(from: AgentState, to: AgentState) {
    super(`Invalid state transition: ${from} -> ${to}`)
    this.name = "StateTransitionError"
  }
}

export type TransitionCallback = (
  prev: AgentState,
  next: AgentState,
  reason?: string,
) => Promise<void>

export type TransitionGuard = (
  from: AgentState,
  to: AgentState,
  reason?: string,
) => boolean | Promise<boolean>

export interface StateMachineSnapshot {
  current_state: AgentState
  previous_state: AgentState
  transition_count: number
  state_history: Array<{
    from: AgentState
    to: AgentState
    timestamp: number
    reason?: string
  }>
  state_enter_times: Record<string, number>
  state_metrics: Record<string, { enter_count: number; total_time_ms: number; avg_time_ms: number }>
}

export interface StateMetrics {
  enter_count: number
  total_time_ms: number
  avg_time_ms: number
}

export class AgentStateMachine {
  private currentState: AgentState = AgentState.IDLE
  private previousState: AgentState = AgentState.IDLE
  private transitionCount = 0
  private stateHistory: StateMachineSnapshot["state_history"] = []
  private stateEnterTimes = new Map<AgentState, number>()
  private stateMetrics = new Map<AgentState, StateMetrics>()
  private onEnterCallbacks = new Map<AgentState, TransitionCallback[]>()
  private onExitCallbacks = new Map<AgentState, TransitionCallback[]>()
  private guards: TransitionGuard[] = []
  private transitionTimeout = 30000

  constructor() {
    this.stateEnterTimes.set(AgentState.IDLE, Date.now())
  }

  get state(): AgentState {
    return this.currentState
  }

  get prevState(): AgentState {
    return this.previousState
  }

  get transitions(): number {
    return this.transitionCount
  }

  canTransition(from: AgentState, to: AgentState): boolean {
    return VALID_TRANSITIONS.has(`${from}->${to}`)
  }

  async transition(to: AgentState, reason?: string): Promise<void> {
    const from = this.currentState

    if (!this.canTransition(from, to)) {
      const isErrorState = to === AgentState.ERROR
      if (!isErrorState) {
        throw new StateTransitionError(from, to)
      }
    }

    for (const guard of this.guards) {
      const allowed = await Promise.resolve(guard(from, to, reason))
      if (!allowed) {
        throw new StateTransitionError(from, to)
      }
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Transition ${from}->${to} timed out after ${this.transitionTimeout}ms`)), this.transitionTimeout),
    )

    const transitionPromise = (async () => {
      // Trigger exit callbacks
      const exitCallbacks = this.onExitCallbacks.get(from) ?? []
      for (const cb of exitCallbacks) {
        await cb(from, to)
      }

      // Record duration metrics
      const exitTime = Date.now()
      const entryTime = this.stateEnterTimes.get(from)
      if (entryTime) {
        const duration = exitTime - entryTime
        const metrics = this.stateMetrics.get(from) ?? {
          enter_count: 0,
          total_time_ms: 0,
          avg_time_ms: 0,
        }
        metrics.total_time_ms += duration
        metrics.enter_count += 1
        metrics.avg_time_ms = metrics.total_time_ms / metrics.enter_count
        this.stateMetrics.set(from, metrics)
      }

      this.previousState = from
      this.currentState = to
      this.transitionCount++
      this.stateEnterTimes.set(to, exitTime)

      this.stateHistory.push({ from, to, timestamp: exitTime, reason })
      if (this.stateHistory.length > 100) {
        this.stateHistory = this.stateHistory.slice(-100)
      }

      // Trigger enter callbacks
      const enterCallbacks = this.onEnterCallbacks.get(to) ?? []
      for (const cb of enterCallbacks) {
        await cb(from, to, reason)
      }
    })()

    await Promise.race([transitionPromise, timeoutPromise])
  }

  onEnter(state: AgentState, callback: TransitionCallback): void {
    const callbacks = this.onEnterCallbacks.get(state) ?? []
    callbacks.push(callback)
    this.onEnterCallbacks.set(state, callbacks)
  }

  removeOnEnter(state: AgentState, callback: TransitionCallback): boolean {
    const callbacks = this.onEnterCallbacks.get(state)
    if (!callbacks) return false
    const idx = callbacks.indexOf(callback)
    if (idx < 0) return false
    callbacks.splice(idx, 1)
    return true
  }

  onExit(state: AgentState, callback: TransitionCallback): void {
    const callbacks = this.onExitCallbacks.get(state) ?? []
    callbacks.push(callback)
    this.onExitCallbacks.set(state, callbacks)
  }

  removeOnExit(state: AgentState, callback: TransitionCallback): boolean {
    const callbacks = this.onExitCallbacks.get(state)
    if (!callbacks) return false
    const idx = callbacks.indexOf(callback)
    if (idx < 0) return false
    callbacks.splice(idx, 1)
    return true
  }

  addGuard(guard: TransitionGuard): void {
    this.guards.push(guard)
  }

  removeGuard(guard: TransitionGuard): boolean {
    const idx = this.guards.indexOf(guard)
    if (idx < 0) return false
    this.guards.splice(idx, 1)
    return true
  }

  setTransitionTimeout(ms: number): void {
    this.transitionTimeout = Math.max(100, ms)
  }

  getSnapshot(): StateMachineSnapshot {
    const enterTimes: Record<string, number> = {}
    for (const [state, time] of this.stateEnterTimes) {
      enterTimes[state] = time
    }
    const metrics: Record<string, { enter_count: number; total_time_ms: number; avg_time_ms: number }> = {}
    for (const [state, m] of this.stateMetrics) {
      metrics[state] = { enter_count: m.enter_count, total_time_ms: m.total_time_ms, avg_time_ms: m.avg_time_ms }
    }
    return {
      current_state: this.currentState,
      previous_state: this.previousState,
      transition_count: this.transitionCount,
      state_history: [...this.stateHistory].slice(-20),
      state_enter_times: enterTimes,
      state_metrics: metrics,
    }
  }

  getStateMetrics(): Record<AgentState, StateMetrics> {
    const result: Record<string, StateMetrics> = {}
    for (const [state, metrics] of this.stateMetrics) {
      result[state] = { ...metrics }
    }
    for (const state of Object.values(AgentState)) {
      if (!result[state]) {
        result[state] = { enter_count: 0, total_time_ms: 0, avg_time_ms: 0 }
      }
    }
    return result as Record<AgentState, StateMetrics>
  }

  toPrometheusMetrics(name: string = "agent_state_machine"): string {
    const metrics = this.getStateMetrics()
    const lines = [`# StateMachine: ${name}`]
    for (const [state, data] of Object.entries(metrics)) {
      lines.push(`state_enter_count{state="${state}"} ${data.enter_count}`)
      lines.push(`state_total_time_ms{state="${state}"} ${data.total_time_ms}`)
      lines.push(`state_avg_time_ms{state="${state}"} ${data.avg_time_ms.toFixed(2)}`)
    }
    return lines.join("\n")
  }

  reset(): void {
    this.currentState = AgentState.IDLE
    this.previousState = AgentState.IDLE
    this.transitionCount = 0
    this.stateHistory = []
    this.stateEnterTimes.clear()
    this.stateEnterTimes.set(AgentState.IDLE, Date.now())
    this.stateMetrics.clear()
  }

  restore(snapshot: StateMachineSnapshot): void {
    this.currentState = snapshot.current_state
    this.previousState = snapshot.previous_state
    this.transitionCount = snapshot.transition_count
    this.stateHistory = [...snapshot.state_history]
    this.stateEnterTimes.clear()
    if (snapshot.state_enter_times) {
      for (const [state, time] of Object.entries(snapshot.state_enter_times)) {
        this.stateEnterTimes.set(state as AgentState, time)
      }
    } else {
      this.stateEnterTimes.set(this.currentState, Date.now())
    }
    this.stateMetrics.clear()
    if (snapshot.state_metrics) {
      for (const [state, m] of Object.entries(snapshot.state_metrics)) {
        this.stateMetrics.set(state as AgentState, { ...m })
      }
    }
  }
}
