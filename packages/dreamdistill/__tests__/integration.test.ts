/**
 * Integration tests — dreamdistill × project-memory × archiver cross-package wiring.
 *
 * Tests the end-to-end flow where DreamJob and DistillJob are wired to
 * real ProjectMemoryManager and EventArchiver implementations through
 * their interfaces, verifying correct cross-package behavior.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

// dreamdistill
import { DreamJob, DistillJob } from "../src/index"
import type { IEventArchiver, IProjectMemory, MemoryEntry, EventRow, MemorySection, ProviderAdapter } from "../src/types"

// project-memory (cross-package import)
import { ProjectMemoryManager } from "../../project-memory/src/index"
import type { MemorySection as PMMemorySection, MemoryEntry as PMMemoryEntry } from "../../project-memory/src/index"

// ── Helpers ────────────────────────────────────────────────────────────────

let tempDir: string

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "dreamdistill-integration-"))
})

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

/** Create a ProjectMemoryManager pointed at a temp MEMORY.md */
async function createMemory(fileName: string, initialContent?: string): Promise<ProjectMemoryManager> {
  const filePath = join(tempDir, fileName)
  if (initialContent) {
    await writeFile(filePath, initialContent, "utf-8")
  }
  return new ProjectMemoryManager({ filePath })
}

/** Create a simple event archiver with known events */
function createArchiver(events: EventRow[] = []): IEventArchiver {
  const bySession = new Map<string, EventRow[]>()
  for (const e of events) {
    const list = bySession.get(e.session_id) ?? []
    list.push(e)
    bySession.set(e.session_id, list)
  }
  return {
    async queryEvents(sessionId: string, limit?: number): Promise<EventRow[]> {
      const rows = bySession.get(sessionId) ?? []
      return limit ? rows.slice(0, limit) : rows
    },
    async getSessionIds(): Promise<string[]> {
      return [...bySession.keys()]
    },
  }
}

/** Provider that echoes back the input as-is */
function echoProvider(): ProviderAdapter {
  return {
    async chat(params) {
      const lastMsg = params.messages[params.messages.length - 1]?.content ?? ""
      return { content: lastMsg }
    },
  }
}

// ── MemoryEntry Adapter ─────────────────────────────────────────────────────

/**
 * Adapts ProjectMemoryManager to the IProjectMemory interface expected by DreamJob.
 * Bridges the different MemorySection enums and shape differences.
 */
class ProjectMemoryAdapter implements IProjectMemory {
  constructor(private pm: ProjectMemoryManager) {}

  async load(): Promise<void> {
    await this.pm.load()
  }

  async getAllEntries(): Promise<MemoryEntry[]> {
    const entries = await this.pm.getAllEntries()
    return entries.map((e) => ({
      id: e.id,
      section: mapSection(e.section),
      content: e.content,
      verification_count: e.verification_count,
      confidence: e.confidence,
      source_sessions: e.source_sessions,
      user_authored: e.user_authored,
      created_at: Date.parse(e.created_at),
      updated_at: Date.parse(e.updated_at),
    }))
  }

  async deleteEntry(id: string): Promise<void> {
    await this.pm.deleteEntry(id)
  }

  async upsertEntry(entry: {
    section: MemorySection
    content: string
    verification_count: number
    confidence: number
    source_sessions: string[]
    user_authored: boolean
  }): Promise<MemoryEntry> {
    const result = await this.pm.upsertEntry({
      section: mapSectionReverse(entry.section),
      content: entry.content,
      verification_count: entry.verification_count,
      confidence: entry.confidence,
      source_sessions: entry.source_sessions,
      user_authored: entry.user_authored,
    })
    return {
      id: result.id,
      section: mapSection(result.section),
      content: result.content,
      verification_count: result.verification_count,
      confidence: result.confidence,
      source_sessions: result.source_sessions,
      user_authored: result.user_authored,
      created_at: Date.parse(result.created_at),
      updated_at: Date.parse(result.updated_at),
    }
  }
}

function mapSection(s: PMMemorySection): MemorySection {
  const m: Record<string, MemorySection> = {
    background: "architecture",
    rules: "convention",
    architecture: "architecture",
    decisions: "decision",
    facts: "gotcha",
    patterns: "gotcha",
  }
  return m[s] ?? "gotcha"
}

