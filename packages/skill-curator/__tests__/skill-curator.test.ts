import { describe, expect, test } from "bun:test"
import { type ISkillManager, type ProviderAdapter, SkillCurator, type SkillListItem, createSkillCurator } from "../src/index"

const DAY = 24 * 60 * 60 * 1000

function makeSkill(name: string, overrides?: Partial<SkillListItem>): SkillListItem {
  return {
    name,
    description: `desc of ${name}`,
    version: "1.0.0",
    createdBy: "agent",
    usageCount: 0,
    lastUsed: Date.now(),
    pinned: false,
    tags: [],
    filePath: `/skills/${name}.md`,
    ...overrides,
  }
}

/** In-memory fake skill manager */
class FakeSkillManager implements ISkillManager {
  skills: SkillListItem[] = []
  contents = new Map<string, string>()
  deleted: string[] = []
  pinnedNames: string[] = []

  async listSkills(): Promise<SkillListItem[]> {
    return [...this.skills]
  }
  async loadSkill(name: string): Promise<string> {
    return this.contents.get(name) ?? ""
  }
  async deleteSkill(name: string): Promise<boolean> {
    this.deleted.push(name)
    this.skills = this.skills.filter((s) => s.name !== name)
    return true
  }
  pinSkill(name: string): boolean {
    this.pinnedNames.push(name)
    const s = this.skills.find((x) => x.name === name)
    if (s) s.pinned = true
    return true
  }
  unpinSkill(name: string): boolean {
    const s = this.skills.find((x) => x.name === name)
    if (s) s.pinned = false
    return true
  }
  get skillSystem() {
    const skills = this.skills
    return {
      getAgentSkill(name: string) {
        const s = skills.find((x) => x.name === name)
        return s ? { last_used_at: s.lastUsed, pinned: s.pinned } : undefined
      },
    }
  }
}

describe("archiveStale", () => {
  test("archives agent skills unused past the threshold", async () => {
    const mgr = new FakeSkillManager()
    mgr.skills = [
      makeSkill("stale", { lastUsed: Date.now() - 40 * DAY }),
      makeSkill("fresh", { lastUsed: Date.now() - 1 * DAY }),
    ]
    const curator = new SkillCurator(mgr)
    const archived = await curator.archiveStale(30)
    expect(archived).toBe(1)
    expect(mgr.deleted).toEqual(["stale"])
  })

  test("never touches user-created skills", async () => {
    const mgr = new FakeSkillManager()
    mgr.skills = [makeSkill("user-skill", { createdBy: "user", lastUsed: 0 })]
    const curator = new SkillCurator(mgr)
    expect(await curator.archiveStale(30)).toBe(0)
    expect(mgr.deleted).toEqual([])
  })

  test("pinned skills are exempt from archiving", async () => {
    const mgr = new FakeSkillManager()
    mgr.skills = [makeSkill("pinned-stale", { pinned: true, lastUsed: Date.now() - 100 * DAY })]
    const curator = new SkillCurator(mgr)
    expect(await curator.archiveStale(30)).toBe(0)
  })

  test("never-used skills (lastUsed=0) are archived", async () => {
    const mgr = new FakeSkillManager()
    mgr.skills = [makeSkill("never-used", { lastUsed: 0 })]
    const curator = new SkillCurator(mgr)
    expect(await curator.archiveStale(30)).toBe(1)
  })
})

describe("pinFrequent", () => {
  test("skips pinning when below minSkillsForPin", async () => {
    const mgr = new FakeSkillManager()
    mgr.skills = [makeSkill("a", { usageCount: 100 }), makeSkill("b", { usageCount: 50 })]
    const curator = new SkillCurator(mgr) // default minSkillsForPin = 10
    expect(await curator.pinFrequent(0.1)).toBe(0)
  })

  test("pins the top percent by usage count", async () => {
    const mgr = new FakeSkillManager()
    mgr.skills = Array.from({ length: 10 }, (_, i) => makeSkill(`s${i}`, { usageCount: i }))
    const curator = new SkillCurator(mgr, { minSkillsForPin: 10 })
    const pinned = await curator.pinFrequent(0.1) // ceil(10 * 0.1) = 1
    expect(pinned).toBe(1)
    expect(mgr.pinnedNames).toEqual(["s9"]) // highest usage
  })

  test("does not pin skills with zero usage", async () => {
    const mgr = new FakeSkillManager()
    mgr.skills = Array.from({ length: 10 }, (_, i) => makeSkill(`s${i}`, { usageCount: 0 }))
    const curator = new SkillCurator(mgr, { minSkillsForPin: 10 })
    expect(await curator.pinFrequent(0.5)).toBe(0)
  })

  test("already pinned skills are excluded from candidates", async () => {
    const mgr = new FakeSkillManager()
    mgr.skills = Array.from({ length: 12 }, (_, i) => makeSkill(`s${i}`, { usageCount: i, pinned: i === 11 }))
    const curator = new SkillCurator(mgr, { minSkillsForPin: 10 })
    await curator.pinFrequent(0.1)
    // s11 already pinned and excluded; ceil(11 * 0.1) = 2 top candidates get pinned
    expect(mgr.pinnedNames).toEqual(["s10", "s9"])
  })
})

