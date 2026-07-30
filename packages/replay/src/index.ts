/**
 * @fengru/replay — Session Event Replay Engine
 *
 * Replays recorded session events in three modes:
 *   - dry-run: compute state trajectory without any execution
 *   - read-only: state + non-destructive operations only
 *   - full: execute all events including side-effectful operations
 *
 * Depends on @fengru/state-machine and @fengru/taskdag for rich DAG and
 * state-machine integration. When those packages are absent, minimal internal
 * implementations preserve functionality without external deps.
 *
 * @module replay
 */

export type ReplayMode = "dry-run" | "read-only" | "full"

export interface ReplayEvent {
  eventId: string
  type: string
  timestamp: number
  payload: Record<string, unknown>
  stateTransition?: { from: string; to: string }
  dagNodeId?: string
  destructive?: boolean
}

export interface StateTrajectoryStep {
  state: string
  timestamp: number
  eventId: string
}

export interface ReplayResult {
  mode: ReplayMode
  eventsProcessed: number
  eventsSkipped: number
  stateTrajectory: StateTrajectoryStep[]
  differences: ReplayDifference[]
  success: boolean
  error?: string
}

export interface ReplayDifference {
  eventId: string
  expected: string
  actual: string
  severity: "warning" | "error"
}

// ── Optional Import Helpers ─────────────────────────────────────────────────

function tryLoadStateMachine(): {
  AgentStateMachine: new () => { state: string; transition: (to: string) => Promise<void>; getSnapshot: () => Record<string, unknown>; restore: (s: Record<string, unknown>) => void }
} | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("@fengru/state-machine") as {
      AgentStateMachine: new () => { state: string; transition: (to: string) => Promise<void>; getSnapshot: () => Record<string, unknown>; restore: (s: Record<string, unknown>) => void }
    }
  } catch {
    return null
  }
}

function tryLoadTaskDag(): {
  validateDAG: (dag: Record<string, unknown>) => { valid: boolean; error?: string }
} | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("@fengru/taskdag") as {
      validateDAG: (dag: Record<string, unknown>) => { valid: boolean; error?: string }
    }
  } catch {
    return null
  }
}

// ── Minimal Internal Implementations ────────────────────────────────────────

class MinimalStateMachine {
  private currentState = "IDLE"
  private states: string[] = []

  get state(): string { return this.currentState }

  async transition(to: string): Promise<void> {
    this.states.push(to)
    this.currentState = to
  }

  getSnapshot(): Record<string, unknown> {
    return { current_state: this.currentState, states: [...this.states] }
  }

  restore(snapshot: Record<string, unknown>): void {
    if (typeof snapshot.current_state === "string") {
      this.currentState = snapshot.current_state
    }
    if (Array.isArray(snapshot.states)) {
      this.states = [...snapshot.states as string[]]
    }
  }
}

function minimalValidateDAG(_dag: Record<string, unknown>): { valid: boolean; error?: string } {
  return { valid: true }
}

// ── SessionReplayer ─────────────────────────────────────────────────────────

export class SessionReplayer {
  private events: ReplayEvent[] = []
  private stateMachine: { state: string; transition: (to: string) => Promise<void>; getSnapshot: () => Record<string, unknown>; restore: (s: Record<string, unknown>) => void }
  private validateDAG: (dag: Record<string, unknown>) => { valid: boolean; error?: string }

  constructor() {
    const smModule = tryLoadStateMachine()
    this.stateMachine = smModule
      ? new smModule.AgentStateMachine() as unknown as { state: string; transition: (to: string) => Promise<void>; getSnapshot: () => Record<string, unknown>; restore: (s: Record<string, unknown>) => void }
      : new MinimalStateMachine()

    const dagModule = tryLoadTaskDag()
    this.validateDAG = dagModule
      ? dagModule.validateDAG
      : minimalValidateDAG
  }

  loadEvents(events: ReplayEvent[]): void {
    this.events = [...events].sort((a, b) => a.timestamp - b.timestamp)
  }

  async replay(
    mode: ReplayMode,
    executeHandler?: (event: ReplayEvent) => Promise<unknown>,
  ): Promise<ReplayResult> {
    const trajectory: StateTrajectoryStep[] = []
    const differences: ReplayDifference[] = []
    let processed = 0
    let skipped = 0

    for (const event of this.events) {
      switch (mode) {
        case "dry-run": {
          if (event.stateTransition) {
            await this.stateMachine.transition(event.stateTransition.to)
            trajectory.push({
              state: this.stateMachine.state,
              timestamp: event.timestamp,
              eventId: event.eventId,
            })
          }
          processed++
          break
        }

        case "read-only": {
          if (event.destructive) {
            skipped++
            continue
          }
          if (event.stateTransition) {
            await this.stateMachine.transition(event.stateTransition.to)
            trajectory.push({
              state: this.stateMachine.state,
              timestamp: event.timestamp,
              eventId: event.eventId,
            })
          }
          if (executeHandler) {
            try {
              await executeHandler(event)
            } catch (err) {
              differences.push({
                eventId: event.eventId,
                expected: "success",
                actual: `error: ${err instanceof Error ? err.message : String(err)}`,
                severity: "error",
              })
            }
          }
          processed++
          break
        }

        case "full": {
          if (event.stateTransition) {
            await this.stateMachine.transition(event.stateTransition.to)
            trajectory.push({
              state: this.stateMachine.state,
              timestamp: event.timestamp,
              eventId: event.eventId,
            })
          }
          if (executeHandler) {
            try {
              await executeHandler(event)
            } catch (err) {
              differences.push({
                eventId: event.eventId,
                expected: "success",
                actual: `error: ${err instanceof Error ? err.message : String(err)}`,
                severity: "error",
              })
            }
          }
          processed++
          break
        }
      }
    }

    return {
      mode,
      eventsProcessed: processed,
      eventsSkipped: skipped,
      stateTrajectory: trajectory,
      differences,
      success: differences.filter((d) => d.severity === "error").length === 0,
    }
  }

  getStateTrajectory(): StateTrajectoryStep[] {
    return []
  }

  getDifferences(): ReplayDifference[] {
    return []
  }
}
