/**
 * LearningNudge — Self-Reflection Trigger for Continuous Agent Learning
 *
 * Active reflection: the agent periodically asks itself "what's worth remembering?"
 * regardless of context utilization levels. 4 nudge types:
 *
 *   - periodic:          every N tool calls, independent LLM reflection
 *   - session_end:        summarize the whole session's key insights
 *   - pattern_detection:  same capability succeeds 3+ times → suggest skill creation
 *   - user_declaration:   user says "remember this" → immediate persistence
 *
 * Outputs:
 *   - Facts/insights → project memory (MEMORY.md)
 *   - New patterns     → skill suggestions
 *
 * Zero runtime dependencies.
 *
 * @module learning-nudge
 */

// ── Minimal Adapter Interfaces ─────────────────────────────────────────────

export interface ProviderAdapter {
  chat(params: {
    messages: Array<{ role: string; content: string }>
  }): Promise<{ content: string }>
}

export interface IProjectMemory {
  upsertEntry(entry: {
    section: string
    content: string
    verification_count: number
    confidence: number
    source_sessions: string[]
    user_authored: boolean
  }): Promise<unknown>
}

export interface ISkillManager {
  createSkill(skill: {
    name: string
    description: string
    content: string
    category: string
    tags: string[]
  }): Promise<unknown>
}

// ── Types ──────────────────────────────────────────────────────────────────

export type NudgeType = "periodic" | "session_end" | "pattern_detection" | "user_declaration"

export interface NudgeAction {
  type: NudgeType
  reason: string
  priority: number
  capabilityId?: string
}

export interface NudgeResult {
  hasInsights: boolean
  memoryEntries: number
  skillSuggestions: number
  reflection?: string
  errors: string[]
}

export interface NudgeConfig {
  periodicInterval: number
  minToolCalls: number
  patternThreshold: number
  maxConcurrent: number
}

const DEFAULT_CONFIG: NudgeConfig = {
  periodicInterval: 10,
  minToolCalls: 5,
  patternThreshold: 3,
  maxConcurrent: 2,
}

// ── Reflection Prompts ─────────────────────────────────────────────────────

const PERIODIC_REFLECTION_PROMPT = `You are an AI learning coach. Review the recent tool calls and output from the agent session below. Your job is to identify insights worth remembering.

Recent activity:
{{recent_history}}

Identify:
1. **Key Facts**: Technical facts discovered or confirmed (APIs, configs, behaviors, limits)
2. **Patterns**: Repeated successful strategies or workflows
3. **Mistakes**: Errors made and what was learned
4. **Decisions**: Important design or implementation decisions made

For each insight, classify it as:
- "facts": verified technical facts
- "patterns": reusable work patterns / workflows
- "rules": user-specified constraints or preferences
- "decisions": architectural or design choices

Return JSON only:
{
  "insights": [
    {
      "type": "facts|patterns|rules|decisions",
      "content": "concise one-line description",
      "confidence": 0.0-1.0,
      "should_be_skill": true/false,
      "skill_name": "suggested skill name (if should_be_skill)"
    }
  ],
  "summary": "one-line session progress summary"
}`

const SESSION_END_REFLECTION_PROMPT = `You are an AI learning coach. The agent session has just ended. Review the full session and identify the most important things to remember for future sessions.

Session goal: {{goal}}
Total tool calls: {{tool_calls}}
Successful operations: {{success_count}}
Failed operations: {{failure_count}}

Key events:
{{session_summary}}

Identify:
1. **Verified Facts**: Technical truths established during this session
2. **Work Patterns**: Reusable strategies that proved effective
3. **Project Rules**: Conventions, constraints, or preferences discovered
4. **Architecture Decisions**: Design choices with rationale

Return JSON only:
{
  "insights": [
    {
      "type": "facts|patterns|rules|decisions",
      "content": "concise description",
      "confidence": 0.0-1.0,
      "should_be_skill": true/false,
      "skill_name": "suggested skill name (if applicable)"
    }
  ],
  "session_quality": "brief assessment of session effectiveness"
}`

// ── LearningNudge ──────────────────────────────────────────────────────────

export class LearningNudge {
  private config: NudgeConfig
  private provider: ProviderAdapter | null = null
  private projectMemory: IProjectMemory | null = null
  private skillManager: ISkillManager | null = null

