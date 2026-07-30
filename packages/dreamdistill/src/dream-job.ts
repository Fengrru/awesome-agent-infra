/**
 * DreamJob — 7-Day Memory Consolidation
 *
 * Merge duplicate memories (Jaccard fuzzy matching), remove invalid entries,
 * compress verbose entries, update verification counts & confidence decay,
 * write consolidated state back to MEMORY.md.
 *
 * @module dreamdistill/dream-job
 */

import { access } from "node:fs/promises"
import type {
  ProviderAdapter,
  IProjectMemory,
  IEventArchiver,
  MemoryEntry,
  DreamConfig,
  DreamResult,
  DreamMetrics,
} from "./types"
import {
  DEFAULT_DREAM_CONFIG,
  clampConfidence,
  textSimilarity,
  extractFilePaths,
} from "./types"

export class DreamJob {
  readonly config: DreamConfig
  private projectMemory: IProjectMemory | null = null
  private eventArchiver: IEventArchiver | null = null
  private provider: ProviderAdapter | null = null
  private metrics: DreamMetrics = {
    lastDreamAt: null,
    totalDreams: 0,
    totalMerged: 0,
    totalRemoved: 0,
  }
  private lastCheckTime = 0
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(config?: Partial<DreamConfig>) {
    this.config = { ...DEFAULT_DREAM_CONFIG, ...config }
  }

  /** Wire dependencies */
  setProjectMemory(pm: IProjectMemory): void {
    this.projectMemory = pm
  }

  setEventArchiver(archiver: IEventArchiver): void {
    this.eventArchiver = archiver
  }

  setProvider(provider: ProviderAdapter): void {
    this.provider = provider
  }

  // ── Trigger ────────────────────────────────────────────────────────────

  /**
   * Check if a dream cycle should be triggered.
   * Returns true if enough time has passed AND enough entries exist.
   */
  async shouldDream(): Promise<boolean> {
    if (!this.projectMemory) return false

    const now = Date.now()
    const elapsed = now - this.lastCheckTime
    if (elapsed < this.config.intervalMs) return false

    this.lastCheckTime = now
    const allEntries = await this.projectMemory.getAllEntries()
    return allEntries.length >= this.config.minEntriesToConsolidate
  }

  /**
   * Execute a full dream consolidation cycle.
   * Can be called manually or via the timer.
   */
  async dream(): Promise<DreamResult> {
    const startTime = Date.now()

    if (!this.projectMemory) {
      throw new Error("DreamJob: ProjectMemoryManager not configured")
    }

    // Ensure fresh data
    await this.projectMemory.load()

    const allEntries = await this.projectMemory.getAllEntries()
    const entriesBefore = allEntries.length

    let merged = 0
    let removed = 0
    let compressed = 0
    let entries = [...allEntries]

    // Phase 1: Merge duplicates by fuzzy matching
    const mergeResult = this.mergeDuplicates(entries)
    entries = mergeResult.entries
    merged = mergeResult.mergedCount

    // Phase 2: Remove invalid references
    const validResult = await this.removeInvalidEntries(entries)
    entries = validResult.entries
    removed += validResult.removedCount

    // Phase 3: Compress verbose entries (optional LLM)
    if (entries.length > this.config.targetMaxEntries) {
      const compressResult = await this.compressEntries(entries)
      entries = compressResult.entries
      compressed = compressResult.compressedCount
    }

    // Phase 4: Update verification counts for surviving entries
    for (const entry of entries) {
      if (entry.verification_count <= 1 && !entry.user_authored) {
        entry.confidence = Math.max(0.3, entry.confidence - 0.1)
      }
    }

    // Phase 5: Write back — delete all old entries and re-insert
    const existing = await this.projectMemory.getAllEntries()
    for (const e of existing) {
      await this.projectMemory.deleteEntry(e.id)
    }

    for (const entry of entries) {
      await this.projectMemory.upsertEntry({
        section: entry.section,
        content: entry.content,
        verification_count: entry.verification_count,
        confidence: entry.confidence,
        source_sessions: entry.source_sessions,
        user_authored: entry.user_authored,
      })
    }

    const durationMs = Date.now() - startTime

    this.metrics.lastDreamAt = new Date().toISOString()
    this.metrics.totalDreams++
    this.metrics.totalMerged += merged
    this.metrics.totalRemoved += removed

    return {
      entriesBefore,
      entriesAfter: entries.length,
      duplicatesMerged: merged,
      invalidRemoved: removed,
      entriesCompressed: compressed,
      durationMs,
      performedAt: new Date().toISOString(),
    }
  }

  // ── Phase 1: Merge Duplicates ──────────────────────────────────────────

