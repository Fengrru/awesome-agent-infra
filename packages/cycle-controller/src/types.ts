export interface BusEvent {
  type: string
  priority: number
  payload: Record<string, unknown>
  timestamp: number
}

export interface EventBus {
  emit(event: BusEvent): void
}

export type AgentState = string

export interface AgentStateMachine {
  readonly state: AgentState
  transition(to: AgentState, reason?: string): Promise<void>
}

export interface CycleConfig {
  tokenBudget: number
  checkpointThresholds: number[]
  rebuildThreshold: number
  minStepsBetweenCheckpoints: number
  maxCycles: number
}

export const DEFAULT_CYCLE_CONFIG: CycleConfig = {
  tokenBudget: 128_000,
  checkpointThresholds: [0.20, 0.45, 0.70],
  rebuildThreshold: 0.90,
  minStepsBetweenCheckpoints: 5,
  maxCycles: 20,
}

export interface CycleState {
  cycleIndex: number
  triggeredThresholds: Set<number>
  isCompacting: boolean
  stepsSinceLastCheckpoint: number
  rebuildCount: number
  totalCyclesCompleted: number
}

export enum CycleActionType {
  NOOP = "NOOP",
  CHECKPOINT = "CHECKPOINT",
  REBUILD = "REBUILD",
}

export interface CycleAction {
  type: CycleActionType
  threshold?: number
  reason?: string
}

export interface ConversationMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export interface CycleSnapshot {
  cycleIndex: number
  triggeredThresholds: number[]
  isCompacting: boolean
  stepsSinceLastCheckpoint: number
  rebuildCount: number
  totalCyclesCompleted: number
  config: CycleConfig
}

export interface ICheckpointWriter {
  write(
    sessionId: string,
    history: ConversationMessage[],
    isIncremental: boolean,
    cycleIndex: number,
  ): Promise<string>
}

export interface CycleCallbacks {
  onRebuild?: (sessionId: string, cycleIndex: number) => Promise<void>
  onCompactingStart?: (sessionId: string, cycleIndex: number) => Promise<void>
  onCompactingEnd?: (sessionId: string, cycleIndex: number) => Promise<void>
}

export interface CycleControllerOptions {
  config?: Partial<CycleConfig>
  eventBus?: EventBus
  stateMachine?: AgentStateMachine
  checkpointWriter?: ICheckpointWriter
  callbacks?: CycleCallbacks
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}
