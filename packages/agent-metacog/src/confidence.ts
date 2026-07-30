/**
 * Confidence estimation and query analysis utilities.
 * @module agent-metacog/confidence
 */

import type { MemoryStatistics } from "./types"

/**
 * Estimate confidence in the agent's ability to answer a query,
 * using multiple weighted factors (MetaMemory approach).
 */
export function estimateConfidence(query: string, stats: MemoryStatistics): number {
  const availabilityFactor = stats.totalMemories > 0
    ? Math.min(1, stats.domainMemories / Math.max(stats.totalMemories, 1))
    : 0.3
  const successFactor = stats.successRate
  const complexity = estimateQueryComplexity(query)
  const complexityFactor = 1.0 - complexity
  const freshnessFactor = stats.recentRatio
  const coverage = estimateCoverage(query, stats)
  const coverageFactor = coverage

  let confidence = 0.5
  confidence += availabilityFactor * 0.20
  confidence += successFactor * 0.25
  confidence += complexityFactor * 0.20
  confidence += freshnessFactor * 0.15
  confidence += coverageFactor * 0.20

  return Math.max(0, Math.min(1, confidence))
}

/**
 * Estimate query complexity using 7 heuristic factors.
 */
export function estimateQueryComplexity(query: string): number {
  let score = 0
  const q = query.trim()
  if (q.length === 0) return 0.3

  const wordCount = q.split(/\s+/).length
  score += Math.min(0.25, wordCount / 50)

  const subQuestionCount = (q.match(/[?,;]/g) ?? []).length
  score += Math.min(0.15, subQuestionCount / 5)
  if (/\b\d+\.\s/.test(q)) score += 0.1

  const reasoningPatterns = [
    /\b(explain|describe|elaborate|clarify)\b/i,
    /\b(analyze|evaluate|assess|examine)\b/i,
    /\b(prove|derive|demonstrate|show\s+that)\b/i,
    /\b(compare|contrast|differentiate)\b/i,
    /\b(implement|design|create|build|develop)\b/i,
  ]
  const reasoningHits = reasoningPatterns.filter(p => p.test(q)).length
  score += Math.min(0.2, reasoningHits * 0.07)

  if (/\bwhy\b/i.test(q)) score += 0.08
  if (/\bhow\b/i.test(q)) score += 0.07
  if (/\bwhat\s+if\b/i.test(q)) score += 0.05

  const technicalTerms = [
    /\b(algorithm|complexity|topology|theorem|lemma)\b/i,
    /\b(neural|transformer|embedding|gradient|backprop(?:agation)?)\b/i,
    /\b(database|schema|index|query|transaction|partition)\b/i,
    /\b(concurrency|parallelism|asynchronous|distributed)\b/i,
    /\b(cryptography|encryption|hashing|security|authentication)\b/i,
    /\b(optimization|constraint|heuristic|pipeline)\b/i,
  ]
  const techHits = technicalTerms.filter(p => p.test(q)).length
  score += Math.min(0.15, techHits * 0.05)

  const logicPatterns = [
    /\bif\s+.*\s+then\b/i, /\bunless\b/i, /\balthough\b/i,
    /\b(either|neither)\b/i, /\b(otherwise|alternatively)\b/i,
    /\bprovided\s+that\b/i,
  ]
  const logicHits = logicPatterns.filter(p => p.test(q)).length
  score += Math.min(0.1, logicHits * 0.04)

  const comparativePatterns = [
    /\b(better|worse|faster|slower)\b/i,
    /\b(versus|vs\.?)\b/i,
    /\b(advantages?|disadvantages?|pros?|cons?)\b/i,
    /\b(compared\s+to|in\s+comparison)\b/i,
    /\b(trade[\s-]off|pros?\s+and\s+cons?)\b/i,
  ]
  const compHits = comparativePatterns.filter(p => p.test(q)).length
  score += Math.min(0.07, compHits * 0.035)

  return Math.max(0.1, Math.min(1, score))
}

/**
 * Detect whether a query requires computation (math, arithmetic, calculation).
 */
export function isComputationQuery(query: string): boolean {
  const q = query.toLowerCase()
  const explicitPatterns = [
    /\b(calculate|compute|solve|find\s+the\s+value)\b/i,
    /\b(evaluate\s+the\s+expression|simplify|factor(?:ize)?)\b/i,
    /\b(what\s+is\s+\d+\s*[+\-*/×÷])/i,
    /\b(convert|translate\s+(?:to|from))\b/i,
  ]
  if (explicitPatterns.some(p => p.test(q))) return true
  if (/\d+\s*[+\-*/×÷]\s*\d+/.test(q)) return true
  if (/=\s*\?/.test(q)) return true
  if (/\b\d+(?:\.\d+)?\s*[%]\b/.test(q)) return true
  if (/\b(?:in|to)\s+(?:meters?|feet|inches?|cm|km|miles?|kg|lb|pounds?|dollars?|euros?|yen)\b/i.test(q)) return true
  return false
}

/**
 * Estimate how well the stored knowledge covers a given query topic.
 */
export function estimateCoverage(query: string, stats: MemoryStatistics): number {
  if (stats.totalMemories === 0) return 0
  if (stats.domainMemories === 0) return 0.1
  let coverage = stats.domainMemories / stats.totalMemories
  coverage = coverage * 0.7 + stats.recentRatio * 0.3
  const keywords = extractKeywords(query)
  if (keywords.length >= 3) coverage = Math.min(1, coverage * 1.2)
  return Math.max(0, Math.min(1, coverage))
}

function extractKeywords(query: string): string[] {
  const stopWords = new Set([
    "a", "an", "the", "is", "are", "was", "were", "be", "been",
    "of", "in", "to", "for", "with", "on", "at", "by", "from",
    "it", "its", "this", "that", "these", "those", "i", "you",
    "he", "she", "we", "they", "and", "or", "but", "not", "so",
    "can", "will", "would", "could", "should", "do", "does", "did",
    "what", "how", "why", "when", "where", "which", "who",
    "please", "just", "very", "really", "only", "also", "then",
  ])
  return query.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w))
}
