/**
 * AgentMetacog — shared types and interfaces.
 * @module agent-metacog/types
 */

export type GapSeverity = "low" | "medium" | "critical"

export interface KnowledgeGap {
  domain: string
  gap: string
  severity: GapSeverity
  detectedAt: Date
  occurrenceCount: number
}

export interface DomainKnowledge {
  domain: string
  confidence: number
  successes: number
  failures: number
  lastAccessed: Date
  decayRate: number
}

export interface KnowledgeBoundary {
  knownTopics: string[]
  unknownTopics: string[]
  confidenceByDomain: Map<string, number>
  gaps: KnowledgeGap[]
}

export interface ForgettingAlert {
  domain: string
  retention: number
  daysSinceAccess: number
  action: "review" | "practice" | "urgent_review"
}

export interface ConsolidationTask {
  id: string
  domain: string
  priority: number
  reason: string
  createdAt: Date
  suggestedAction: string
}

export interface MetacogState {
  selfAwarenessScore: number
  knowledgeGaps: KnowledgeGap[]
  forgettingAlerts: ForgettingAlert[]
  consolidationQueue: ConsolidationTask[]
  summary: string
}

export interface InteractionRecord {
  id: string
  domain: string
  query: string
  success: boolean
  timestamp: Date
  selfConfidence?: number
  failureReason?: string
}

export interface MetacogConfig {
  decayHalfLifeDays: number
  forgettingAlertThreshold: number
  minGapOccurrences: number
  maxConsolidationQueue: number
  autoConsolidation: boolean
}

export interface MemoryStatistics {
  totalMemories: number
  domainMemories: number
  recentRatio: number
  successRate: number
  averageAgeDays: number
}

export type SleepStage = "awake" | "n1_light_sleep" | "n2_light_sleep" | "n3_slow_wave" | "rem" | "consolidation"

export interface SleepConsolidationState {
  currentStage: SleepStage
  transferredCount: number
  createdAssociations: number
  prunedCount: number
  progress: number
}

export interface DomainHealthItem {
  domain: string
  confidence: number
  retention: number
  gapCount: number
  status: "healthy" | "at_risk" | "critical"
}

export interface MemoryHealthReport {
  healthScore: number
  domainCount: number
  avgConfidence: number
  avgRetention: number
  activeGaps: number
  forgettingAlerts: number
  consolidationBacklog: number
  domainHealth: DomainHealthItem[]
  recommendations: string[]
}

export const DEFAULT_CONFIG: MetacogConfig = {
  decayHalfLifeDays: 7,
  forgettingAlertThreshold: 0.5,
  minGapOccurrences: 2,
  maxConsolidationQueue: 10,
  autoConsolidation: true,
}
