/**
 * Sleep consolidation and memory health monitoring.
 * @module agent-metacog/health
 */

import type {
  SleepStage, SleepConsolidationState, MemoryHealthReport,
  DomainHealthItem, ForgettingAlert,
} from "./types"
import { ebbinghausRetention } from "./ebbinghaus"
import { AgentMetacog } from "./metacog"

// ═══════════════════════════════════════════════════════════════════════════
// SleepConsolidator
// ═══════════════════════════════════════════════════════════════════════════

export class SleepConsolidator {
  private stage: SleepStage = "awake"
  private transferredCount = 0
  private createdAssociations = 0
  private prunedCount = 0

  private static readonly STAGE_ORDER: SleepStage[] = [
    "awake", "n1_light_sleep", "n2_light_sleep",
    "n3_slow_wave", "rem", "consolidation",
  ]

  get currentStage(): SleepStage { return this.stage }

  get state(): SleepConsolidationState {
    const idx = SleepConsolidator.STAGE_ORDER.indexOf(this.stage)
    const progress = idx >= 0 ? idx / (SleepConsolidator.STAGE_ORDER.length - 1) : 0
    return { currentStage: this.stage, transferredCount: this.transferredCount, createdAssociations: this.createdAssociations, prunedCount: this.prunedCount, progress }
  }

  advanceStage(memories: Array<{ importance: number; accessedAt: Date }>): SleepConsolidationState {
    const currentIdx = SleepConsolidator.STAGE_ORDER.indexOf(this.stage)
    const nextIdx = (currentIdx + 1) % SleepConsolidator.STAGE_ORDER.length
    const nextStage = SleepConsolidator.STAGE_ORDER[nextIdx]!

    switch (nextStage) {
      case "n3_slow_wave":
        this.transferredCount += memories.filter(m => m.importance > 0.5).length
        break
      case "rem":
        this.createdAssociations += Math.floor(this.transferredCount * 0.3)
        break
      case "consolidation":
        this.prunedCount += memories.filter(m => m.importance < 0.1 && (Date.now() - m.accessedAt.getTime()) > 7 * 24 * 3600 * 1000).length
        break
    }

    this.stage = nextStage
    return this.state
  }

  runFullCycle(memories: Array<{ importance: number; accessedAt: Date }>): SleepConsolidationState {
    for (let i = 0; i < SleepConsolidator.STAGE_ORDER.length; i++) this.advanceStage(memories)
    return this.state
  }

  reset(): void {
    this.stage = "awake"
    this.transferredCount = 0
    this.createdAssociations = 0
    this.prunedCount = 0
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Memory Health Monitoring
// ═══════════════════════════════════════════════════════════════════════════

export function monitorMemoryHealth(metacog: AgentMetacog): MemoryHealthReport {
  const boundary = metacog.getKnowledgeBoundary()
  const alerts = metacog.detectForgetting?.() ?? []
  const queue = metacog.getConsolidationQueue()

  const domainHealth: DomainHealthItem[] = []
  let totalConfidence = 0
  let totalRetention = 0
  let domainCount = 0

  const now = new Date()
  for (const [domain, knowledge] of metacog.getDomainKnowledge()) {
    const assessed = metacog.assessKnowledge(domain)
    const confidence = assessed?.confidence ?? 0
    const daysSince = (now.getTime() - knowledge.lastAccessed.getTime()) / (1000 * 60 * 60 * 24)
    const config = metacog.getConfig()
    const retention = ebbinghausRetention(daysSince, config.decayHalfLifeDays)
    const domainGaps = boundary.gaps.filter(g => g.domain === domain).length

    let status: "healthy" | "at_risk" | "critical" = "healthy"
    if (retention < 0.3 || confidence < 0.3) status = "critical"
    else if (retention < 0.5 || confidence < 0.5 || domainGaps > 0) status = "at_risk"

    domainHealth.push({ domain, confidence, retention, gapCount: domainGaps, status })
    totalConfidence += confidence
    totalRetention += retention
    domainCount++
  }

  const avgConfidence = domainCount > 0 ? totalConfidence / domainCount : 0
  const avgRetention = domainCount > 0 ? totalRetention / domainCount : 0
  const gapPenalty = Math.min(0.5, boundary.gaps.length * 0.05)
  const alertPenalty = Math.min(0.3, alerts.length * 0.05)
  const healthScore = Math.max(0, (avgConfidence * 0.3 + avgRetention * 0.3) - gapPenalty - alertPenalty + 0.4)
  const recommendations = getOptimizationRecommendations(domainHealth, alerts, queue.length)

  return {
    healthScore: Math.max(0, Math.min(1, healthScore)),
    domainCount,
    avgConfidence,
    avgRetention,
    activeGaps: boundary.gaps.length,
    forgettingAlerts: alerts.length,
    consolidationBacklog: queue.length,
    domainHealth,
    recommendations,
  }
}

export function getOptimizationRecommendations(
  domainHealth: DomainHealthItem[],
  alerts: ForgettingAlert[],
  consolidationBacklog: number,
): string[] {
  const recommendations: string[] = []

  const criticalDomains = domainHealth.filter(d => d.status === "critical")
  if (criticalDomains.length > 0) {
    recommendations.push(`URGENT: ${criticalDomains.length} domain(s) are in critical state: ` + criticalDomains.map(d => d.domain).join(", ") + ". Review immediately.")
  }

  const atRiskDomains = domainHealth.filter(d => d.status === "at_risk")
  if (atRiskDomains.length > 0) recommendations.push(`${atRiskDomains.length} domain(s) are at risk and should be reviewed soon.`)

  const urgentAlerts = alerts.filter(a => a.action === "urgent_review")
  if (urgentAlerts.length > 0) recommendations.push(`${urgentAlerts.length} domain(s) need urgent review due to low retention.`)

  if (consolidationBacklog > 5) recommendations.push(`Consolidation backlog is high (${consolidationBacklog} tasks). Consider increasing processing priority.`)

  const healthyCount = domainHealth.filter(d => d.status === "healthy").length
  if (healthyCount === 0 && domainHealth.length > 0) recommendations.push("No healthy domains detected. Consider fundamental knowledge review.")

  const lowConfidenceDomains = domainHealth.filter(d => d.confidence < 0.4)
  if (lowConfidenceDomains.length > 0) recommendations.push(`Low confidence in ${lowConfidenceDomains.length} domain(s). Schedule focused practice sessions.`)

  const highDecayDomains = domainHealth.filter(d => d.retention < 0.4 && d.gapCount > 0)
  if (highDecayDomains.length > 0) recommendations.push(`${highDecayDomains.length} domain(s) have both low retention and active gaps. Prioritize these for review.`)

  if (recommendations.length === 0) recommendations.push("Memory health is good. Continue regular review practices.")
  return recommendations
}
