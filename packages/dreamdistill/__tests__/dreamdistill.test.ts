import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  DEFAULT_DISTILL_CONFIG,
  DEFAULT_DREAM_CONFIG,
  DistillJob,
  DreamJob,
  type EventRow,
  type IEventArchiver,
  type IProjectMemory,
  type ISkillRegistrar,
  type MemoryEntry,
  type MemorySection,
  type ProviderAdapter,
  createDistillJob,
  createDreamJob,
} from "../src/index"

// ── Fakes ──────────────────────────────────────────────────────────────────

class FakeMemory implements IProjectMemory {
  entries = new Map<string, MemoryEntry>()
  loadCalls = 0
  private nextId = 1

  seed(section: MemorySection, content: string, overrides?: Partial<MemoryEntry>): MemoryEntry {
    const entry: MemoryEntry = {
      id: `seed-${this.nextId++}`,
      section,
      content,
      verification_count: 1,
      confidence: 0.8,
      source_sessions: ["s1"],
      user_authored: false,
      created_at: Date.now(),
      updated_at: Date.now(),
      ...overrides,
    }
    this.entries.set(entry.id, entry)
    return entry
  }

  async load(): Promise<void> {
    this.loadCalls++
  }
  async getAllEntries(): Promise<MemoryEntry[]> {
    return [...this.entries.values()]
  }
  async deleteEntry(id: string): Promise<void> {
    this.entries.delete(id)
  }
  async upsertEntry(e: {
    section: MemorySection
    content: string
    verification_count: number
    confidence: number
    source_sessions: string[]
    user_authored: boolean
  }): Promise<MemoryEntry> {
    const entry: MemoryEntry = {
      ...e,
      id: `up-${this.nextId++}`,
      created_at: Date.now(),
      updated_at: Date.now(),
    }
    this.entries.set(entry.id, entry)
    return entry
  }
}

class FakeArchiver implements IEventArchiver {
  async queryEvents(): Promise<EventRow[]> {
    return []
  }
  async getSessionIds(): Promise<string[]> {
    return []
  }
}

class FakeRegistrar implements ISkillRegistrar {
  registered: Array<{ name: string; type: string }> = []
  existing = new Set<string>()
  async registerSkill(name: string, _content: string, type: string): Promise<void> {
    this.registered.push({ name, type })
  }
  hasSkill(name: string): boolean {
    return this.existing.has(name)
  }
}

function makeProvider(content: string): ProviderAdapter {
  return {
    async chat() {
      return { content }
    },
  }
}

// ── DreamJob ───────────────────────────────────────────────────────────────

describe("DreamJob — configuration and triggers", () => {
  test("defaults applied and overridable", () => {
    const job = new DreamJob()
    expect(job.config.intervalMs).toBe(DEFAULT_DREAM_CONFIG.intervalMs)
    expect(new DreamJob({ targetMaxEntries: 10 }).config.targetMaxEntries).toBe(10)
  })

  test("dream without project memory throws", async () => {
    await expect(new DreamJob().dream()).rejects.toThrow("not configured")
  })

  test("shouldDream gates on memory presence, entry count and interval", async () => {
    const noMemory = new DreamJob()
    expect(await noMemory.shouldDream()).toBe(false)

    const memory = new FakeMemory()
    memory.seed("gotcha", "entry one content")
    memory.seed("gotcha", "different second note")

    const job = new DreamJob({ minEntriesToConsolidate: 2, intervalMs: 0 })
    job.setProjectMemory(memory)
    expect(await job.shouldDream()).toBe(true)

    const strict = new DreamJob({ minEntriesToConsolidate: 3 })
    strict.setProjectMemory(memory)
    expect(await strict.shouldDream()).toBe(false) // below entry threshold
    expect(await strict.shouldDream()).toBe(false) // interval gate now active
  })
})

