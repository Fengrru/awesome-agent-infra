/**
 * SkillForge — Agent-Writeable Skill Creation & Management System
 *
 * Enables AI agents to autonomously create, patch, edit, and delete skill files
 * at runtime. Uses SKILL.md format with YAML frontmatter (compatible with
 * agentskills.io open standard). Progressive loading (L0/L1/L2) keeps token
 * budgets under control.
 *
 * ## Architecture
 * - SkillSystem: In-memory skill registry + hook-based lifecycle
 * - SkillManager: Filesystem-backed CRUD with L0/L1/L2 progressive loading
 * - FuzzyPatch: Pluggable fuzzy find-and-replace for skill editing
 *
 * @module skillforge
 */

import { readFile, writeFile, mkdir, unlink, readdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Skill {
  skill_id: string
  trigger_condition: string
  prompt_template: string
  priority: number
  scope: "global" | "session" | "task"
  hit_count: number
  created_at: number
}

/** Hermes-inspired AgentSkill — file-backed skill created by the agent at runtime */
export interface AgentSkill {
  name: string
  description: string
  version: string
  created_by: "user" | "agent"
  tags: string[]
  file_path: string
  usage_count: number
  last_used_at: number
  pinned: boolean
  created_at: number
  category?: string
}

export const HookPoints = {
  SESSION_INIT: "session:init",
  PROMPT_BEFORE_BUILD: "prompt:before-build",
  TOOL_AFTER_CALL: "tool:after-call",
  SESSION_END: "session:end",
} as const

export type HookPoint = (typeof HookPoints)[keyof typeof HookPoints]

export interface CreateSkillParams {
  name: string
  description: string
  content: string
  category?: string
  tags?: string[]
  triggerCondition?: string
}

export interface CreateSkillResult {
  skill: AgentSkill
  filePath: string
}

export interface PatchSkillResult {
  /** Content after patching */
  newContent: string
  /** Number of matches replaced */
  matchCount: number
  /** Which fuzzy strategy was used */
  strategy: string
  /** Error if patch failed */
  error?: string
}

export interface SkillListItem {
  name: string
  description: string
  version: string
  createdBy: "user" | "agent"
  usageCount: number
  lastUsed: number
  pinned: boolean
  tags: string[]
  filePath: string
}

export interface SkillManagerConfig {
  /** Directory for project-level skills */
  projectSkillDir: string
  /** Directory for user-level skills */
  userSkillDir: string
}

/**
 * Pluggable fuzzy find-and-replace function.
 * Replace with @fengru/fuzzy-patch for advanced matching (8 strategies).
 */
export type FuzzyPatchFn = (
  content: string,
  oldStr: string,
  newStr: string,
  replaceAll?: boolean,
) => { newContent: string; matchCount: number; strategy: string; error?: string }

// ─── SKILL.md Format Helpers ────────────────────────────────────────────────

/** Parse YAML frontmatter from a SKILL.md file. Minimal parser — no YAML lib needed. */
function parseFrontmatter(md: string): { frontmatter: Record<string, unknown>; body: string } | null {
  const match = md.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/)
  if (!match) return null

  const fmStr = match[1]!
  const body = match[2]!

  const frontmatter: Record<string, unknown> = {}
  for (const line of fmStr.split("\n")) {
    const colonIdx = line.indexOf(":")
    if (colonIdx < 0) continue
    const key = line.slice(0, colonIdx).trim()
    let value: unknown = line.slice(colonIdx + 1).trim()

    // Parse lists [a, b, c]
    if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
      value = value
        .slice(1, -1)
        .split(",")
        .map((v) => v.trim().replace(/^["']|["']$/g, ""))
    }
    // Parse quoted strings
    if (typeof value === "string" && (value.startsWith('"') || value.startsWith("'"))) {
      value = value.slice(1, -1)
    }

    frontmatter[key] = value
  }

  return { frontmatter, body }
}

/** Generate SKILL.md content with frontmatter */
function generateSkillMarkdown(
  name: string,
  description: string,
  body: string,
  version = "1.0.0",
  createdBy = "agent",
  tags: string[] = [],
): string {
  const tagsStr = tags.length > 0 ? `[${tags.join(", ")}]` : "[]"
  return `---
name: ${name}
description: ${description}
version: ${version}
created_by: ${createdBy}
tags: ${tagsStr}
---
${body}`
}

// ─── Built-in Fuzzy Patch (exact match fallback) ────────────────────────────

/**
 * Default exact-match fuzzy patch. Simple but reliable.
 * Override with `setFuzzyPatcher()` for advanced strategies (whitespace normalization,
 * token matching, Levenshtein fuzzy, etc. — see @fengru/fuzzy-patch).
 */
function defaultFuzzyPatch(
  content: string,
  oldStr: string,
  newStr: string,
  replaceAll = false,
): { newContent: string; matchCount: number; strategy: string; error?: string } {
  if (!oldStr) {
    return { newContent: content, matchCount: 0, strategy: "none", error: "oldStr is empty" }
  }

  if (replaceAll) {
    const parts = content.split(oldStr)
    const matchCount = parts.length - 1
    if (matchCount === 0) {
      return { newContent: content, matchCount: 0, strategy: "exact", error: "No matches found" }
    }
    return { newContent: parts.join(newStr), matchCount, strategy: "exact_replace_all" }
  }

  const idx = content.indexOf(oldStr)
  if (idx < 0) {
    return { newContent: content, matchCount: 0, strategy: "exact", error: "No match found" }
  }

  const newContent = content.slice(0, idx) + newStr + content.slice(idx + oldStr.length)
  return { newContent, matchCount: 1, strategy: "exact" }
}

// ─── SkillSystem ────────────────────────────────────────────────────────────

export class SkillSystem {
  private skills = new Map<string, Skill>()
  private hookHandlers = new Map<HookPoint, Array<(context: Record<string, unknown>) => Promise<void>>>()
  private agentSkills: AgentSkill[] = []

  // ── Legacy Skill Registration ─────────────────────────────────────────

  registerSkill(skill: Skill): void {
    this.skills.set(skill.skill_id, skill)
  }

  unregisterSkill(skillId: string): void {
    this.skills.delete(skillId)
  }

  matchSkills(context: string): Skill[] {
    return Array.from(this.skills.values())
      .filter((s) => {
        try {
          return context.toLowerCase().includes(s.trigger_condition.toLowerCase())
        } catch {
          return false
        }
      })
      .sort((a, b) => b.priority - a.priority)
  }

  onHook(hookPoint: HookPoint, handler: (context: Record<string, unknown>) => Promise<void>): void {
    const handlers = this.hookHandlers.get(hookPoint) ?? []
    handlers.push(handler)
    this.hookHandlers.set(hookPoint, handlers)
  }

  async triggerHook(hookPoint: HookPoint, context: Record<string, unknown>): Promise<void> {
    const handlers = this.hookHandlers.get(hookPoint) ?? []
    for (const handler of handlers) {
      try {
        await handler(context)
      } catch {
        // Hook failures must not propagate
      }
    }
  }

  buildPromptInjection(currentGoal: string): string {
    const skills = this.matchSkills(currentGoal)
    if (skills.length === 0) return ""
    return skills.map((s) => `[Skill: ${s.skill_id}] ${s.prompt_template}`).join("\n")
  }

  getAllSkills(): Skill[] {
    return Array.from(this.skills.values()).sort((a, b) => b.priority - a.priority)
  }

  recordHit(skillId: string): void {
    const skill = this.skills.get(skillId)
    if (skill) {
      skill.hit_count++
    }
  }

  // ─── Hermes-inspired Agent Skill Extensions ────────────────────────────

  /** Register a file-backed agent skill */
  registerAgentSkill(skill: AgentSkill): void {
    const existingIdx = this.agentSkills.findIndex((s) => s.name === skill.name)
    if (existingIdx >= 0) {
      this.agentSkills[existingIdx] = skill
    } else {
      this.agentSkills.push(skill)
    }
  }

  /** Remove an agent skill by name */
  unregisterAgentSkill(name: string): void {
    this.agentSkills = this.agentSkills.filter((s) => s.name !== name)
  }

  /** Get all registered agent skills */
  getAllAgentSkills(): AgentSkill[] {
    return [...this.agentSkills]
  }

  /** Get a single agent skill by name */
  getAgentSkill(name: string): AgentSkill | undefined {
    return this.agentSkills.find((s) => s.name === name)
  }

  /**
   * Build L0 index: a compact name+description listing for injection into
   * system prompts. Roughly ~3K tokens for ~100 skills.
   */
  buildL0Injection(): string {
    if (this.agentSkills.length === 0) return ""

    const nonPinned = this.agentSkills
      .filter((s) => !s.pinned)
      .sort((a, b) => b.usage_count - a.usage_count)
    const pinned = this.agentSkills
      .filter((s) => s.pinned)
      .sort((a, b) => b.usage_count - a.usage_count)

    const lines: string[] = []

    if (pinned.length > 0) {
      lines.push("## 📌 Pinned Skills")
      for (const s of pinned) {
        const tags = s.tags.length > 0 ? ` [${s.tags.join(", ")}]` : ""
        lines.push(`- **${s.name}**: ${s.description}${tags}`)
      }
    }

    if (nonPinned.length > 0) {
      if (pinned.length > 0) lines.push("")
      lines.push("## 🔧 Available Skills")
      for (const s of nonPinned) {
        const tags = s.tags.length > 0 ? ` [${s.tags.join(", ")}]` : ""
        lines.push(`- **${s.name}**: ${s.description}${tags}`)
      }
    }

    return lines.join("\n")
  }

  /** Load full skill content (L1: complete SKILL.md) — requires filesystem access */
  async loadFullSkill(_name: string, _readFn?: (filePath: string) => Promise<string>): Promise<string> {
    const skill = this.getAgentSkill(_name)
    if (!skill) return ""
    if (_readFn) {
      try {
        return await _readFn(skill.file_path)
      } catch {
        return ""
      }
    }
    return `[Skill: ${skill.name}] ${skill.description} (file: ${skill.file_path})`
  }

  /** Search agent skills by keyword */
  searchAgentSkills(query: string): AgentSkill[] {
    const lower = query.toLowerCase()
    return this.agentSkills.filter(
      (s) =>
        s.name.toLowerCase().includes(lower) ||
        s.description.toLowerCase().includes(lower) ||
        s.tags.some((t) => t.toLowerCase().includes(lower)),
    )
  }

  /** Record usage of an agent skill */
  recordAgentSkillUsage(name: string): void {
    const skill = this.getAgentSkill(name)
    if (skill) {
      skill.usage_count++
      skill.last_used_at = Date.now()
    }
  }
}

// ─── SkillManager ───────────────────────────────────────────────────────────

export class SkillManager {
  readonly config: SkillManagerConfig
  readonly skillSystem: SkillSystem
  /** Pluggable fuzzy patch function */
  private _fuzzyPatch: FuzzyPatchFn = defaultFuzzyPatch
  /** Cache of loaded skill file contents (L1 cache) */
  private contentCache = new Map<string, string>()

  constructor(config: SkillManagerConfig, skillSystem: SkillSystem) {
    this.config = config
    this.skillSystem = skillSystem
  }

  /**
   * Override the default fuzzy patch implementation.
   * Use @fengru/fuzzy-patch for 8-strategy advanced matching.
   */
  setFuzzyPatcher(fn: FuzzyPatchFn): void {
    this._fuzzyPatch = fn
  }

  /** Ensure skill directories exist */
  async init(): Promise<void> {
    for (const dir of [this.config.projectSkillDir, this.config.userSkillDir]) {
      if (dir && !existsSync(dir)) {
        await mkdir(dir, { recursive: true })
      }
    }
    // Also ensure archive dir
    const archiveDir = path.join(this.config.projectSkillDir, ".archive")
    if (!existsSync(archiveDir)) {
      await mkdir(archiveDir, { recursive: true })
    }
  }

  // ── L0 / L1 / L2 Progressive Loading ────────────────────────────────────

  /**
   * L0: Build compact name+description index for system prompt injection.
   * Scans skill directories on disk and registers them into the SkillSystem.
   */
  async buildL0Index(): Promise<string> {
    await this.scanAndRegister()

    const allSkills = this.skillSystem.getAllAgentSkills()
    const projectSkills = allSkills.filter(
      (s) =>
        this.config.projectSkillDir &&
        s.file_path.replace(/\\/g, "/").startsWith(this.config.projectSkillDir.replace(/\\/g, "/")),
    )
    const userSkills = allSkills.filter(
      (s) =>
        this.config.userSkillDir &&
        s.file_path.replace(/\\/g, "/").startsWith(this.config.userSkillDir.replace(/\\/g, "/")),
    )

    const lines: string[] = []

    if (userSkills.length > 0) {
      lines.push("## User Skills (~/.fengru/skills/)")
      for (const s of userSkills) {
        const pin = s.pinned ? "📌 " : ""
        lines.push(`- ${pin}**${s.name}**: ${s.description}`)
      }
      lines.push("")
    }

    if (projectSkills.length > 0) {
      lines.push("## Project Skills (.fengru/skills/)")
      for (const s of projectSkills) {
        const pin = s.pinned ? "📌 " : ""
        lines.push(`- ${pin}**${s.name}**: ${s.description}`)
      }
    }

    return lines.join("\n")
  }

  /**
   * L1: Load full skill content from disk (SKILL.md body).
   */
  async loadSkill(name: string): Promise<string> {
    // Scan to discover skills created by other instances
    await this.scanAndRegister()

    // Check cache first
    const cached = this.contentCache.get(name)
    if (cached) return cached

    const skill = this.skillSystem.getAgentSkill(name)
    if (!skill) return ""

    try {
      const raw = await readFile(skill.file_path, "utf-8")
      const parsed = parseFrontmatter(raw)
      const content = parsed ? parsed.body : raw
      this.contentCache.set(name, content)
      return content
    } catch {
      return ""
    }
  }

  /**
   * L2: Load attached files referenced by a skill (e.g., references/ subdir).
   */
  async loadAttachedFile(name: string, relativePath: string): Promise<string> {
    const skill = this.skillSystem.getAgentSkill(name)
    if (!skill) return ""

    const dir = path.dirname(skill.file_path)
    const fullPath = path.join(dir, relativePath)

    try {
      return await readFile(fullPath, "utf-8")
    } catch {
      return ""
    }
  }

  // ── CRUD Operations (Agent-Callable) ─────────────────────────────────────

  /**
   * Create a new skill file and register it.
   */
  async createSkill(params: CreateSkillParams): Promise<CreateSkillResult> {
    const { name, description, content, category, tags = [], triggerCondition } = params

    // Sanitize name for filesystem
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase()
    const fileName = `${safeName}.md`

    // Determine directory
    const dir = this.config.projectSkillDir
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }

    const filePath = path.join(dir, fileName)
    const fullContent = generateSkillMarkdown(name, description, content, "1.0.0", "agent", tags)

    await writeFile(filePath, fullContent, "utf-8")

    const skill: AgentSkill = {
      name,
      description,
      version: "1.0.0",
      created_by: "agent",
      tags,
      file_path: filePath,
      usage_count: 0,
      last_used_at: Date.now(),
      pinned: false,
      created_at: Date.now(),
      category,
    }

    this.skillSystem.registerAgentSkill(skill)
    this.contentCache.set(name, content)

    // Also register in the legacy SkillSystem for prompt injection
    if (triggerCondition) {
      this.skillSystem.registerSkill({
        skill_id: `agent_${safeName}`,
        trigger_condition: triggerCondition,
        prompt_template: description,
        priority: 5,
        scope: "global",
        hit_count: 0,
        created_at: Date.now(),
      })
    }

    return { skill, filePath }
  }

  /**
   * Patch a skill file — find oldStr and replace with newStr using fuzzy matching.
   */
  async patchSkill(
    name: string,
    oldStr: string,
    newStr: string,
    replaceAll = false,
  ): Promise<PatchSkillResult> {
    // Scan to discover skills created by other instances
    await this.scanAndRegister()

    const skill = this.skillSystem.getAgentSkill(name)
    if (!skill) {
      return { newContent: "", matchCount: 0, strategy: "none", error: `Skill "${name}" not found` }
    }

    const currentContent = await readFile(skill.file_path, "utf-8")
    const result = this._fuzzyPatch(currentContent, oldStr, newStr, replaceAll)

    if (result.matchCount > 0) {
      await writeFile(skill.file_path, result.newContent, "utf-8")
      this.contentCache.delete(name)
    }

    return {
      newContent: result.newContent,
      matchCount: result.matchCount,
      strategy: result.strategy,
      error: result.error,
    }
  }

  /**
   * Delete a skill — move to .archive/ instead of removing permanently.
   */
  async deleteSkill(name: string): Promise<boolean> {
    // Scan to discover skills created by other instances
    await this.scanAndRegister()

    const skill = this.skillSystem.getAgentSkill(name)
    if (!skill) return false

    const archiveDir = path.join(this.config.projectSkillDir, ".archive")
    if (!existsSync(archiveDir)) {
      await mkdir(archiveDir, { recursive: true })
    }

    const archivePath = path.join(archiveDir, path.basename(skill.file_path))

    try {
      // Move to archive
      const content = await readFile(skill.file_path, "utf-8")
      await writeFile(archivePath, content, "utf-8")
      await unlink(skill.file_path)

      this.skillSystem.unregisterAgentSkill(name)
      this.contentCache.delete(name)
      return true
    } catch {
      return false
    }
  }

  /**
   * List all registered skills.
   */
  async listSkills(): Promise<SkillListItem[]> {
    await this.scanAndRegister()

    return this.skillSystem.getAllAgentSkills().map((s) => ({
      name: s.name,
      description: s.description,
      version: s.version,
      createdBy: s.created_by,
      usageCount: s.usage_count,
      lastUsed: s.last_used_at,
      pinned: s.pinned,
      tags: s.tags,
      filePath: s.file_path,
    }))
  }

  /**
   * Search skills by query string.
   */
  async searchSkills(query: string): Promise<SkillListItem[]> {
    const results = this.skillSystem.searchAgentSkills(query)
    return results.map((s) => ({
      name: s.name,
      description: s.description,
      version: s.version,
      createdBy: s.created_by,
      usageCount: s.usage_count,
      lastUsed: s.last_used_at,
      pinned: s.pinned,
      tags: s.tags,
      filePath: s.file_path,
    }))
  }

  /**
   * Record that a skill was used (updates usage_count and last_used_at).
   */
  recordUsage(name: string): void {
    this.skillSystem.recordAgentSkillUsage(name)
  }

  /**
   * Get all skill files (for curator operations).
   */
  async getSkillFiles(): Promise<Array<{ name: string; filePath: string; content: string }>> {
    const files: Array<{ name: string; filePath: string; content: string }> = []

    for (const skill of this.skillSystem.getAllAgentSkills()) {
      try {
        const content = await readFile(skill.file_path, "utf-8")
        files.push({ name: skill.name, filePath: skill.file_path, content })
      } catch {
        // Skip unreadable
      }
    }

    return files
  }

  /**
   * Pin a skill (prevents auto-archive).
   */
  pinSkill(name: string): boolean {
    const skill = this.skillSystem.getAgentSkill(name)
    if (!skill) return false
    skill.pinned = true
    return true
  }

  /**
   * Unpin a skill.
   */
  unpinSkill(name: string): boolean {
    const skill = this.skillSystem.getAgentSkill(name)
    if (!skill) return false
    skill.pinned = false
    return true
  }

  // ── Internal Helpers ─────────────────────────────────────────────────────

  /**
   * Scan skill directories on disk and register discovered skills.
   */
  private async scanAndRegister(): Promise<void> {
    for (const dir of [this.config.projectSkillDir, this.config.userSkillDir]) {
      if (!existsSync(dir)) continue

      try {
        const entries = await readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith(".md")) continue
          const filePath = path.join(dir, entry.name)

          // Skip if already registered
          const existing = this.skillSystem
            .getAllAgentSkills()
            .find((s) => s.file_path === filePath)
          if (existing) continue

          try {
            const raw = await readFile(filePath, "utf-8")
            const parsed = parseFrontmatter(raw)
            if (!parsed) continue

            const fm = parsed.frontmatter
            const name = (fm.name as string) ?? entry.name.replace(/\.md$/, "")
            const description = (fm.description as string) ?? ""
            const version = (fm.version as string) ?? "1.0.0"
            const createdBy = (fm.created_by as "user" | "agent") ?? "agent"
            const tags: string[] = Array.isArray(fm.tags)
              ? fm.tags.map((t: unknown) => String(t))
              : []

            this.skillSystem.registerAgentSkill({
              name,
              description,
              version,
              created_by: createdBy,
              tags,
              file_path: filePath,
              usage_count: 0,
              last_used_at: 0,
              pinned: false,
              created_at: Date.now(),
            })

            // Cache content
            this.contentCache.set(name, parsed.body)
          } catch {
            // Skip unreadable files
          }
        }
      } catch {
        // Skip unreadable directories
      }
    }
  }
}

// ─── DAG Generation Prompt Template (exported for LLMDAGGenerator integration) ─

export const DAG_GENERATION_PROMPT = `
You are a task planner. Given the user goal and available capabilities, generate a DAG.

Goal: {{goal}}

Available capabilities:
{{capabilities}}

Rules:
1. Every node must reference a capability_id from the list above
2. Dependencies must form a DAG (no cycles)
3. Include estimated tokens and duration for each node
4. Mark risk_level per node (0=read-only, 1=local-modify, 2=global-impact, 3=destructive)
5. Only include nodes that directly contribute to the goal

Output JSON format:
{
  "nodes": [
    {
      "node_id": "n1",
      "capability_id": "...",
      "inputs": {},
      "dependencies": [],
      "risk_level": 0,
      "estimated_tokens": 100,
      "estimated_duration_ms": 5000
    }
  ],
  "edges": [["n1", "n2"]]
}
`