function mapSectionReverse(s: MemorySection): PMMemorySection {
  const m: Record<string, PMMemorySection> = {
    architecture: "architecture",
    convention: "rules",
    dependency: "architecture",
    configuration: "architecture",
    gotcha: "facts",
    decision: "decisions",
  }
  return m[s] ?? "facts"
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Integration: DreamJob × ProjectMemoryManager", () => {
  test("consolidation cycle reads/writes through real ProjectMemoryManager", async () => {
    const initial = [
      "# Project Memory",
      "",
      "## Verified Facts",
      "",
      "- [mem_1] database uses PostgreSQL 15",
      "  [conf:0.85]",
      "- [mem_2] database uses PSQL 15 with extensions",
      "  [conf:0.75]",
      "- [mem_3] API runs on port 3000",
      "  [conf:0.90]",
      "",
    ].join("\n")

    const pm = await createMemory("MEMORY-integration-dream.md", initial)
    const adapter = new ProjectMemoryAdapter(pm)

    const job = new DreamJob({
      intervalMs: 0,
      minEntriesToConsolidate: 2,
      mergeSimilarityThreshold: 0.5,
      targetMaxEntries: 100,
    })
    job.setProjectMemory(adapter)

    // Before consolidation
    const before = await adapter.getAllEntries()
    expect(before.length).toBe(3)

    // Run dream cycle
    const result = await job.dream()

    // mem_1 and mem_2 should merge (similar content about database)
    expect(result.duplicatesMerged).toBe(1)
    expect(result.entriesAfter).toBeLessThanOrEqual(2)

    // Re-read from disk to verify persistence
    const pm2 = new ProjectMemoryManager({ filePath: pm.config.filePath })
    const entries = await pm2.getAllEntries()
    expect(entries.length).toBeLessThanOrEqual(2)

    // The merged entry should have combined verification count
    const dbEntry = entries.find((e) => e.content.toLowerCase().includes("postgresql") || e.content.toLowerCase().includes("psql"))
    expect(dbEntry).toBeDefined()
  })

  test("removes short noise entries via real file persistence", async () => {
    const initial = [
      "# Project Memory",
      "",
      "## Verified Facts",
      "",
      "- [mem_1] ok",
      "  [conf:0.50]",
      "- [mem_2] a proper meaningful entry about the authentication system",
      "  [conf:0.80]",
      "",
    ].join("\n")

    const pm = await createMemory("MEMORY-integration-noise.md", initial)
    const adapter = new ProjectMemoryAdapter(pm)

    const job = new DreamJob({ targetMaxEntries: 100, mergeSimilarityThreshold: 0.7 })
    job.setProjectMemory(adapter)
    const result = await job.dream()

    expect(result.invalidRemoved).toBe(1)
    const entries = await adapter.getAllEntries()
    expect(entries.length).toBe(1)
    expect(entries[0]!.content).toContain("authentication")
  })
})