describe("DreamJob — consolidation phases", () => {
  test("merges similar entries in the same section, keeping the richer one", async () => {
    const memory = new FakeMemory()
    memory.seed("convention", "use bun test for all packages", { verification_count: 2, confidence: 0.6 })
    memory.seed("convention", "use bun test for all packages here", {
      verification_count: 3,
      confidence: 0.9,
      source_sessions: ["s2"],
    })
    memory.seed("configuration", "database runs on port 5432", { verification_count: 4 })

    const job = new DreamJob()
    job.setProjectMemory(memory)
    const result = await job.dream()

    expect(result.entriesBefore).toBe(3)
    expect(result.entriesAfter).toBe(2)
    expect(result.duplicatesMerged).toBe(1)
    expect(memory.loadCalls).toBe(1)

    const conventions = (await memory.getAllEntries()).filter((e) => e.section === "convention")
    expect(conventions.length).toBe(1)
    expect(conventions[0]!.content).toBe("use bun test for all packages here") // longer wins
    expect(conventions[0]!.verification_count).toBe(5) // 2 + 3
    expect(conventions[0]!.confidence).toBe(0.9) // max
    expect(conventions[0]!.source_sessions.sort()).toEqual(["s1", "s2"])
  })

  test("identical content in different sections is not merged", async () => {
    const memory = new FakeMemory()
    memory.seed("gotcha", "watch out for the flaky test")
    memory.seed("decision", "watch out for the flaky test")

    const job = new DreamJob()
    job.setProjectMemory(memory)
    const result = await job.dream()
    expect(result.duplicatesMerged).toBe(0)
    expect(result.entriesAfter).toBe(2)
  })

  test("removes short noise entries but keeps user-authored ones", async () => {
    const memory = new FakeMemory()
    memory.seed("gotcha", "ok")
    memory.seed("gotcha", "todo", { user_authored: true })
    memory.seed("gotcha", "a meaningful long note about builds")

    const job = new DreamJob()
    job.setProjectMemory(memory)
    const result = await job.dream()

    expect(result.invalidRemoved).toBe(1)
    const contents = (await memory.getAllEntries()).map((e) => e.content)
    expect(contents).not.toContain("ok")
    expect(contents).toContain("todo")
  })

  test("decays confidence of unverified non-user entries with a 0.3 floor", async () => {
    const memory = new FakeMemory()
    memory.seed("gotcha", "unverified machine note", { verification_count: 1, confidence: 0.8 })
    memory.seed("gotcha", "barely confident machine claim", { verification_count: 1, confidence: 0.35 })
    memory.seed("gotcha", "human curated statement", { verification_count: 1, confidence: 0.8, user_authored: true })
    memory.seed("gotcha", "well verified robust entry", { verification_count: 5, confidence: 0.8 })

    const job = new DreamJob()
    job.setProjectMemory(memory)
    await job.dream()

    const byContent = new Map((await memory.getAllEntries()).map((e) => [e.content, e]))
    expect(byContent.get("unverified machine note")!.confidence).toBeCloseTo(0.7)
    expect(byContent.get("barely confident machine claim")!.confidence).toBeCloseTo(0.3)
    expect(byContent.get("human curated statement")!.confidence).toBeCloseTo(0.8)
    expect(byContent.get("well verified robust entry")!.confidence).toBeCloseTo(0.8)
  })

  test("simple compression keeps user-authored and high-confidence entries", async () => {
    const memory = new FakeMemory()
    memory.seed("gotcha", "human low confidence entry", { confidence: 0.4, user_authored: true, verification_count: 3 })
    memory.seed("gotcha", "machine strongest fact here", { confidence: 0.9, verification_count: 3 })
    memory.seed("gotcha", "machine medium note kept before", { confidence: 0.8, verification_count: 3 })
    memory.seed("gotcha", "machine weakest expendable comment", { confidence: 0.5, verification_count: 3 })

    const job = new DreamJob({ targetMaxEntries: 2 })
    job.setProjectMemory(memory)
    const result = await job.dream()

    expect(result.entriesCompressed).toBe(2)
    const contents = (await memory.getAllEntries()).map((e) => e.content).sort()
    expect(contents).toEqual(["human low confidence entry", "machine strongest fact here"])
  })

  test("LLM compression consolidates large sections via provider JSON", async () => {
    const memory = new FakeMemory()
    for (let i = 0; i < 11; i++) {
      memory.seed("gotcha", `distinct observation ${i} regarding topic-${i}`, { verification_count: 2 })
    }

    const job = new DreamJob({ useLLM: true, targetMaxEntries: 5 })
    job.setProjectMemory(memory)
    job.setProvider(
      makeProvider(`Consolidated: [{"content": "all topics summarized", "confidence": 0.95, "verification_count": 9}]`),
    )

    const result = await job.dream()
    expect(result.entriesCompressed).toBe(10)
    const entries = await memory.getAllEntries()
    expect(entries.length).toBe(1)
    expect(entries[0]!.content).toBe("all topics summarized")
    expect(entries[0]!.confidence).toBe(0.95)
  })

  test("LLM compression with garbage output keeps entries unchanged", async () => {
    const memory = new FakeMemory()
    for (let i = 0; i < 11; i++) {
      memory.seed("gotcha", `distinct observation ${i} regarding topic-${i}`, { verification_count: 2 })
    }

    const job = new DreamJob({ useLLM: true, targetMaxEntries: 5 })
    job.setProjectMemory(memory)
    job.setProvider(makeProvider("cannot help with that"))

    const result = await job.dream()
    expect(result.entriesCompressed).toBe(0)
    expect(result.entriesAfter).toBe(11)
  })

  test("metrics accumulate across dream cycles", async () => {
    const memory = new FakeMemory()
    memory.seed("gotcha", "some stable long-lived entry", { verification_count: 3 })

    const job = new DreamJob()
    job.setProjectMemory(memory)
    expect(job.getMetrics().lastDreamAt).toBeNull()

    await job.dream()
    await job.dream()
    const metrics = job.getMetrics()
    expect(metrics.totalDreams).toBe(2)
    expect(metrics.lastDreamAt).not.toBeNull()
  })
})