describe("reviewQuality", () => {
  test("empty skill returns zero score", async () => {
    const mgr = new FakeSkillManager()
    const curator = new SkillCurator(mgr)
    const review = await curator.reviewQuality("missing")
    expect(review.score).toBe(0)
    expect(review.issues).toContain("Skill not found or empty")
  })

  test("heuristic review rewards structure, steps and code blocks", async () => {
    const mgr = new FakeSkillManager()
    const richContent = [
      "# Skill",
      "## Usage",
      "1. First step",
      "2. Second step",
      "```ts",
      "console.log('hi')",
      "```",
      "## Notes",
      ...Array.from({ length: 10 }, (_, i) => `Detail line ${i} with enough padding text here.`),
    ].join("\n")
    mgr.contents.set("rich", richContent)
    mgr.contents.set("poor", "just one line")

    const curator = new SkillCurator(mgr)
    const rich = await curator.reviewQuality("rich")
    const poor = await curator.reviewQuality("poor")

    expect(rich.score).toBeGreaterThan(poor.score)
    expect(rich.issues).toEqual([])
    expect(poor.issues).toContain("No code examples")
    expect(poor.suggestions.length).toBeGreaterThan(0)
  })

  test("uses LLM provider verdict when JSON is valid", async () => {
    const mgr = new FakeSkillManager()
    mgr.contents.set("skill", "# Skill\nsome content")
    const provider: ProviderAdapter = {
      async chat() {
        return { content: '{"overall_score": 88, "issues": ["minor"], "suggestions": ["improve"]}' }
      },
    }
    const curator = new SkillCurator(mgr)
    curator.setProvider(provider)
    const review = await curator.reviewQuality("skill")
    expect(review.score).toBe(88)
    expect(review.issues).toEqual(["minor"])
    expect(review.suggestions).toEqual(["improve"])
  })

  test("falls back to heuristic when provider returns garbage", async () => {
    const mgr = new FakeSkillManager()
    mgr.contents.set("skill", "# Skill\nsome content")
    const provider: ProviderAdapter = {
      async chat() {
        return { content: "not json at all" }
      },
    }
    const curator = new SkillCurator(mgr)
    curator.setProvider(provider)
    const review = await curator.reviewQuality("skill")
    expect(review.score).toBeGreaterThan(0) // heuristic path
  })

  test("falls back to heuristic when provider throws", async () => {
    const mgr = new FakeSkillManager()
    mgr.contents.set("skill", "# Skill\nsome content")
    const provider: ProviderAdapter = {
      async chat() {
        throw new Error("provider down")
      },
    }
    const curator = new SkillCurator(mgr)
    curator.setProvider(provider)
    const review = await curator.reviewQuality("skill")
    expect(review.score).toBeGreaterThan(0)
  })
})

describe("shouldArchive", () => {
  test("true for stale unpinned agent skill", () => {
    const mgr = new FakeSkillManager()
    mgr.skills = [makeSkill("old", { lastUsed: Date.now() - 60 * DAY })]
    const curator = new SkillCurator(mgr)
    expect(curator.shouldArchive("old")).toBe(true)
  })

  test("false for pinned or unknown skills", () => {
    const mgr = new FakeSkillManager()
    mgr.skills = [makeSkill("pinned", { pinned: true, lastUsed: 0 })]
    const curator = new SkillCurator(mgr)
    expect(curator.shouldArchive("pinned")).toBe(false)
    expect(curator.shouldArchive("ghost")).toBe(false)
  })

  test("respects custom day threshold", () => {
    const mgr = new FakeSkillManager()
    mgr.skills = [makeSkill("recent", { lastUsed: Date.now() - 5 * DAY })]
    const curator = new SkillCurator(mgr)
    expect(curator.shouldArchive("recent", 3)).toBe(true)
    expect(curator.shouldArchive("recent", 10)).toBe(false)
  })
})

describe("run — full curation cycle", () => {
  test("combines archive, pin and review with warnings for low scores", async () => {
    const mgr = new FakeSkillManager()
    mgr.skills = [
      ...Array.from({ length: 10 }, (_, i) => makeSkill(`s${i}`, { usageCount: i + 1 })),
      makeSkill("stale", { lastUsed: Date.now() - 60 * DAY }),
    ]
    for (const s of mgr.skills) mgr.contents.set(s.name, "short")

    const provider: ProviderAdapter = {
      async chat() {
        return { content: '{"overall_score": 20, "issues": [], "suggestions": []}' }
      },
    }
    const curator = new SkillCurator(mgr, { minSkillsForPin: 5 })
    curator.setProvider(provider)
    const result = await curator.run()

    expect(result.archived).toBe(1)
    expect(result.pinned).toBeGreaterThanOrEqual(1)
    expect(result.reviewed.length).toBeGreaterThan(0)
    expect(result.reviewed.length).toBeLessThanOrEqual(5) // caps at 5 reviews
    expect(result.warnings.length).toBe(result.reviewed.length) // all scored 20 < 50
  })

  test("without provider no reviews are performed", async () => {
    const mgr = new FakeSkillManager()
    mgr.skills = [makeSkill("a")]
    const curator = new SkillCurator(mgr)
    const result = await curator.run()
    expect(result.reviewed).toEqual([])
    expect(result.warnings).toEqual([])
  })
})

describe("createSkillCurator factory", () => {
  test("returns a SkillCurator instance", () => {
    const mgr = new FakeSkillManager()
    const curator = createSkillCurator(mgr)
    expect(curator).toBeInstanceOf(SkillCurator)
    expect(curator.shouldArchive("ghost")).toBe(false)
  })

  test("forwards custom config", () => {
    const mgr = new FakeSkillManager()
    mgr.skills = [makeSkill("old", { lastUsed: Date.now() - 5 * 24 * 60 * 60 * 1000 })]
    const curator = createSkillCurator(mgr, { minSkillsForPin: 3 })
    expect(curator.shouldArchive("old", 3)).toBe(true)
  })
})