describe("Integration: DistillJob × EventArchiver", () => {
  test("heuristic pattern recognition uses real event archiver data", async () => {
    const events: EventRow[] = [
      { event_type: "tool_call_deploy", timestamp: 1000, session_id: "s1", payload: { tool: "deploy" } },
      { event_type: "tool_call_deploy", timestamp: 2000, session_id: "s1", payload: { tool: "deploy" } },
      { event_type: "tool_call_test", timestamp: 3000, session_id: "s1", payload: { tool: "test" } },
      { event_type: "tool_call_deploy", timestamp: 1000, session_id: "s2", payload: { tool: "deploy" } },
      { event_type: "tool_call_deploy", timestamp: 2000, session_id: "s2", payload: { tool: "deploy" } },
      { event_type: "tool_call_deploy", timestamp: 1000, session_id: "s3", payload: { tool: "deploy" } },
      { event_type: "tool_call_deploy", timestamp: 2000, session_id: "s3", payload: { tool: "deploy" } },
      { event_type: "tool_call_deploy", timestamp: 3000, session_id: "s3", payload: { tool: "deploy" } },
    ]

    const archiver = createArchiver(events)
    const outputDir = join(tempDir, "distill-output")

    const job = new DistillJob({
      outputDir,
      maxSessionsToAnalyze: 10,
      minSessions: 3,
    })
    job.setEventArchiver(archiver)

    const result = await job.distill(["s1", "s2", "s3"])

    expect(result.sessionsAnalyzed).toBe(3)
    // 3 sessions all dominated by "tool_call_deploy" → 1 pattern
    expect(result.patternsFound.length).toBe(1)
    if (result.patternsFound[0]) {
      expect(result.patternsFound[0].name).toContain("tool_call_deploy")
      expect(result.patternsFound[0].frequency).toBe(3)
    }
  })

  test("LLM crystallization reads events from archiver and generates artifacts", async () => {
    const events: EventRow[] = Array.from({ length: 12 }, (_, i) => ({
      event_type: i % 3 === 0 ? "tool_call_build" : i % 3 === 1 ? "tool_call_test" : "tool_call_ship",
      timestamp: 1000 * (i + 1),
      session_id: `session_${Math.floor(i / 3)}`,
      payload: {},
    }))

    const archiver = createArchiver(events)
    const outputDir = join(tempDir, "distill-output-llm")

    const patterns = JSON.stringify({
      patterns: [{
        name: "CI Pipeline",
        description: "Build-test-ship pipeline",
        frequency: 10,
        taskSequence: ["checkout", "build", "test", "package", "ship"],
        commonCapabilities: ["build", "test", "deploy"],
      }],
    })

    const job = new DistillJob({
      outputDir,
      useLLM: true,
      maxSessionsToAnalyze: 10,
    })
    job.setEventArchiver(archiver)
    job.setProvider(echoProvider())
    // Override echo to return our patterns
    ;(job as any).provider = {
      async chat() {
        return { content: patterns }
      },
    }

    const result = await job.distill(["session_0", "session_1", "session_2", "session_3"])

    expect(result.patternsFound.length).toBe(1)
    expect(result.patternsFound[0]!.name).toBe("CI Pipeline")
    expect(result.artifactsGenerated.length).toBeGreaterThan(0)

    // Verify artifacts were actually written to disk
    const skillPath = join(outputDir, "skills", "ci_pipeline.md")
    const skillContent = await readFile(skillPath, "utf-8")
    expect(skillContent).toContain("CI Pipeline")
  })
})

describe("Integration: Full DreamDistill Pipeline", () => {
  test("dream → memory persists → distill reads from archiver", async () => {
    // Phase 1: Create memory with ProjectMemoryManager and run dream
    const initial = [
      "# Project Memory",
      "",
      "## Verified Facts",
      "",
      "- [mem_1] use bun for testing",
      "  [conf:0.60]",
      "- [mem_2] use bun for all tests",
      "  [conf:0.70]",
      "- [mem_3] deploy via CI pipeline on main branch",
      "  [conf:0.85]",
      "",
    ].join("\n")

    const pm = await createMemory("MEMORY-pipeline.md", initial)
    const adapter = new ProjectMemoryAdapter(pm)

    const dreamJob = new DreamJob({
      intervalMs: 0,
      minEntriesToConsolidate: 2,
      mergeSimilarityThreshold: 0.5,
      targetMaxEntries: 100,
    })
    dreamJob.setProjectMemory(adapter)
    const dreamResult = await dreamJob.dream()

    // Two entries about bun should be merged
    expect(dreamResult.duplicatesMerged).toBe(1)
    expect(dreamResult.entriesAfter).toBeLessThanOrEqual(2)

    // Phase 2: Verify persistence by re-reading
    const pm2 = new ProjectMemoryManager({ filePath: pm.config.filePath })
    const entriesAfter = await pm2.getAllEntries()
    expect(entriesAfter.length).toBeLessThanOrEqual(2)

    // Phase 3: Run distill with empty archiver (just verifies no crash)
    const archiver = createArchiver([])
    const outputDir = join(tempDir, "pipeline-output")

    const distillJob = new DistillJob({ outputDir })
    distillJob.setEventArchiver(archiver)
    const distillResult = await distillJob.distill(["s1"])

    expect(distillResult.sessionsAnalyzed).toBe(1)
    expect(distillResult.patternsFound).toEqual([])
  })
})