// ── DistillJob ─────────────────────────────────────────────────────────────

const LLM_PATTERNS = JSON.stringify({
  patterns: [
    {
      name: "Deploy Flow",
      description: "deploy the service",
      frequency: 8,
      taskSequence: ["prep", "build", "test", "ship", "verify"],
      commonCapabilities: ["deploy"],
    },
    {
      name: "Quick Triage",
      description: "triage incoming bugs",
      frequency: 5,
      taskSequence: [],
      commonCapabilities: [],
    },
  ],
})

async function withTempDistill(
  fn: (job: DistillJob, outputDir: string) => Promise<void>,
  config?: Record<string, unknown>,
): Promise<void> {
  const outputDir = await mkdtemp(join(tmpdir(), "distill-test-"))
  const job = new DistillJob({ outputDir, ...config })
  job.setEventArchiver(new FakeArchiver())
  try {
    await fn(job, outputDir)
  } finally {
    await rm(outputDir, { recursive: true, force: true })
  }
}

describe("DistillJob — configuration and triggers", () => {
  test("defaults applied and overridable", () => {
    const job = new DistillJob()
    expect(job.config.minSessions).toBe(DEFAULT_DISTILL_CONFIG.minSessions)
    expect(new DistillJob({ minSessions: 3 }).config.minSessions).toBe(3)
  })

  test("distill without archiver throws", async () => {
    await expect(new DistillJob().distill(["s1"])).rejects.toThrow("not configured")
  })

  test("shouldDistill gates on session count and interval", async () => {
    const job = new DistillJob({ intervalMs: 0, minSessions: 10 })
    expect(await job.shouldDistill(9)).toBe(false)
    expect(await job.shouldDistill(10)).toBe(true)

    const gated = new DistillJob({ minSessions: 1 })
    expect(await gated.shouldDistill(100)).toBe(true)
    expect(await gated.shouldDistill(100)).toBe(false) // interval gate consumed
  })
})

