/**
 * SkillCurator — Automated Skill Library Curation
 *
 * Handles automatic maintenance of the agent skill library:
 * - Archive: moves 30-day unused agent-created skills to .archive/
 * - Pin: pins top-N% most-frequently-used skills to prevent archive
 * - Review: LLM-driven or heuristic quality review of skill completeness
 *
 * Only operates on skills with `created_by: "agent"`. Never deletes —
 * always moves to `.archive/`. Pinned skills are exempt from all operations.
 *
 * @module skill-curator
 */

// ─── Inlined Interfaces ─────────────────────────────────────────────────────

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

export interface ISkillManager {
  listSkills(): Promise<SkillListItem[]>
  loadSkill(name: string): Promise<string>
  deleteSkill(name: string): Promise<boolean>
  pinSkill(name: string): boolean
  unpinSkill(name: string): boolean
  readonly skillSystem: { getAgentSkill(name: string): { last_used_at: number; pinned: boolean } | undefined }
}

export interface ProviderAdapter {
  chat(params: {
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>
  }): Promise<{ content: string }>
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CuratorResult {
  archived: number
  pinned: number
  reviewed: QualityReview[]
  warnings: string[]
}

export interface QualityReview {
  skillName: string
  score: number
  suggestions: string[]
  issues: string[]
}

export interface CuratorConfig {
  archiveDaysThreshold: number
  pinTopPercent: number
  minSkillsForPin: number
}

const DEFAULT_CONFIG: CuratorConfig = {
  archiveDaysThreshold: 30,
  pinTopPercent: 0.1,
  minSkillsForPin: 10,
}

// ─── Quality Review Prompt ──────────────────────────────────────────────────

const QUALITY_REVIEW_PROMPT = `You are a skill quality reviewer. Evaluate the following skill file for completeness and correctness.

Skill name: {{name}}
Skill description: {{description}}
Skill content:
{{content}}

Evaluate on these dimensions (score each 0-10):
1. Completeness: Does it cover all necessary steps?
2. Clarity: Is the language clear and actionable?
3. Correctness: Are the instructions technically accurate?
4. Reusability: Could another agent pick this up and use it effectively?
5. Maintainability: Is it structured for future edits?

Return JSON only:
{
  "scores": { "completeness": N, "clarity": N, "correctness": N, "reusability": N, "maintainability": N },
  "overall_score": N (average * 10, rounded),
  "issues": ["issue1", "issue2"],
  "suggestions": ["suggestion1", "suggestion2"]
}`

// ─── SkillCurator ───────────────────────────────────────────────────────────

export class SkillCurator {
  private config: CuratorConfig
  private skillManager: ISkillManager
  private provider: ProviderAdapter | null = null

  constructor(skillManager: ISkillManager, config?: Partial<CuratorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.skillManager = skillManager
  }

  setProvider(provider: ProviderAdapter): void {
    this.provider = provider
  }

  /**
   * Run a full curation cycle: archive stale → pin frequent → review quality.
   */
  async run(): Promise<CuratorResult> {
    const archived = await this.archiveStale(this.config.archiveDaysThreshold)
    const pinned = await this.pinFrequent(this.config.pinTopPercent)
    const reviewed: QualityReview[] = []

    if (this.provider) {
      const skills = await this.skillManager.listSkills()
      const agentSkills = skills.filter((s) => s.createdBy === "agent" && !s.pinned)
      const toReview = agentSkills.slice(0, 5)
      for (const skill of toReview) {
        const review = await this.reviewQuality(skill.name)
        reviewed.push(review)
      }
    }

    const warnings: string[] = []
    for (const r of reviewed) {
      if (r.score < 50) {
        warnings.push(`Skill "${r.skillName}" scored ${r.score}/100 — consider review or archive`)
      }
    }

    return { archived, pinned, reviewed, warnings }
  }