  private mergeDuplicates(entries: MemoryEntry[]): {
    entries: MemoryEntry[]
    mergedCount: number
  } {
    const threshold = this.config.mergeSimilarityThreshold
    const result: MemoryEntry[] = []
    const used = new Set<number>()
    let mergedCount = 0

    for (let i = 0; i < entries.length; i++) {
      if (used.has(i)) continue

      let merged: MemoryEntry = entries[i]!

      for (let j = i + 1; j < entries.length; j++) {
        if (used.has(j)) continue
        if (merged.section !== entries[j]!.section) continue

        const similarity = textSimilarity(merged.content, entries[j]!.content)
        if (similarity >= threshold) {
          merged = {
            ...merged,
            content:
              merged.content.length >= entries[j]!.content.length
                ? merged.content
                : entries[j]!.content,
            verification_count:
              merged.verification_count + entries[j]!.verification_count,
            confidence: Math.max(merged.confidence, entries[j]!.confidence),
            source_sessions: [
              ...new Set([...merged.source_sessions, ...entries[j]!.source_sessions]),
            ],
          }
          used.add(j)
          mergedCount++
        }
      }

      result.push(merged)
      used.add(i)
    }

    return { entries: result, mergedCount }
  }

  // ── Phase 2: Remove Invalid ────────────────────────────────────────────

  private async removeInvalidEntries(
    entries: MemoryEntry[],
  ): Promise<{ entries: MemoryEntry[]; removedCount: number }> {
    const result: MemoryEntry[] = []
    let removedCount = 0

    for (const entry of entries) {
      // Check for file path references in content
      const filePaths = extractFilePaths(entry.content)

      if (filePaths.length > 0) {
        // Verify path existence using fs.access
        let hasInvalidPaths = false
        for (const fp of filePaths.slice(0, 5)) {
          try {
            await access(fp)
          } catch {
            hasInvalidPaths = true
            break
          }
        }
        if (hasInvalidPaths) {
          removedCount++
          continue
        }
      }

      // Remove entries that are too short / meaningless
      if (entry.content.trim().length < 5 && !entry.user_authored) {
        removedCount++
        continue
      }

      result.push(entry)
    }

    return { entries: result, removedCount }
  }

  // ── Phase 3: Compress ─────────────────────────────────────────────────

  private async compressEntries(
    entries: MemoryEntry[],
  ): Promise<{ entries: MemoryEntry[]; compressedCount: number }> {
    if (!this.provider || !this.config.useLLM) {
      return this.simpleCompress(entries)
    }
    return this.llmCompress(entries)
  }

  private simpleCompress(entries: MemoryEntry[]): {
    entries: MemoryEntry[]
    compressedCount: number
  } {
    let compressedCount = 0
    const result: MemoryEntry[] = []

    const sorted = [...entries].sort((a, b) => {
      if (a.user_authored && !b.user_authored) return -1
      if (!a.user_authored && b.user_authored) return 1
      return b.confidence - a.confidence
    })

    for (const entry of sorted) {
      if (result.length < this.config.targetMaxEntries || entry.user_authored) {
        result.push(entry)
      } else {
        compressedCount++
      }
    }

    return { entries: result, compressedCount }
  }

  private async llmCompress(
    entries: MemoryEntry[],
  ): Promise<{ entries: MemoryEntry[]; compressedCount: number }> {
    const bySection = new Map<string, MemoryEntry[]>()
    for (const entry of entries) {
      const list = bySection.get(entry.section) ?? []
      list.push(entry)
      bySection.set(entry.section, list)
    }

    const result: MemoryEntry[] = []
    let compressedCount = 0

    for (const [section, sectionEntries] of bySection) {
      if (sectionEntries.length <= 10) {
        result.push(...sectionEntries)
        continue
      }

      try {
        const entriesText = sectionEntries
          .map((e) => `- [${e.confidence.toFixed(1)}] ${e.content}`)
          .join("\n")

        const response = await this.provider!.chat({
          messages: [
            {
              role: "system",
              content:
                "You are a memory consolidation assistant. Summarize and deduplicate the following knowledge entries. Keep ALL unique information. Merge only truly redundant entries. Output JSON array of condensed entries.",
            },
            {
              role: "user",
              content: `Section: ${section}\n\nEntries:\n${entriesText}\n\nOutput a JSON array of consolidated entries. Each entry: {"content": "...", "confidence": 0.X, "verification_count": N}`,
            },
          ],
        })

        const jsonMatch = response.content.match(/\[[\s\S]*\]/)
        if (jsonMatch) {
          const consolidated = JSON.parse(jsonMatch[0]) as Array<{
            content: string
            confidence: number
            verification_count: number
          }>
          for (const c of consolidated) {
            result.push({
              ...sectionEntries[0]!,
              content: c.content,
              confidence: clampConfidence(c.confidence, sectionEntries[0]!.confidence),
              verification_count: c.verification_count ?? 1,
            })
          }
          compressedCount += sectionEntries.length - consolidated.length
        } else {
          result.push(...sectionEntries)
        }
      } catch {
        result.push(...sectionEntries)
      }
    }

    return { entries: result, compressedCount }
  }

  // ── Timer Management ───────────────────────────────────────────────────

  startTimer(): void {
    if (this.timer) return
    this.timer = setInterval(async () => {
      try {
        if (await this.shouldDream()) {
          await this.dream()
        }
      } catch (err) {
        console.error("[DreamJob] Dream cycle failed:", err)
      }
    }, 60 * 60 * 1000) // Check every hour
  }

  stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  getMetrics(): DreamMetrics {
    return { ...this.metrics }
  }
}
