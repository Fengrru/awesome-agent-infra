import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type AgentSkill,
  DAG_GENERATION_PROMPT,
  HookPoints,
  type Skill,
  SkillManager,
  SkillSystem,
  createSkillManager,
  createSkillSystem,
} from "../src/index"

function makeSkill(id: string, trigger: string, priority = 5): Skill {
  return {
    skill_id: id,
    trigger_condition: trigger,
    prompt_template: `template for ${id}`,
    priority,
    scope: "global",
    hit_count: 0,
    created_at: Date.now(),
  }
}

function makeAgentSkill(name: string, overrides?: Partial<AgentSkill>): AgentSkill {
  return {
    name,
    description: `does ${name}`,
    version: "1.0.0",
    created_by: "agent",
    tags: [],
    file_path: `/skills/${name}.md`,
    usage_count: 0,
    last_used_at: 0,
    pinned: false,
    created_at: Date.now(),
    ...overrides,
  }
}

async function withTempManager(
  fn: (
    manager: SkillManager,
    system: SkillSystem,
    dirs: { projectSkillDir: string; userSkillDir: string },
  ) => Promise<void>,
): Promise<void> {
  const base = await mkdtemp(join(tmpdir(), "skillforge-test-"))
  const projectSkillDir = join(base, "project-skills")
  const userSkillDir = join(base, "user-skills")
  const system = new SkillSystem()
  const manager = new SkillManager({ projectSkillDir, userSkillDir }, system)
  try {
    await fn(manager, system, { projectSkillDir, userSkillDir })
  } finally {
    await rm(base, { recursive: true, force: true })
  }
}

describe("SkillSystem — legacy skills", () => {
  test("matchSkills is case-insensitive and sorted by priority", () => {
    const sys = new SkillSystem()
    sys.registerSkill(makeSkill("low", "deploy", 1))
    sys.registerSkill(makeSkill("high", "DEPLOY", 9))
    sys.registerSkill(makeSkill("other", "database", 5))

    const matched = sys.matchSkills("please Deploy the app")
    expect(matched.map((s) => s.skill_id)).toEqual(["high", "low"])
  })

  test("unregisterSkill removes it from matching", () => {
    const sys = new SkillSystem()
    sys.registerSkill(makeSkill("a", "fix"))
    sys.unregisterSkill("a")
    expect(sys.matchSkills("fix the bug")).toEqual([])
  })

  test("buildPromptInjection concatenates matched templates, empty when none", () => {
    const sys = new SkillSystem()
    sys.registerSkill(makeSkill("s1", "test"))
    expect(sys.buildPromptInjection("run the test suite")).toBe("[Skill: s1] template for s1")
    expect(sys.buildPromptInjection("unrelated")).toBe("")
  })

  test("recordHit increments hit_count and ignores unknown ids", () => {
    const sys = new SkillSystem()
    sys.registerSkill(makeSkill("s1", "x"))
    sys.recordHit("s1")
    sys.recordHit("s1")
    sys.recordHit("ghost")
    expect(sys.getAllSkills()[0]!.hit_count).toBe(2)
  })
})

describe("SkillSystem — hooks", () => {
  test("triggerHook runs handlers in order and isolates failures", async () => {
    const sys = new SkillSystem()
    const seen: string[] = []
    sys.onHook(HookPoints.SESSION_INIT, async () => {
      seen.push("first")
    })
    sys.onHook(HookPoints.SESSION_INIT, async () => {
      throw new Error("boom")
    })
    sys.onHook(HookPoints.SESSION_INIT, async (ctx) => {
      seen.push(`third:${ctx.id}`)
    })

    await sys.triggerHook(HookPoints.SESSION_INIT, { id: 7 })
    expect(seen).toEqual(["first", "third:7"])
  })

  test("triggering a hook with no handlers is a no-op", async () => {
    const sys = new SkillSystem()
    await sys.triggerHook(HookPoints.SESSION_END, {})
  })
})