  private toolCallCount = 0
  private lastNudgeStep = 0
  private capabilitySuccessCounts = new Map<string, number>()
  private recentHistory: string[] = []
  private pendingNudge = false

  constructor(config?: Partial<NudgeConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  setProjectMemory(manager: IProjectMemory): void {
    this.projectMemory = manager
  }
  setSkillManager(manager: ISkillManager): void {
    this.skillManager = manager
  }
  setProvider(provider: ProviderAdapter): void {
    this.provider = provider
  }

  // ── Evaluate ──────────────────────────────────────────────────────────

  /**
   * Evaluate whether a nudge should fire now.
   * Called after each tool execution.
   */
  evaluate(toolCallIncrement: number, capabilityId?: string, success = true): NudgeAction | null {
    this.toolCallCount += toolCallIncrement

    // Track capability success patterns
    if (capabilityId && success) {
      const count = (this.capabilitySuccessCounts.get(capabilityId) ?? 0) + 1
      this.capabilitySuccessCounts.set(capabilityId, count)

      // Pattern detection: same capability succeeded 3+ times
      if (count >= this.config.patternThreshold && count % this.config.patternThreshold === 0) {
        return {
          type: "pattern_detection",
          reason: `Capability "${capabilityId}" succeeded ${count} times — consider creating a skill`,
          priority: 6,
          capabilityId,
        }
      }
    }

    // Periodic nudge: every N tool calls
    const stepsSinceLastNudge = this.toolCallCount - this.lastNudgeStep
    if (
      !this.pendingNudge &&
      stepsSinceLastNudge >= this.config.periodicInterval &&
      this.toolCallCount >= this.config.minToolCalls
    ) {
      this.pendingNudge = true
      return {
        type: "periodic",
        reason: `${stepsSinceLastNudge} tool calls since last reflection`,
        priority: 4,
      }
    }

    return null
  }

  hasPending(): boolean {
    return this.pendingNudge
  }

  // ── Execute Nudge ─────────────────────────────────────────────────────

  /** Execute a periodic reflection nudge */
  async executeNudge(_sessionId: string, recentHistory: string[]): Promise<NudgeResult> {
    const errors: string[] = []
    this.recentHistory = recentHistory

    if (!this.provider || recentHistory.length === 0) {
      this.pendingNudge = false
      this.lastNudgeStep = this.toolCallCount
      return { hasInsights: false, memoryEntries: 0, skillSuggestions: 0, errors }
    }

    try {
      const historyText = recentHistory.slice(-20).join("\n").slice(0, 3000)
      const prompt = PERIODIC_REFLECTION_PROMPT.replace("{{recent_history}}", historyText)

      const response = await this.provider.chat({
        messages: [
          { role: "system", content: "You are a learning coach. Output valid JSON only. No explanation." },
          { role: "user", content: prompt },
        ],
      })

      const result = await this.processReflection(response.content, _sessionId, errors)
      this.pendingNudge = false
      this.lastNudgeStep = this.toolCallCount
      return result
    } catch (err) {
      errors.push(`Reflection failed: ${err instanceof Error ? err.message : String(err)}`)
      this.pendingNudge = false
      this.lastNudgeStep = this.toolCallCount
      return { hasInsights: false, memoryEntries: 0, skillSuggestions: 0, errors }
    }
  }

  /** Session-end reflection nudge */
  async sessionEndNudge(
    _sessionId: string,
    goal: string,
    toolCalls: number,
    successCount: number,
    failureCount: number,
    sessionSummary: string[],
  ): Promise<NudgeResult> {
    const errors: string[] = []

    if (!this.provider) {
      return { hasInsights: false, memoryEntries: 0, skillSuggestions: 0, errors }
    }

    try {
      const prompt = SESSION_END_REFLECTION_PROMPT.replace("{{goal}}", goal)
        .replace("{{tool_calls}}", String(toolCalls))
        .replace("{{success_count}}", String(successCount))
        .replace("{{failure_count}}", String(failureCount))
        .replace("{{session_summary}}", sessionSummary.join("\n").slice(0, 2000))

      const response = await this.provider.chat({
        messages: [
          { role: "system", content: "You are a learning coach. Output valid JSON only. No explanation." },
          { role: "user", content: prompt },
        ],
      })

      const result = await this.processReflection(response.content, _sessionId, errors)
      result.reflection = response.content
      return result
    } catch (err) {
      errors.push(`Session-end reflection failed: ${err instanceof Error ? err.message : String(err)}`)
      return { hasInsights: false, memoryEntries: 0, skillSuggestions: 0, errors }
    }
  }

  /** User explicitly said "remember this" */
  async userDeclarationNudge(sessionId: string, content: string): Promise<NudgeResult> {
    const errors: string[] = []

    if (this.projectMemory) {
      try {
        await this.projectMemory.upsertEntry({
          section: "facts",
          content,
          verification_count: 1,
          confidence: 0.9,
          source_sessions: [sessionId],
          user_authored: false,
        })
        return { hasInsights: true, memoryEntries: 1, skillSuggestions: 0, errors }
      } catch (err) {
        errors.push(`Failed to persist user declaration: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    return { hasInsights: false, memoryEntries: 0, skillSuggestions: 0, errors }
  }

  // ── Internal Reflection Processing ────────────────────────────────────

  private async processReflection(rawContent: string, sessionId: string, errors: string[]): Promise<NudgeResult> {
    let memoryEntries = 0
    let skillSuggestions = 0

    try {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        return { hasInsights: false, memoryEntries: 0, skillSuggestions: 0, errors }
      }

      const parsed = JSON.parse(jsonMatch[0])
      const insights: Array<{
        type: string
        content: string
        confidence: number
        should_be_skill?: boolean
        skill_name?: string
      }> = Array.isArray(parsed.insights) ? parsed.insights : []

      for (const insight of insights) {
        if (!insight.content) continue

        const section = this.mapTypeToSection(insight.type)

        // Persist to project memory
        if (this.projectMemory && insight.confidence >= 0.5) {
          try {
            await this.projectMemory.upsertEntry({
              section,
              content: insight.content,
              verification_count: 1,
              confidence: insight.confidence,
              source_sessions: [sessionId],
              user_authored: false,
            })
            memoryEntries++
          } catch (err) {
            errors.push(
              `Failed to persist insight "${insight.content.slice(0, 50)}": ${err instanceof Error ? err.message : String(err)}`,
            )
          }
        }

        // Suggest skill creation
        if (insight.should_be_skill && insight.skill_name && this.skillManager) {
          try {
            await this.skillManager.createSkill({
              name: insight.skill_name,
              description: insight.content,
              content: `# ${insight.skill_name}\n\n${insight.content}\n\n## Usage\n\nApply this skill when: ...`,
              category: "auto-generated",
              tags: [insight.type],
            })
            skillSuggestions++
          } catch (err) {
            errors.push(
              `Failed to create skill "${insight.skill_name}": ${err instanceof Error ? err.message : String(err)}`,
            )
          }
        }
      }