describe("DistillJob — heuristic path", () => {
  test("placeholder heuristic finds no patterns and respects maxSessionsToAnalyze", async () => {
    await withTempDistill(
      async (job) => {
        const result = await job.distill(["s1", "s2", "s3", "s4", "s5"])
        expect(result.sessionsAnalyzed).toBe(2)
        expect(result.patternsFound).toEqual([])
        expect(result.artifactsGenerated).toEqual([])
      },
      { maxSessionsToAnalyze: 2 },
    )
  })
})

describe("DistillJob — LLM crystallization", () => {
  test("generates skill/command/agent/sop artifacts based on pattern shape", async () => {
    await withTempDistill(
      async (job) => {
        job.setProvider(makeProvider(LLM_PATTERNS))
        const result = await job.distill(["s1", "s2", "s3"])

        expect(result.patternsFound.length).toBe(2)
        const byType = new Map(result.artifactsGenerated.map((a) => [`${a.type}:${a.name}`, a]))
        // Deploy Flow: 5 steps, freq 8 → all four artifact types
        expect(byType.has("skill:deploy_flow")).toBe(true)
        expect(byType.has("command:deploy_flow")).toBe(true)
        expect(byType.has("agent:deploy_flow")).toBe(true)
        expect(byType.has("sop:deploy_flow")).toBe(true)
        // Quick Triage: empty sequence, freq 5 → only a command
        expect(byType.has("skill:quick_triage")).toBe(false)
        expect(byType.has("command:quick_triage")).toBe(true)
        expect(result.artifactsGenerated.length).toBe(5)
      },
      { useLLM: true },
    )
  })

  test("writes artifacts to categorized directories on disk", async () => {
    await withTempDistill(
      async (job, outputDir) => {
        job.setProvider(makeProvider(LLM_PATTERNS))
        await job.distill(["s1"])

        const skill = await readFile(join(outputDir, "skills", "deploy_flow.md"), "utf-8")
        expect(skill).toContain("# Deploy Flow")
        expect(skill).toContain("Observed in 8 sessions.")

        const cmd = await readFile(join(outputDir, "commands", "deploy_flow.ts"), "utf-8")
        expect(cmd).toContain("#!/usr/bin/env bun")

        const sop = await readFile(join(outputDir, "sop", "deploy_flow.md"), "utf-8")
        expect(sop).toContain("### Step 1: prep")
        expect(sop).toContain("**Next**: build")
      },
      { useLLM: true },
    )
  })

  test("registers new skills through the registrar, skipping existing ones", async () => {
    await withTempDistill(
      async (job) => {
        job.setProvider(makeProvider(LLM_PATTERNS))
        const registrar = new FakeRegistrar()
        job.setSkillRegistrar(registrar)
        await job.distill(["s1"])
        expect(registrar.registered).toEqual([{ name: "deploy_flow", type: "distilled" }])

        const skipping = new FakeRegistrar()
        skipping.existing.add("deploy_flow")
        job.setSkillRegistrar(skipping)
        await job.distill(["s1"])
        expect(skipping.registered).toEqual([])
      },
      { useLLM: true },
    )
  })

  test("malformed pattern fields get safe defaults", async () => {
    await withTempDistill(
      async (job) => {
        job.setProvider(
          makeProvider(
            JSON.stringify({
              patterns: [{ taskSequence: ["only step"], frequency: "not a number" }],
            }),
          ),
        )
        const result = await job.distill(["s1", "s2"])

        const pattern = result.patternsFound[0]!
        expect(pattern.name).toBe("pattern_0")
        expect(pattern.frequency).toBe(2) // falls back to session count
        expect(pattern.commonCapabilities).toEqual([])
        expect(pattern.matchedSessions).toEqual(["s1", "s2"])
      },
      { useLLM: true },
    )
  })

  test("garbage LLM output falls back to heuristic (no patterns)", async () => {
    await withTempDistill(
      async (job) => {
        job.setProvider(makeProvider("not json at all"))
        const result = await job.distill(["s1"])
        expect(result.patternsFound).toEqual([])
      },
      { useLLM: true },
    )
  })

  test("metrics accumulate across distill cycles", async () => {
    await withTempDistill(
      async (job) => {
        job.setProvider(makeProvider(LLM_PATTERNS))
        expect(job.getMetrics().lastDistillAt).toBeNull()

        await job.distill(["s1"])
        await job.distill(["s1"])
        const metrics = job.getMetrics()
        expect(metrics.totalDistills).toBe(2)
        expect(metrics.totalPatternsFound).toBe(4)
        expect(metrics.totalArtifactsGenerated).toBe(10)
      },
      { useLLM: true },
    )
  })
})