describe("SkillSystem — agent skills", () => {
  test("registerAgentSkill replaces existing skill with same name", () => {
    const sys = new SkillSystem()
    sys.registerAgentSkill(makeAgentSkill("dedupe", { version: "1.0.0" }))
    sys.registerAgentSkill(makeAgentSkill("dedupe", { version: "2.0.0" }))
    expect(sys.getAllAgentSkills().length).toBe(1)
    expect(sys.getAgentSkill("dedupe")!.version).toBe("2.0.0")
  })

  test("buildL0Injection separates pinned skills and sorts by usage", () => {
    const sys = new SkillSystem()
    sys.registerAgentSkill(makeAgentSkill("rare", { usage_count: 1 }))
    sys.registerAgentSkill(makeAgentSkill("popular", { usage_count: 10, tags: ["hot"] }))
    sys.registerAgentSkill(makeAgentSkill("anchor", { pinned: true }))

    const l0 = sys.buildL0Injection()
    expect(l0).toContain("## 📌 Pinned Skills")
    expect(l0).toContain("**anchor**")
    expect(l0).toContain("## 🔧 Available Skills")
    expect(l0.indexOf("**popular**")).toBeLessThan(l0.indexOf("**rare**"))
    expect(l0).toContain("[hot]")
    expect(new SkillSystem().buildL0Injection()).toBe("")
  })

  test("searchAgentSkills matches name, description and tags", () => {
    const sys = new SkillSystem()
    sys.registerAgentSkill(makeAgentSkill("git-flow", { description: "branching model" }))
    sys.registerAgentSkill(makeAgentSkill("deploy", { tags: ["release", "GIT"] }))

    expect(
      sys
        .searchAgentSkills("git")
        .map((s) => s.name)
        .sort(),
    ).toEqual(["deploy", "git-flow"])
    expect(sys.searchAgentSkills("branching").map((s) => s.name)).toEqual(["git-flow"])
    expect(sys.searchAgentSkills("nothing")).toEqual([])
  })

  test("recordAgentSkillUsage bumps count and timestamp", () => {
    const sys = new SkillSystem()
    sys.registerAgentSkill(makeAgentSkill("used"))
    sys.recordAgentSkillUsage("used")
    const skill = sys.getAgentSkill("used")!
    expect(skill.usage_count).toBe(1)
    expect(skill.last_used_at).toBeGreaterThan(0)
  })

  test("loadFullSkill uses readFn when provided and falls back to summary", async () => {
    const sys = new SkillSystem()
    sys.registerAgentSkill(makeAgentSkill("doc"))
    expect(await sys.loadFullSkill("doc", async () => "file body")).toBe("file body")
    expect(await sys.loadFullSkill("doc")).toContain("[Skill: doc]")
    expect(
      await sys.loadFullSkill("doc", async () => {
        throw new Error("io")
      }),
    ).toBe("")
    expect(await sys.loadFullSkill("missing")).toBe("")
  })
})

describe("SkillManager — init and create", () => {
  test("init creates skill dirs plus .archive", async () => {
    await withTempManager(async (manager, _sys, dirs) => {
      await manager.init()
      expect(await readdir(dirs.projectSkillDir)).toContain(".archive")
      expect(await readdir(dirs.userSkillDir)).toEqual([])
    })
  })

  test("createSkill writes SKILL.md with frontmatter and registers it", async () => {
    await withTempManager(async (manager, sys, dirs) => {
      const { skill, filePath } = await manager.createSkill({
        name: "Fix CI",
        description: "repairs the pipeline",
        content: "# Steps\n1. check logs",
        tags: ["ci", "ops"],
      })

      expect(filePath).toBe(join(dirs.projectSkillDir, "fix-ci.md"))
      expect(skill.created_by).toBe("agent")

      const raw = await readFile(filePath, "utf-8")
      expect(raw).toContain("name: Fix CI")
      expect(raw).toContain("tags: [ci, ops]")
      expect(raw).toContain("# Steps")
      expect(sys.getAgentSkill("Fix CI")).toBeDefined()
    })
  })

  test("createSkill with triggerCondition also registers a legacy skill", async () => {
    await withTempManager(async (manager, sys) => {
      await manager.createSkill({
        name: "hotfix",
        description: "apply hotfix flow",
        content: "body",
        triggerCondition: "hotfix",
      })
      const matched = sys.matchSkills("need a hotfix now")
      expect(matched.length).toBe(1)
      expect(matched[0]!.skill_id).toBe("agent_hotfix")
    })
  })
})

