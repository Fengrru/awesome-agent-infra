/**
 * GuardRail — Runtime safety guard for AI agents.
 *
 * Provides:
 * - Risk level classification (0=read-only → 3=destructive)
 * - Entropy monitoring with 6 control actions
 * - Configurable thresholds for token budget, failures, validation
 */

export type RiskLevel = 0 | 1 | 2 | 3
export type ControlAction = "CONTINUE" | "ALERT" | "DEGRADE" | "PAUSE" | "ROLLBACK" | "TERMINATE"

export interface EntropyMetrics {
  totalSteps: number
  retryCount: number
  consecutiveFailures: number
  cumulativeTokens: number
  executionTimeMs: number
  validationPassRate: number
  resultDivergence: number
  staleNodeCount?: number
  totalMemoryNodes?: number
  contradictionEntropy?: number
}

export interface EntropyConfig {
  tokenBudget: number
  maxConsecutiveFailures: number
  minValidationPassRate: number
  maxResultDivergence: number
}

export const DEFAULT_ENTROPY_CONFIG: EntropyConfig = {
  tokenBudget: 1_000_000,
  maxConsecutiveFailures: 3,
  minValidationPassRate: 0.3,
  maxResultDivergence: 0.5,
}

export class EntropyController {
  private config: EntropyConfig
  private actionHistory: Array<{ action: ControlAction; timestamp: number; reason: string }> = []
  private researchMode = false

  constructor(config?: Partial<EntropyConfig>) {
    this.config = { ...DEFAULT_ENTROPY_CONFIG, ...config }
  }

  enableResearchMode(): void { this.researchMode = true }

  evaluate(metrics: EntropyMetrics): ControlAction {
    const reasons: string[] = []

    if (metrics.cumulativeTokens > this.config.tokenBudget) {
      return this.act("TERMINATE", "Token budget exceeded")
    }
    if (metrics.cumulativeTokens > this.config.tokenBudget * 0.9) {
      return this.act("ALERT", `Token budget near exhaustion: ${metrics.cumulativeTokens}/${this.config.tokenBudget}`)
    }

    if (metrics.contradictionEntropy !== undefined) {
      if (metrics.contradictionEntropy > 0.5) {
        return this.act("PAUSE", `Critical contradiction entropy: ${Math.round(metrics.contradictionEntropy * 100)}%`)
      }
      if (metrics.contradictionEntropy > 0.3) {
        return this.act("DEGRADE", `High contradiction entropy: ${Math.round(metrics.contradictionEntropy * 100)}%`)
      }
    }

    if (metrics.consecutiveFailures > this.config.maxConsecutiveFailures) {
      if (this.researchMode) return this.act("PAUSE", `Consecutive failures: ${metrics.consecutiveFailures} (research mode)`)
      return this.act("DEGRADE", `Consecutive failures: ${metrics.consecutiveFailures}`)
    }

    if (metrics.resultDivergence > this.config.maxResultDivergence && metrics.cumulativeTokens > this.config.tokenBudget * 0.5) {
      return this.act("PAUSE", `Result divergence: ${metrics.resultDivergence}`)
    }

    if (metrics.validationPassRate < this.config.minValidationPassRate) {
      if (this.researchMode) return this.act("PAUSE", `Low validation: ${metrics.validationPassRate} (research mode)`)
      return this.act("ROLLBACK", `Low validation pass rate: ${metrics.validationPassRate}`)
    }

    return this.act("CONTINUE", "")
  }

  private act(action: ControlAction, reason: string): ControlAction {
    this.actionHistory.push({ action, timestamp: Date.now(), reason })
    if (this.actionHistory.length > 100) this.actionHistory = this.actionHistory.slice(-100)
    return action
  }

  getActionHistory() { return [...this.actionHistory] }
  reset() { this.actionHistory = [] }
  updateConfig(config: Partial<EntropyConfig>) { this.config = { ...this.config, ...config } }
}

/** Risk classification helpers */
export const RISK_LABELS: Record<RiskLevel, string> = {
  0: "read-only",
  1: "local-modify",
  2: "global-impact",
  3: "destructive",
}

export function describeRisk(level: RiskLevel): string {
  return RISK_LABELS[level] ?? "unknown"
}

export function isDestructive(level: RiskLevel): boolean {
  return level >= 3
}

export function requiresConfirmation(level: RiskLevel): boolean {
  return level >= 2
}