      return {
        hasInsights: memoryEntries > 0 || skillSuggestions > 0,
        memoryEntries,
        skillSuggestions,
        errors,
      }
    } catch (err) {
      errors.push(`Failed to parse reflection JSON: ${err instanceof Error ? err.message : String(err)}`)
      return { hasInsights: false, memoryEntries: 0, skillSuggestions: 0, errors }
    }
  }

  private mapTypeToSection(type: string): string {
    switch (type) {
      case "facts":
        return "facts"
      case "patterns":
        return "patterns"
      case "rules":
        return "rules"
      case "decisions":
        return "decisions"
      default:
        return "facts"
    }
  }

  // ── State Management ──────────────────────────────────────────────────

  reset(): void {
    this.toolCallCount = 0
    this.lastNudgeStep = 0
    this.capabilitySuccessCounts.clear()
    this.recentHistory = []
    this.pendingNudge = false
  }

  getToolCallCount(): number {
    return this.toolCallCount
  }
  getPatternStats(): Map<string, number> {
    return new Map(this.capabilitySuccessCounts)
  }
}

/**
 * Create a {@link LearningNudge} instance.
 *
 * @param args - Constructor arguments forwarded to {@link LearningNudge}.
 * @returns A new {@link LearningNudge}.
 */
export function createLearningNudge(...args: ConstructorParameters<typeof LearningNudge>): LearningNudge {
  return new LearningNudge(...args)
}