describe("SkillManager — progressive loading", () => {
  test("loadSkill returns body without frontmatter", async () => {
    await withTempManager(async (manager) => {
      await manager.createSkill({ name: "guide", description: "d", content: "the body" })
      expect(await manager.loadSkill("guide")).toBe("the body")
      expect(await manager.loadSkill("nope")).toBe("")
    })
  })

  test("scan discovers skills written to disk by other instances", async () => {
    await withTempManager(async (manager, _sys, dirs) => {
      await mkdir(dirs.userSkillDir, { recursive: true })
      await writeFile(
        join(dirs.userSkillDir, "external.md"),
        "---\nname: external\ndescription: from disk\nversion: 2.1.0\ncreated_by: user\ntags: [imported]\n---\nexternal body",
        "utf-8",
      )

      const items = await manager.listSkills()
      expect(items.length).toBe(1)
      expect(items[0]!.name).toBe("external")
      expect(items[0]!.version).toBe("2.1.0")
      expect(items[0]!.createdBy).toBe("user")
      expect(items[0]!.tags).toEqual(["imported"])
      expect(await manager.loadSkill("external")).toBe("external body")
    })
  })

  test("files without frontmatter are ignored by scan", async () => {
    await withTempManager(async (manager, _sys, dirs) => {
      await mkdir(dirs.projectSkillDir, { recursive: true })
      await writeFile(join(dirs.projectSkillDir, "plain.md"), "no frontmatter here", "utf-8")
      expect(await manager.listSkills()).toEqual([])
    })
  })

  test("buildL0Index groups skills by user/project directory", async () => {
    await withTempManager(async (manager, _sys, dirs) => {
      await manager.createSkill({ name: "proj-skill", description: "project one", content: "b" })
      await mkdir(dirs.userSkillDir, { recursive: true })
      await writeFile(
        join(dirs.userSkillDir, "user-skill.md"),
        "---\nname: user-skill\ndescription: user one\n---\nbody",
        "utf-8",
      )

      const l0 = await manager.buildL0Index()
      expect(l0).toContain("## User Skills")
      expect(l0).toContain("**user-skill**: user one")
      expect(l0).toContain("## Project Skills")
      expect(l0).toContain("**proj-skill**: project one")
    })
  })

  test("loadAttachedFile reads files relative to the skill", async () => {
    await withTempManager(async (manager, _sys, dirs) => {
      await manager.createSkill({ name: "docs", description: "d", content: "b" })
      await mkdir(join(dirs.projectSkillDir, "references"), { recursive: true })
      await writeFile(join(dirs.projectSkillDir, "references", "extra.txt"), "attachment", "utf-8")

      expect(await manager.loadAttachedFile("docs", join("references", "extra.txt"))).toBe("attachment")
      expect(await manager.loadAttachedFile("docs", "missing.txt")).toBe("")
      expect(await manager.loadAttachedFile("ghost", "x")).toBe("")
    })
  })
})

