/**
 * Memory engine v2 — shared types, enums, interfaces, and helpers.
 * @module memory-engine-v2/types
 */

import { randomUUID } from "node:crypto"

// ─── Enums ─────────────────────────────────────────────────────────────

export enum MemoryType {
  WORKING = "working",
  SHORT_TERM = "short_term",
  LONG_TERM = "long_term",
  EPISODIC = "episodic",
  SEMANTIC = "semantic",
}

export enum MemoryPriority {
  LOW = 0,
  MEDIUM = 1,
  HIGH = 2,
  CRITICAL = 3,
}

export enum SleepStage {
  AWAKE = "awake",
  N1_LIGHT_SLEEP = "n1",
  N2_LIGHT_SLEEP = "n2",
  N3_SLOW_WAVE = "n3",
  REM = "rem",
  CONSOLIDATION = "consolidation",
}

export enum ConfidenceLevel {
  HIGH = "high",
  MEDIUM = "medium",
  LOW = "low",
  VERY_LOW = "very_low",
}

// ─── Core interfaces ───────────────────────────────────────────────────

export interface MemoryItem {
  id: string
  content: unknown
  memoryType: MemoryType
  timestamp: number
  importance: number
  accessCount: number
  lastAccessed: number
  metadata: Record<string, unknown>
  embedding?: number[]
  emotionScore: number
  confidence: number
}

export interface AttentionWeight {
  importance: number
  recency: number
  relevance: number
  emotion: number
  total: number
}

export interface ConsolidationResult {
  memoriesProcessed: number
  memoriesConsolidated: number
  memoriesForgotten: number
  memoriesTransferred: number
  durationMs: number
  stageStats: Record<string, number>
}

export interface MemoryAwareness {
  totalMemories: number
  memoryDistribution: Record<string, number>
  averageImportance: number
  retrievalSuccessRate: number
  consolidationNeeded: boolean
  forgettingRate: number
  confidenceLevel: ConfidenceLevel
}

export interface MemoryDecision {
  action: "direct_recall" | "augmented_retrieval" | "external_tool" | "model_collaboration"
  confidence: number
  source: string
  reasoning: string
  estimatedCost: number
  metadata: Record<string, unknown>
}

// ─── Config interfaces ─────────────────────────────────────────────────

export interface MemoryConfig {
  workingMemoryCapacity: number
  shortTermMemoryDurationMs: number
  shortTermMemoryCapacity: number
  enableSemanticMemory: boolean
}

export interface SleepConfig {
  consolidationThreshold: number
  forgettingThreshold: number
  replayImportanceBoost: number
  maxConsolidationCycles: number
  autoConsolidateInterval: number
  enableReplay: boolean
  enableForgetting: boolean
  enableAssociation: boolean
}

export interface MetaMemoryConfig {
  highConfidenceThreshold: number
  mediumConfidenceThreshold: number
  lowConfidenceThreshold: number
  enableMonitoring: boolean
  enableAdaptation: boolean
}

export interface AttentionConfig {
  importanceWeight: number
  recencyWeight: number
  relevanceWeight: number
  emotionWeight: number
  recencyDecayHours: number
  minAttentionThreshold: number
}

// ─── Default configs ───────────────────────────────────────────────────

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  workingMemoryCapacity: 7,
  shortTermMemoryDurationMs: 3600000,
  shortTermMemoryCapacity: 100,
  enableSemanticMemory: true,
}

export const DEFAULT_SLEEP_CONFIG: SleepConfig = {
  consolidationThreshold: 0.4,
  forgettingThreshold: 0.2,
  replayImportanceBoost: 0.15,
  maxConsolidationCycles: 100,
  autoConsolidateInterval: 100,
  enableReplay: true,
  enableForgetting: true,
  enableAssociation: true,
}

export const DEFAULT_META_MEMORY_CONFIG: MetaMemoryConfig = {
  highConfidenceThreshold: 0.8,
  mediumConfidenceThreshold: 0.5,
  lowConfidenceThreshold: 0.3,
  enableMonitoring: true,
  enableAdaptation: true,
}

export const DEFAULT_ATTENTION_CONFIG: AttentionConfig = {
  importanceWeight: 0.3,
  recencyWeight: 0.2,
  relevanceWeight: 0.4,
  emotionWeight: 0.1,
  recencyDecayHours: 24,
  minAttentionThreshold: 0.1,
}

// ─── Helper functions ──────────────────────────────────────────────────

export function generateId(): string {
  return randomUUID()
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function createMemoryItem(
  content: unknown,
  memoryType: MemoryType,
  overrides?: Partial<Omit<MemoryItem, "id" | "content" | "memoryType" | "timestamp" | "accessCount" | "lastAccessed">>,
): MemoryItem {
  const now = Date.now()
  return {
    id: generateId(),
    content,
    memoryType,
    timestamp: now,
    importance: clamp(overrides?.importance ?? 0.5, 0, 1),
    accessCount: 0,
    lastAccessed: now,
    metadata: overrides?.metadata ?? {},
    embedding: overrides?.embedding,
    emotionScore: clamp(overrides?.emotionScore ?? 0, -1, 1),
    confidence: clamp(overrides?.confidence ?? 0.5, 0, 1),
  }
}