// ─── DistillJob: setProjectMemory ────────────────────────────────────────────

describe("DistillJob setProjectMemory", () => {
  test("wires project memory dependency", () => {
    const job = new DistillJob()
    const memory = new FakeMemory()
    job.setProjectMemory(memory)
    // No error thrown = success
  })
})

// ─── DistillJob: startTimer / stopTimer ─────────────────────────────────────

describe("DistillJob timer", () => {
  test("startTimer and stopTimer do not throw", () => {
    const job = new DistillJob()
    let counter = 0
    job.startTimer(() => ++counter)
    expect(() => job.startTimer(() => 0)).not.toThrow() // second call is no-op
    job.stopTimer()
    expect(() => job.stopTimer()).not.toThrow() // second stop is safe
  })

  test("timer callback executes and handles errors gracefully", async () => {
    const job = new DistillJob()
    // mock setInterval to invoke the callback immediately
    const origSetInterval = globalThis.setInterval
    globalThis.setInterval = ((fn: () => void) => {
      fn()
      return 1 as unknown as ReturnType<typeof setInterval>
    }) as typeof setInterval
    try {
      // startTimer sets up the interval; the mock fires the callback synchronously
      // shouldDistill will throw because no archiver is set, but catch covers it
      job.startTimer(() => 0)
      // give the async callback time to settle
      await new Promise((r) => setTimeout(r, 10))
    } finally {
      globalThis.setInterval = origSetInterval
    }
    job.stopTimer()
  })
})

// ─── createDistillJob ────────────────────────────────────────────────────────

describe("createDistillJob", () => {
  test("factory creates DistillJob", () => {
    const job = createDistillJob()
    expect(job).toBeDefined()
    expect(job instanceof DistillJob).toBe(true)
  })
})

// ─── DreamJob: setEventArchiver ──────────────────────────────────────────────

describe("DreamJob setEventArchiver", () => {
  test("wires event archiver dependency", () => {
    const job = new DreamJob()
    const archiver: IEventArchiver = {
      queryEvents: () => Promise.resolve([]),
      getSessionIds: () => Promise.resolve([]),
    }
    job.setEventArchiver(archiver)
    // No error thrown = success
  })
})

// ─── DreamJob: startTimer / stopTimer ────────────────────────────────────────

describe("DreamJob timer", () => {
  test("startTimer and stopTimer do not throw", () => {
    const job = new DreamJob()
    job.startTimer()
    expect(() => job.startTimer()).not.toThrow() // second call is no-op
    job.stopTimer()
    expect(() => job.stopTimer()).not.toThrow() // second stop is safe
  })

  test("timer callback executes and handles errors gracefully", async () => {
    const job = new DreamJob()
    // mock setInterval to invoke the callback immediately
    const origSetInterval = globalThis.setInterval
    globalThis.setInterval = ((fn: () => void) => {
      fn()
      return 1 as unknown as ReturnType<typeof setInterval>
    }) as typeof setInterval
    try {
      // startTimer sets up the interval; the mock fires the callback synchronously
      // shouldDream will throw because no project memory is set, but catch covers it
      job.startTimer()
      // give the async callback time to settle
      await new Promise((r) => setTimeout(r, 10))
    } finally {
      globalThis.setInterval = origSetInterval
    }
    job.stopTimer()
  })
})

// ─── createDreamJob ──────────────────────────────────────────────────────────

describe("createDreamJob", () => {
  test("factory creates DreamJob", () => {
    const job = createDreamJob()
    expect(job).toBeDefined()
    expect(job instanceof DreamJob).toBe(true)
  })
})
