import {
  clamp,
  AgentStateMachine,
  CycleAction,
  CycleActionType,
  CycleCallbacks,
  CycleConfig,
  CycleControllerOptions,
  CycleSnapshot,
  CycleState,
  DEFAULT_CYCLE_CONFIG,
  EventBus,
  ICheckpointWriter,
  ConversationMessage,
} from "./types"

const COMPACTING_STATE = "COMPACTING"
const READY_STATE = "READY"

function createInitialState(): CycleState {
  return {
    cycleIndex: 0,
    triggeredThresholds: new Set(),
    isCompacting: false,
    stepsSinceLastCheckpoint: 0,
    rebuildCount: 0,
    totalCyclesCompleted: 0,
  }
}

export class CycleController {
  private config: CycleConfig
  private state: CycleState
  private eventBus: EventBus | null
  private stateMachine: AgentStateMachine | null
  private checkpointWriter: ICheckpointWriter | null
  private callbacks: CycleCallbacks

  constructor(options: CycleControllerOptions = {}) {
    this.config = { ...DEFAULT_CYCLE_CONFIG, ...options.config }
    this.state = createInitialState()
    this.eventBus = options.eventBus ?? null
    this.stateMachine = options.stateMachine ?? null
    this.checkpointWriter = options.checkpointWriter ?? null
    this.callbacks = options.callbacks ?? {}
  }

  get currentState(): CycleState {
    return { ...this.state, triggeredThresholds: new Set(this.state.triggeredThresholds) }
  }

  get cycleIndex(): number {
    return this.state.cycleIndex
  }

  setEventBus(eb: EventBus): void {
    this.eventBus = eb
  }

  setStateMachine(sm: AgentStateMachine): void {
    this.stateMachine = sm
  }

  setCheckpointWriter(cw: ICheckpointWriter): void {
    this.checkpointWriter = cw
  }

  setCallbacks(callbacks: CycleCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks }
  }

  evaluate(
    tokenUsage: number,
    tokenBudget: number,
    sessionId: string,
    conversationHistory: ConversationMessage[],
  ): CycleAction {
    const effectiveBudget = tokenBudget > 0 ? tokenBudget : this.config.tokenBudget
    const ratio = clamp(tokenUsage / effectiveBudget, 0, 1)

    if (ratio >= this.config.rebuildThreshold) {
      if (this.state.totalCyclesCompleted >= this.config.maxCycles) {
        return { type: CycleActionType.NOOP, reason: "maxCycles reached" }
      }
      return { type: CycleActionType.REBUILD, threshold: this.config.rebuildThreshold, reason: `token ratio ${ratio.toFixed(3)} >= rebuild threshold ${this.config.rebuildThreshold}` }
    }

    for (const threshold of this.config.checkpointThresholds) {
      if (ratio >= threshold && !this.state.triggeredThresholds.has(threshold)) {
        if (this.state.stepsSinceLastCheckpoint < this.config.minStepsBetweenCheckpoints) {
          return { type: CycleActionType.NOOP, reason: `minStepsBetweenCheckpoints not met (${this.state.stepsSinceLastCheckpoint} < ${this.config.minStepsBetweenCheckpoints})` }
        }
        return { type: CycleActionType.CHECKPOINT, threshold, reason: `token ratio ${ratio.toFixed(3)} >= threshold ${threshold}` }
      }
    }

    return { type: CycleActionType.NOOP, reason: "no threshold triggered" }
  }

  async executeCheckpoint(
    sessionId: string,
    conversationHistory: ConversationMessage[],
    action: CycleAction,
  ): Promise<string | null> {
    this.state.triggeredThresholds.add(action.threshold!)
    this.state.stepsSinceLastCheckpoint = 0

    if (this.checkpointWriter) {
      const checkpointId = await this.checkpointWriter.write(
        sessionId,
        conversationHistory,
        true,
        this.state.cycleIndex,
      )
      this.eventBus?.emit({
        type: "checkpoint:written",
        priority: 1,
        payload: { sessionId, checkpointId, cycleIndex: this.state.cycleIndex, threshold: action.threshold ?? 0 },
        timestamp: Date.now(),
      })
      return checkpointId
    }
    return null
  }

  async executeRebuild(
    sessionId: string,
    action: CycleAction,
  ): Promise<void> {
    await this.callbacks.onCompactingStart?.(sessionId, this.state.cycleIndex)

    this.state.isCompacting = true
    this.eventBus?.emit({
      type: "cycle:compacting:start",
      priority: 1,
      payload: { sessionId, cycleIndex: this.state.cycleIndex, reason: action.reason ?? "" },
      timestamp: Date.now(),
    })

    if (this.stateMachine) {
      try {
        await this.stateMachine.transition(COMPACTING_STATE, action.reason)
      } catch {
        // Transition may fail if not in valid state, ignore
      }
    }

    await this.callbacks.onRebuild?.(sessionId, this.state.cycleIndex)

    this.state.cycleIndex++
    this.state.triggeredThresholds.clear()
    this.state.stepsSinceLastCheckpoint = 0
    this.state.rebuildCount++
    this.state.isCompacting = false
    this.state.totalCyclesCompleted++

    if (this.stateMachine) {
      try {
        await this.stateMachine.transition(READY_STATE, "rebuild complete")
      } catch {
        // Ignore
      }
    }

    this.eventBus?.emit({
      type: "cycle:compacting:end",
      priority: 1,
      payload: { sessionId, cycleIndex: this.state.cycleIndex - 1, newCycleIndex: this.state.cycleIndex },
      timestamp: Date.now(),
    })

    await this.callbacks.onCompactingEnd?.(sessionId, this.state.cycleIndex)
  }

  advanceStep(count = 1): void {
    this.state.stepsSinceLastCheckpoint += count
  }

  reset(): void {
    this.state = createInitialState()
  }

  getSnapshot(): CycleSnapshot {
    return {
      cycleIndex: this.state.cycleIndex,
      triggeredThresholds: [...this.state.triggeredThresholds],
      isCompacting: this.state.isCompacting,
      stepsSinceLastCheckpoint: this.state.stepsSinceLastCheckpoint,
      rebuildCount: this.state.rebuildCount,
      totalCyclesCompleted: this.state.totalCyclesCompleted,
      config: { ...this.config },
    }
  }

  restoreFromSnapshot(snapshot: CycleSnapshot): void {
    this.state = {
      cycleIndex: snapshot.cycleIndex,
      triggeredThresholds: new Set(snapshot.triggeredThresholds),
      isCompacting: snapshot.isCompacting,
      stepsSinceLastCheckpoint: snapshot.stepsSinceLastCheckpoint,
      rebuildCount: snapshot.rebuildCount,
      totalCyclesCompleted: snapshot.totalCyclesCompleted,
    }
    if (snapshot.config) {
      this.config = { ...DEFAULT_CYCLE_CONFIG, ...snapshot.config }
    }
  }
}
