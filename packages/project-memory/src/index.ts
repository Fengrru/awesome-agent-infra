/**
 * ProjectMemory — File-Based Project Memory with MEMORY.md Persistence
 *
 * Manages a project-level MEMORY.md file, storing knowledge across sessions:
 * project background, user-specified rules, architectural decisions and their
 * rationale, and repeatedly verified technical facts.
 *
 * Features:
 *   - Markdown parsing/rendering with 6 section types
 *   - CRUD with verification_count and confidence tracking
 *   - promoteDiscovery: auto-promote stable facts from checkpoints
 *   - Full-text search with Jaccard-like text overlap dedup
 *   - Dream compaction trigger (when entries exceed maxEntries)
 *
 * Zero runtime dependencies — only Node.js built-in `node:fs/promises`.
 *
 * @module project-memory
 */

import { readFile, writeFile } from "node:fs/promises"

// ── Types ──────────────────────────────────────────────────────────────────

export type MemorySection = "background" | "rules" | "architecture" | "decisions" | "facts" | "patterns"

export interface MemoryEntry {
  /** Unique identifier */
  id: string
  /** Section category */
  section: MemorySection
  /** Human-readable content */
  content: string
  /** Number of times this entry has been verified across checkpoints */
  verification_count: number
  /** Confidence score (0-1) */
  confidence: number
  /** ISO timestamp of creation */
  created_at: string
  /** ISO timestamp of last update */
  updated_at: string
  /** Source session IDs that contributed to this entry */
  source_sessions: string[]
  /** Whether this entry is user-authored (not auto-generated) */
  user_authored: boolean
}

/** Lightweight discovery passed from checkpoint layer */
export interface Discovery {
  id: string
  description: string
  confidence: number
  applicable_to: string[]
}

export interface ProjectMemoryConfig {
  /** Path to the MEMORY.md file */
  filePath: string
  /** Max entries before triggering Dream compaction */
  maxEntries: number
}

export const DEFAULT_CONFIG: ProjectMemoryConfig = {
  filePath: "MEMORY.md",
  maxEntries: 500,
}

// ── Section Headers ────────────────────────────────────────────────────────

const SECTION_HEADERS: Record<MemorySection, string> = {
  background: "## Project Background",
  rules: "## User Rules",
  architecture: "## Architecture Decisions",
  decisions: "## Design Decisions",
  facts: "## Verified Facts",
  patterns: "## Work Patterns",
}

const SECTION_ORDER: MemorySection[] = ["background", "rules", "architecture", "decisions", "facts", "patterns"]

// ── ProjectMemoryManager ──────────────────────────────────────────────────

export class ProjectMemoryManager {
  readonly config: ProjectMemoryConfig
  private entries: MemoryEntry[] = []
  private loaded = false