describe("SkillManager — patch", () => {
  test("patchSkill replaces content on disk and invalidates cache", async () => {
    await withTempManager(async (manager) => {
      await manager.createSkill({ name: "p", description: "d", content: "old line" })
      const result = await manager.patchSkill("p", "old line", "new line")
      expect(result.matchCount).toBe(1)
      expect(result.strategy).toBe("exact")
      expect(await manager.loadSkill("p")).toBe("new line")
    })
  })

  test("patchSkill replaceAll counts every occurrence", async () => {
    await withTempManager(async (manager) => {
      await manager.createSkill({ name: "p", description: "d", content: "x x x" })
      const result = await manager.patchSkill("p", "x", "y", true)
      expect(result.matchCount).toBe(3)
      expect(result.strategy).toBe("exact_replace_all")
    })
  })

  test("no-match and unknown-skill produce errors without writing", async () => {
    await withTempManager(async (manager) => {
      await manager.createSkill({ name: "p", description: "d", content: "stable" })
      const noMatch = await manager.patchSkill("p", "absent", "y")
      expect(noMatch.matchCount).toBe(0)
      expect(noMatch.error).toBe("No match found")
      expect(await manager.loadSkill("p")).toBe("stable")

      const unknown = await manager.patchSkill("ghost", "a", "b")
      expect(unknown.error).toContain('"ghost" not found')
    })
  })

  test("setFuzzyPatcher swaps the patching strategy", async () => {
    await withTempManager(async (manager) => {
      await manager.createSkill({ name: "p", description: "d", content: "anything" })
      manager.setFuzzyPatcher(() => ({
        newContent: "patched-by-custom",
        matchCount: 1,
        strategy: "custom",
      }))
      const result = await manager.patchSkill("p", "no matter", "what")
      expect(result.strategy).toBe("custom")
      expect(await manager.loadSkill("p")).toBe("patched-by-custom")
    })
  })
})

describe("SkillManager — delete, pin, usage", () => {
  test("deleteSkill archives the file and unregisters the skill", async () => {
    await withTempManager(async (manager, sys, dirs) => {
      const { filePath } = await manager.createSkill({ name: "gone", description: "d", content: "b" })
      expect(await manager.deleteSkill("gone")).toBe(true)

      expect(sys.getAgentSkill("gone")).toBeUndefined()
      const archived = await readFile(join(dirs.projectSkillDir, ".archive", "gone.md"), "utf-8")
      expect(archived).toContain("name: gone")
      const remaining = await readdir(dirs.projectSkillDir)
      expect(remaining).not.toContain("gone.md")
      expect(filePath).toContain("gone.md")
    })
  })

  test("deleteSkill on unknown name returns false", async () => {
    await withTempManager(async (manager) => {
      expect(await manager.deleteSkill("ghost")).toBe(false)
    })
  })

  test("pin/unpin toggle the flag and searchSkills reflects registry", async () => {
    await withTempManager(async (manager) => {
      await manager.createSkill({ name: "star", description: "shiny helper", content: "b" })
      expect(manager.pinSkill("star")).toBe(true)
      expect((await manager.listSkills())[0]!.pinned).toBe(true)
      expect(manager.unpinSkill("star")).toBe(true)
      expect(manager.pinSkill("ghost")).toBe(false)

      const found = await manager.searchSkills("shiny")
      expect(found.map((s) => s.name)).toEqual(["star"])
    })
  })

  test("recordUsage flows through to the skill system", async () => {
    await withTempManager(async (manager) => {
      await manager.createSkill({ name: "u", description: "d", content: "b" })
      manager.recordUsage("u")
      manager.recordUsage("u")
      expect((await manager.listSkills())[0]!.usageCount).toBe(2)
    })
  })

  test("getSkillFiles returns raw file contents for curator use", async () => {
    await withTempManager(async (manager) => {
      await manager.createSkill({ name: "a", description: "d", content: "body-a" })
      await manager.createSkill({ name: "b", description: "d", content: "body-b" })
      const files = await manager.getSkillFiles()
      expect(files.length).toBe(2)
      expect(files[0]!.content).toContain("---") // raw includes frontmatter
    })
  })
})

describe("exports", () => {
  test("DAG_GENERATION_PROMPT exposes goal/capability placeholders", () => {
    expect(DAG_GENERATION_PROMPT).toContain("{{goal}}")
    expect(DAG_GENERATION_PROMPT).toContain("{{capabilities}}")
  })

  test("createSkillSystem returns a SkillSystem instance", () => {
    const sys = createSkillSystem()
    expect(sys).toBeInstanceOf(SkillSystem)
  })

  test("createSkillManager returns a SkillManager instance", () => {
    const sys = new SkillSystem()
    const mgr = createSkillManager({ projectSkillDir: "/tmp/proj", userSkillDir: "/tmp/user" }, sys)
    expect(mgr).toBeInstanceOf(SkillManager)
    expect(mgr.skillSystem).toBe(sys)
  })
})
