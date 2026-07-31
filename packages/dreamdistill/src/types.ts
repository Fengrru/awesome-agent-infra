/**
 * DreamDistill — Shared types for self-improvement cycles.
 * @module dreamdistill/types
 */

/** LLM provider adapter — inject your own implementation */
export interface ProviderAdapter {
  chat(params: {
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>
    temperature?: number
    maxTokens?: number
  }): Promise<{ content: string }>
}

/** Memory section categories */
export type MemorySection = "architecture" | "convention" | "dependency" | "configuration" | "gotcha" | "decision"

/** A single memory entry */
export interface MemoryEntry {
  id: string
  section: MemorySection
  content: string
  verification_count: number
  confidence: number
  source_sessions: string[]
  user_authored: boolean
  created_at: number
  updated_at: number
}

/** Project memory persistence interface */
export interface IProjectMemory {
  load(): Promise<void>
  getAllEntries(): Promise<MemoryEntry[]>
  deleteEntry(id: string): Promise<void>
  upsertEntry(entry: {
    section: MemorySection
    content: string
    verification_count: number
    confidence: number
    source_sessions: string[]
    user_authored: boolean
  }): Promise<MemoryEntry>
}

/** An archived event row */
export interface EventRow {
  event_type: string
  timestamp: number
  session_id: string
  payload: Record<string, unknown>
}

/** Event archiver for reading historical session data */
export interface IEventArchiver {
  queryEvents(sessionId: string, limit?: number): Promise<EventRow[]>
  getSessionIds(limit?: number): Promise<string[]>
}

/** Skill registrar interface for auto-registration of distilled skills */
export interface ISkillRegistrar {
  registerSkill(name: string, content: string, type: string): Promise<void>
  hasSkill(name: string): boolean
}

// ─── DreamJob Types ─────────────────────────────────────────────────────────

export interface DreamConfig {
  /** Interval between dream cycles in milliseconds (default: 7 days) */
  intervalMs: number
  /** Minimum number of entries to trigger consolidation */
  minEntriesToConsolidate: number
  /** Similarity threshold for merging duplicates (0-1) */
  mergeSimilarityThreshold: number
  /** Whether to use LLM for intelligent summarization */
  useLLM: boolean
  /** Max entries after consolidation (triggers aggressive compression) */
  targetMaxEntries: number
}

export const DEFAULT_DREAM_CONFIG: DreamConfig = {
  intervalMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  minEntriesToConsolidate: 50,
  mergeSimilarityThreshold: 0.7,
  useLLM: false,
  targetMaxEntries: 300,
}

export interface DreamResult {
  /** Number of entries before consolidation */
  entriesBefore: number
  /** Number of entries after consolidation */
  entriesAfter: number
  /** Number of duplicate pairs merged */
  duplicatesMerged: number
  /** Number of invalid entries removed */
  invalidRemoved: number
  /** Number of entries compressed */
  entriesCompressed: number
  /** Duration in ms */
  durationMs: number
  /** ISO timestamp */
  performedAt: string
}

export interface DreamMetrics {
  /** Timestamp of last dream cycle */
  lastDreamAt: string | null
  /** Total dream cycles performed */
  totalDreams: number
  /** Total entries merged over all cycles */
  totalMerged: number
  /** Total entries removed over all cycles */
  totalRemoved: number
}

// ─── DistillJob Types ───────────────────────────────────────────────────────

export interface DistillConfig {
  /** Interval between distill cycles in ms (default: 30 days) */
  intervalMs: number
  /** Minimum sessions to analyze before triggering */
  minSessions: number
  /** Output directory for generated artifacts */
  outputDir: string
  /** Whether to use LLM for pattern recognition */
  useLLM: boolean
  /** Max sessions to analyze per cycle */
  maxSessionsToAnalyze: number
}

export const DEFAULT_DISTILL_CONFIG: DistillConfig = {
  intervalMs: 30 * 24 * 60 * 60 * 1000, // 30 days
  minSessions: 10,
  outputDir: ".fengru/distilled",
  useLLM: false,
  maxSessionsToAnalyze: 50,
}

export interface SessionPattern {
  name: string
  description: string
  frequency: number
  matchedSessions: string[]
  taskSequence: string[]
  typicalDuration: { min: number; max: number; avg: number }
  commonCapabilities: string[]
}

export interface DistilledArtifact {
  type: "skill" | "command" | "agent" | "sop"
  name: string
  description: string
  content: string
  filePath: string
}

export interface DistillResult {
  sessionsAnalyzed: number
  patternsFound: SessionPattern[]
  artifactsGenerated: DistilledArtifact[]
  durationMs: number
  performedAt: string
}

export interface DistillMetrics {
  lastDistillAt: string | null
  totalDistills: number
  totalArtifactsGenerated: number
  totalPatternsFound: number
}

// ─── Shared Helpers ────────────────────────────────────────────────────────

export function clampConfidence(value: number, fallback: number): number {
  if (Number.isNaN(value) || value < 0 || value > 1) return fallback
  return value
}

/** Jaccard-like text similarity for dedup */
export function textSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean))
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean))
  if (wordsA.size === 0 || wordsB.size === 0) return 0
  const intersection = [...wordsA].filter((w) => wordsB.has(w)).length
  const union = new Set([...wordsA, ...wordsB]).size
  return intersection / union
}

/** Extract potential file paths from text */
export function extractFilePaths(text: string): string[] {
  const patterns = [
    /`?([a-zA-Z0-9_\-/.]+\.(ts|js|tsx|jsx|py|go|rs|java|json|yaml|yml|md|css|html))`?/g,
    /(?:file|path|see|in)\s+`?([a-zA-Z0-9_\-/.]+)`?/gi,
  ]
  const paths: string[] = []
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      paths.push(match[1]!)
    }
  }
  return [...new Set(paths)]
}
