/**
 * AgentMetacog — core metacognitive monitoring class.
 * @module agent-metacog/metacog
 */

import { ebbinghausRetention } from "./ebbinghaus"
import type {
  ConsolidationTask,
  DomainKnowledge,
  ForgettingAlert,
  GapSeverity,
  InteractionRecord,
  KnowledgeBoundary,
  KnowledgeGap,
  MetacogConfig,
  MetacogState,
} from "./types"
import { DEFAULT_CONFIG } from "./types"

export class AgentMetacog {
  private config: MetacogConfig
  private domains: Map<string, DomainKnowledge> = new Map()
  private gaps: KnowledgeGap[] = []
  private consolidationQueue: ConsolidationTask[] = []
  private interactionHistory: InteractionRecord[] = []
  private taskIdCounter = 0

  constructor(config?: Partial<MetacogConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  recordInteraction(record: Omit<InteractionRecord, "id">): InteractionRecord {
    const full: InteractionRecord = {
      ...record,
      id: `interaction_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    }
    this.interactionHistory.push(full)

    let domain = this.domains.get(full.domain)
    if (!domain) {
      domain = {
        domain: full.domain,
        confidence: 0.5,
        successes: 0,
        failures: 0,
        lastAccessed: full.timestamp,
        decayRate: Math.log(2) / this.config.decayHalfLifeDays,
      }
      this.domains.set(full.domain, domain)
    }

    if (full.success) {
      domain.successes++
      const total = domain.successes + domain.failures
      if (total > 0) {
        domain.confidence = domain.successes / total
        domain.confidence = Math.min(1, domain.confidence * 1.05)
      }
    } else {
      domain.failures++
      domain.confidence = Math.max(0.05, domain.confidence * 0.9)
      if (full.failureReason) {
        this.addKnowledgeGap(full.domain, full.failureReason)
      }
    }

    domain.lastAccessed = full.timestamp
    return full
  }

  assessKnowledge(domain: string): DomainKnowledge | null {
    const d = this.domains.get(domain)
    if (!d) return null
    const daysSince = this.daysSince(d.lastAccessed)
    const retention = ebbinghausRetention(daysSince, this.config.decayHalfLifeDays)
    const effectiveConfidence = d.confidence * retention
    return { ...d, confidence: Math.max(0, Math.min(1, effectiveConfidence)) }
  }

  getKnowledgeBoundary(): KnowledgeBoundary {
    const knownTopics: string[] = []
    const unknownTopics: string[] = []
    const confidenceByDomain = new Map<string, number>()

    for (const [domain] of this.domains) {
      const assessed = this.assessKnowledge(domain)
      const conf = assessed?.confidence ?? 0
      confidenceByDomain.set(domain, conf)
      if (conf >= 0.6) knownTopics.push(domain)
      else unknownTopics.push(domain)
    }

    return { knownTopics, unknownTopics, confidenceByDomain, gaps: this.getActiveGaps() }
  }

  detectForgetting(): ForgettingAlert[] {
    const alerts: ForgettingAlert[] = []
    for (const [domain, knowledge] of this.domains) {
      const daysSince = this.daysSince(knowledge.lastAccessed)
      const retention = ebbinghausRetention(daysSince, this.config.decayHalfLifeDays)
      if (retention < this.config.forgettingAlertThreshold) {
        let action: ForgettingAlert["action"]
        if (retention < 0.3) action = "urgent_review"
        else if (retention < 0.4) action = "practice"
        else action = "review"
        alerts.push({ domain, retention, daysSinceAccess: Math.round(daysSince * 10) / 10, action })
      }
    }
    alerts.sort((a, b) => a.retention - b.retention)
    return alerts
  }

  shouldConsolidate(): { needed: boolean; reasons: string[] } {
    const reasons: string[] = []
    const alerts = this.detectForgetting()
    if (alerts.length > 0) reasons.push(`${alerts.length} domain(s) at risk of forgetting`)

    const recentInteractions = this.interactionHistory.filter((r) => this.daysSince(r.timestamp) < 1)
    if (recentInteractions.length >= 5) reasons.push(`${recentInteractions.length} recent interactions to consolidate`)

    const criticalGaps = this.gaps.filter((g) => g.severity === "critical")
    if (criticalGaps.length > 0) reasons.push(`${criticalGaps.length} critical knowledge gap(s) need attention`)

    if (this.config.autoConsolidation && reasons.length > 0) this.generateConsolidationTasks()

    return { needed: reasons.length > 0, reasons }
  }

  generateConsolidationTasks(): ConsolidationTask[] {
    const alerts = this.detectForgetting()
    const tasks: ConsolidationTask[] = []

    for (const alert of alerts) {
      const task: ConsolidationTask = {
        id: `consolidate_${++this.taskIdCounter}_${alert.domain}`,
        domain: alert.domain,
        priority: Math.round((1 - alert.retention) * 10),
        reason: `Retention at ${(alert.retention * 100).toFixed(0)}% after ${alert.daysSinceAccess} days`,
        createdAt: new Date(),
        suggestedAction: this.getConsolidationAction(alert.action, alert.domain),
      }
      tasks.push(task)
    }

    const existingDomains = new Set(this.consolidationQueue.map((t) => t.domain))
    for (const task of tasks) {
      if (!existingDomains.has(task.domain)) this.consolidationQueue.push(task)
    }

    this.consolidationQueue.sort((a, b) => b.priority - a.priority)
    this.consolidationQueue = this.consolidationQueue.slice(0, this.config.maxConsolidationQueue)
    return [...this.consolidationQueue]
  }

  dequeueConsolidation(taskId: string): ConsolidationTask | undefined {
    const idx = this.consolidationQueue.findIndex((t) => t.id === taskId)
    if (idx === -1) return undefined
    const [task] = this.consolidationQueue.splice(idx, 1)
    return task
  }

  generateSelfReflection(recentHistory?: InteractionRecord[]): string {
    const history = recentHistory ?? this.interactionHistory.slice(-20)
    if (history.length === 0) return "No recent interactions to reflect on."

    const successRate = history.filter((r) => r.success).length / history.length
    const byDomain = new Map<string, { success: number; total: number }>()
    for (const r of history) {
      const entry = byDomain.get(r.domain) ?? { success: 0, total: 0 }
      entry.total++
      if (r.success) entry.success++
      byDomain.set(r.domain, entry)
    }

    const parts: string[] = []
    parts.push(
      successRate >= 0.8
        ? "I am performing well overall."
        : successRate >= 0.5
          ? "I have room for improvement."
          : "I am struggling with recent tasks.",
    )

    for (const [domain, stats] of byDomain) {
      const rate = stats.total > 0 ? stats.success / stats.total : 0
      if (rate < 0.5) parts.push(`I need to improve in "${domain}" (${(rate * 100).toFixed(0)}% success).`)
      else if (rate >= 0.9 && stats.total >= 3) parts.push(`I am proficient in "${domain}".`)
    }

    const alerts = this.detectForgetting()
    if (alerts.length > 0) {
      const urgent = alerts.filter((a) => a.action === "urgent_review")
      if (urgent.length > 0) parts.push(`URGENT: I should review: ${urgent.map((a) => a.domain).join(", ")}.`)
    }

    return parts.join(" ")
  }

  evaluateMetacognition(): MetacogState {
    const boundary = this.getKnowledgeBoundary()
    const alerts = this.detectForgetting()
    const knownCount = boundary.knownTopics.length
    const totalCount = this.domains.size
    const boundaryAwareness = totalCount > 0 ? knownCount / totalCount : 0.5

    const recentHistory = this.interactionHistory.slice(-30)
    let calibrationScore = 0.5
    if (recentHistory.length > 0) {
      const selfAssessments = recentHistory.filter((r) => r.selfConfidence !== undefined)
      if (selfAssessments.length > 0) {
        let calibrationError = 0
        for (const r of selfAssessments) {
          calibrationError += Math.abs((r.selfConfidence ?? 0.5) - (r.success ? 1 : 0))
        }
        calibrationScore = 1 - calibrationError / selfAssessments.length
      }
    }

    const selfAwarenessScore = boundaryAwareness * 0.6 + calibrationScore * 0.4
    let summary: string
    if (selfAwarenessScore > 0.7)
      summary = `High self-awareness (${(selfAwarenessScore * 100).toFixed(0)}%). ${knownCount} domains well-understood.`
    else if (selfAwarenessScore > 0.4)
      summary = `Moderate self-awareness (${(selfAwarenessScore * 100).toFixed(0)}%). ${alerts.length} domain(s) need refreshing.`
    else
      summary = `Low self-awareness (${(selfAwarenessScore * 100).toFixed(0)}%). Significant knowledge gaps detected.`

    return {
      selfAwarenessScore: Math.max(0, Math.min(1, selfAwarenessScore)),
      knowledgeGaps: this.getActiveGaps(),
      forgettingAlerts: alerts,
      consolidationQueue: [...this.consolidationQueue],
      summary,
    }
  }

  addKnowledgeGap(domain: string, gap: string, severity?: GapSeverity): KnowledgeGap {
    const existing = this.gaps.find((g) => g.domain === domain && this.similarity(g.gap, gap) > 0.6)
    if (existing) {
      existing.occurrenceCount++
      if (existing.occurrenceCount >= 5) existing.severity = "critical"
      else if (existing.occurrenceCount >= 3) existing.severity = "medium"
      return existing
    }
    const newGap: KnowledgeGap = {
      domain,
      gap,
      severity: severity ?? "low",
      detectedAt: new Date(),
      occurrenceCount: 1,
    }
    this.gaps.push(newGap)
    return newGap
  }

  getActiveGaps(): KnowledgeGap[] {
    const now = new Date()
    return this.gaps.filter((g) => {
      const daysOld = (now.getTime() - g.detectedAt.getTime()) / (1000 * 60 * 60 * 24)
      return g.severity !== "low" || daysOld < 7
    })
  }

  clearGapsForDomain(domain: string): number {
    const before = this.gaps.length
    this.gaps = this.gaps.filter((g) => g.domain !== domain)
    return before - this.gaps.length
  }

  getDomainKnowledge(): Map<string, DomainKnowledge> {
    return new Map(this.domains)
  }
  getRecentHistory(count?: number): InteractionRecord[] {
    return this.interactionHistory.slice(-(count ?? 50))
  }
  getConsolidationQueue(): ConsolidationTask[] {
    return [...this.consolidationQueue]
  }

  reset(): void {
    this.domains.clear()
    this.gaps = []
    this.consolidationQueue = []
    this.interactionHistory = []
    this.taskIdCounter = 0
  }

  getConfig(): Readonly<MetacogConfig> {
    return this.config
  }
  updateConfig(partial: Partial<MetacogConfig>): void {
    this.config = { ...this.config, ...partial }
  }

  private daysSince(date: Date): number {
    return (new Date().getTime() - date.getTime()) / (1000 * 60 * 60 * 24)
  }

  private similarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/))
    const wordsB = new Set(b.toLowerCase().split(/\s+/))
    const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)))
    const union = new Set([...wordsA, ...wordsB])
    return union.size > 0 ? intersection.size / union.size : 0
  }

  private getConsolidationAction(action: string, domain: string): string {
    switch (action) {
      case "urgent_review":
        return `Immediately review recent interactions in "${domain}" and practice core concepts.`
      case "practice":
        return `Schedule a practice session for "${domain}" within the next day.`
      case "review":
        return `Review key learnings in "${domain}" to reinforce retention.`
      default:
        return `Consolidate knowledge in "${domain}".`
    }
  }
}

/**
 * Create a {@link AgentMetacog} instance.
 *
 * @param args - Constructor arguments forwarded to {@link AgentMetacog}.
 * @returns A new {@link AgentMetacog}.
 */
export function createAgentMetacog(...args: ConstructorParameters<typeof AgentMetacog>): AgentMetacog {
  return new AgentMetacog(...args)
}