  async archiveStale(daysThreshold: number = this.config.archiveDaysThreshold): Promise<number> {
    const skills = await this.skillManager.listSkills()
    const now = Date.now()
    const cutoff = now - daysThreshold * 24 * 60 * 60 * 1000

    let archived = 0
    for (const skill of skills) {
      if (skill.createdBy !== "agent") continue
      if (skill.pinned) continue

      if (skill.lastUsed === 0 || skill.lastUsed < cutoff) {
        const deleted = await this.skillManager.deleteSkill(skill.name)
        if (deleted) archived++
      }
    }

    return archived
  }

  async pinFrequent(topPercent: number = this.config.pinTopPercent): Promise<number> {
    const skills = await this.skillManager.listSkills()
    const agentSkills = skills.filter((s) => s.createdBy === "agent" && !s.pinned)

    if (agentSkills.length < this.config.minSkillsForPin) return 0

    agentSkills.sort((a, b) => b.usageCount - a.usageCount)

    const topN = Math.max(1, Math.ceil(agentSkills.length * topPercent))
    let pinned = 0

    for (let i = 0; i < topN && i < agentSkills.length; i++) {
      const skill = agentSkills[i]!
      if (skill.usageCount > 0) {
        this.skillManager.pinSkill(skill.name)
        pinned++
      }
    }

    return pinned
  }

  async reviewQuality(skillName: string): Promise<QualityReview> {
    const content = await this.skillManager.loadSkill(skillName)
    if (!content) {
      return { skillName, score: 0, suggestions: [], issues: ["Skill not found or empty"] }
    }

    if (!this.provider) {
      return this.heuristicReview(skillName, content)
    }

    try {
      const prompt = QUALITY_REVIEW_PROMPT.replace("{{name}}", skillName)
        .replace("{{description}}", "")
        .replace("{{content}}", content.slice(0, 4000))

      const response = await this.provider.chat({
        messages: [
          { role: "system", content: "You are a skill quality reviewer. Output valid JSON only. No explanation." },
          { role: "user", content: prompt },
        ],
      })

      const jsonMatch = response.content.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        return this.heuristicReview(skillName, content)
      }

      const parsed = JSON.parse(jsonMatch[0])

      return {
        skillName,
        score: parsed.overall_score ?? 50,
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
        issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      }
    } catch {
      return this.heuristicReview(skillName, content)
    }
  }

  private heuristicReview(skillName: string, content: string): QualityReview {
    const lines = content.split("\n").filter((l) => l.trim().length > 0)
    const hasSteps = /^\d+\.\s|step/i.test(content)
    const hasCodeBlocks = content.includes("```")
    const hasSections = (content.match(/^#{1,3}\s/gm) ?? []).length >= 2
    const minLength = 100

    let score = 30
    if (hasSteps) score += 15
    if (hasCodeBlocks) score += 15
    if (hasSections) score += 15
    if (content.length >= minLength) score += 10
    if (lines.length >= 10) score += 10
    if (content.length >= 500) score += 10

    const issues: string[] = []
    if (!hasSteps) issues.push("Missing numbered steps")
    if (!hasCodeBlocks) issues.push("No code examples")
    if (!hasSections) issues.push("Lacks section structure")
    if (content.length < minLength) issues.push("Too short")

    const suggestions: string[] = []
    if (!hasSteps) suggestions.push("Add numbered execution steps")
    if (!hasCodeBlocks) suggestions.push("Include code examples")
    if (!hasSections) suggestions.push("Add structured sections (## Usage, ## Steps, ## Notes)")

    return { skillName, score: Math.min(100, score), suggestions, issues }
  }

  shouldArchive(skillName: string, daysThreshold?: number): boolean {
    const skill = this.skillManager.skillSystem.getAgentSkill(skillName)
    if (!skill || skill.pinned) return false

    const cutoff = Date.now() - (daysThreshold ?? this.config.archiveDaysThreshold) * 24 * 60 * 60 * 1000
    return skill.last_used_at < cutoff
  }
}

/**
 * Create a {@link SkillCurator} instance.
 *
 * @param args - Constructor arguments forwarded to {@link SkillCurator}.
 * @returns A new {@link SkillCurator}.
 */
export function createSkillCurator(...args: ConstructorParameters<typeof SkillCurator>): SkillCurator {
  return new SkillCurator(...args)
}