  constructor(config?: Partial<ProjectMemoryConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  // ── Load / Save ─────────────────────────────────────────────────────────

  /** Load MEMORY.md from disk and parse into entries */
  async load(): Promise<MemoryEntry[]> {
    if (this.loaded) return this.entries

    try {
      const content = await readFile(this.config.filePath, "utf-8")
      this.entries = this.parseMarkdown(content)
    } catch {
      this.entries = []
    }

    this.loaded = true
    return this.entries
  }

  /** Save all entries back to MEMORY.md */
  async save(): Promise<void> {
    const content = this.renderMarkdown(this.entries)
    await writeFile(this.config.filePath, content, "utf-8")
  }

  // ── CRUD ────────────────────────────────────────────────────────────────

  /** Add or update a memory entry */
  async upsertEntry(
    entry: Omit<MemoryEntry, "id" | "created_at" | "updated_at"> & { id?: string },
  ): Promise<MemoryEntry> {
    await this.ensureLoaded()

    const now = new Date().toISOString()
    const existing = entry.id ? this.entries.find((e) => e.id === entry.id) : undefined

    if (existing) {
      existing.content = entry.content
      existing.section = entry.section
      existing.confidence = entry.confidence
      existing.verification_count++
      existing.updated_at = now
      if (entry.source_sessions.length > 0) {
        existing.source_sessions = [...new Set([...existing.source_sessions, ...entry.source_sessions])]
      }
      await this.save()
      return existing
    }

    const newEntry: MemoryEntry = {
      id: entry.id ?? `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      section: entry.section,
      content: entry.content,
      verification_count: entry.verification_count ?? 1,
      confidence: entry.confidence,
      created_at: now,
      updated_at: now,
      source_sessions: entry.source_sessions,
      user_authored: entry.user_authored ?? false,
    }

    this.entries.push(newEntry)
    await this.save()

    return newEntry
  }

  /** Get an entry by ID */
  async getEntry(id: string): Promise<MemoryEntry | undefined> {
    await this.ensureLoaded()
    return this.entries.find((e) => e.id === id)
  }

  /** Delete an entry by ID */
  async deleteEntry(id: string): Promise<boolean> {
    await this.ensureLoaded()
    const idx = this.entries.findIndex((e) => e.id === id)
    if (idx < 0) return false

    this.entries.splice(idx, 1)
    await this.save()
    return true
  }

  /** Get all entries in a section */
  async getSection(section: MemorySection): Promise<MemoryEntry[]> {
    await this.ensureLoaded()
    return this.entries.filter((e) => e.section === section)
  }

  /** Get all entries */
  async getAllEntries(): Promise<MemoryEntry[]> {
    await this.ensureLoaded()
    return [...this.entries]
  }

  // ── Discovery Promotion ──────────────────────────────────────────────────

  /**
   * Promote a stable discovery from session layer to project memory.
   * Called when a discovery has appeared in 3+ checkpoints.
   */
  async promoteDiscovery(sessionId: string, discovery: Discovery, stabilityCount: number): Promise<MemoryEntry> {
    await this.ensureLoaded()

    // Dedup by text overlap
    const existing = this.entries.find(
      (e) => e.section === "facts" && this.textOverlap(e.content, discovery.description) > 0.6,
    )

    if (existing) {
      existing.verification_count++
      existing.confidence = Math.max(existing.confidence, discovery.confidence)
      existing.updated_at = new Date().toISOString()
      if (!existing.source_sessions.includes(sessionId)) {
        existing.source_sessions.push(sessionId)
      }
      await this.save()
      return existing
    }

    return this.upsertEntry({
      section: "facts",
      content: discovery.description,
      verification_count: stabilityCount,
      confidence: discovery.confidence,
      source_sessions: [sessionId],
      user_authored: false,
    })
  }

  // ── Search ──────────────────────────────────────────────────────────────

  /**
   * Full-text search across all entries (simple keyword matching).
   * For production, integrate with HNSW or a proper FTS index.
   */
  async search(query: string, maxResults = 10): Promise<MemoryEntry[]> {
    await this.ensureLoaded()

    const queryTerms = query.toLowerCase().split(/\s+/)
    const scored = this.entries.map((entry) => {
      const text = entry.content.toLowerCase()
      let score = 0
      for (const term of queryTerms) {
        if (text.includes(term)) score++
        if (text.includes(query.toLowerCase())) score += 2
      }
      return { entry, score }
    })

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
      .map((s) => s.entry)
  }

  // ── Should Compact ──────────────────────────────────────────────────────

  /** Whether Dream compaction should be triggered */
  async shouldDream(): Promise<boolean> {
    await this.ensureLoaded()
    return this.entries.length > this.config.maxEntries
  }

  /** Get entry count (useful for monitoring) */
  async getEntryCount(): Promise<number> {
    await this.ensureLoaded()
    return this.entries.length
  }

  // ── Internal Utilities ──────────────────────────────────────────────────

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) await this.load()
  }

  /** Jaccard-like text overlap for dedup */
  private textOverlap(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean))
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean))
    if (wordsA.size === 0 || wordsB.size === 0) return 0
    const intersection = [...wordsA].filter((w) => wordsB.has(w)).length
    const union = new Set([...wordsA, ...wordsB]).size
    return intersection / union
  }

  // ── Markdown Parsing / Rendering ────────────────────────────────────────

  private parseMarkdown(content: string): MemoryEntry[] {
    const entries: MemoryEntry[] = []
    const lines = content.split("\n")
    let currentSection: MemorySection | null = null
    let currentEntry: { id: string; content: string; confidence: number } | null = null

    for (const line of lines) {
      const sectionMatch = Object.entries(SECTION_HEADERS).find(([, header]) => line.startsWith(header))
      if (sectionMatch) {
        // Flush the pending entry under its own section before switching
        if (currentEntry && currentSection) {
          entries.push(this.entryFromParse(currentSection, currentEntry))
          currentEntry = null
        }
        currentSection = sectionMatch[0] as MemorySection
        continue
      }

      if (line.startsWith("- [") && currentSection) {
        if (currentEntry) {
          entries.push(this.entryFromParse(currentSection, currentEntry))
        }

        const match = line.match(/^- \[([^\]]+)\]\s+(.+)/)
        if (match) {
          currentEntry = { id: match[1]!, content: match[2]!, confidence: 1.0 }
        }
      } else if (line.startsWith("  - ") && currentEntry) {
        currentEntry.content += `\n${line.slice(4)}`
      } else if (line.trim().match(/^\[conf:(\d+\.?\d*)\]/) && currentEntry) {
        // Allow leading indentation — renderMarkdown emits "  [conf:X.XX]"
        const confMatch = line.trim().match(/^\[conf:(\d+\.?\d*)\]/)
        if (confMatch) currentEntry.confidence = Number.parseFloat(confMatch[1]!)
      }
    }

    if (currentEntry && currentSection) {
      entries.push(this.entryFromParse(currentSection, currentEntry))
    }

    return entries
  }

  private entryFromParse(
    section: MemorySection,
    parsed: { id: string; content: string; confidence: number },
  ): MemoryEntry {
    const now = new Date().toISOString()
    return {
      id: parsed.id,
      section,
      content: parsed.content,
      verification_count: 1,
      confidence: parsed.confidence,
      created_at: now,
      updated_at: now,
      source_sessions: [],
      user_authored: false,
    }
  }

  private renderMarkdown(entries: MemoryEntry[]): string {
    const lines = ["# Project Memory", ""]

    for (const section of SECTION_ORDER) {
      const sectionEntries = entries.filter((e) => e.section === section)
      if (sectionEntries.length === 0) continue

      lines.push(SECTION_HEADERS[section])
      lines.push("")

      for (const entry of sectionEntries) {
        lines.push(`- [${entry.id}] ${entry.content.replace(/\n/g, "\n    ")}`)
        if (entry.confidence < 1.0) {
          lines.push(`  [conf:${entry.confidence.toFixed(2)}]`)
        }
      }

      lines.push("")
    }

    return `${lines.join("\n")}\n`
  }
}

/**
 * Create a {@link ProjectMemoryManager} instance.
 *
 * @param args - Constructor arguments forwarded to {@link ProjectMemoryManager}.
 * @returns A new {@link ProjectMemoryManager}.
 */
export function createProjectMemoryManager(
  ...args: ConstructorParameters<typeof ProjectMemoryManager>
): ProjectMemoryManager {
  return new ProjectMemoryManager(...args)
}
