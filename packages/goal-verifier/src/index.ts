/**
 * GoalVerifier — Independent Goal Completion Verification
 *
 * When the agent believes it has completed its task (DAG complete, all nodes
 * succeeded), the GoalVerifier performs an independent review BEFORE allowing
 * the COMPLETED state transition. This prevents false completions.
 *
 * Design:
 *   - Independent LLM call — does NOT share main agent's attention budget
 *   - Reviews FULL conversation history against the user's goal
 *   - Returns structured verdict: satisfied / gap_found / impossible
 *   - Dead-loop protection: max N retries before forced exit
 *   - Gap analysis: when not satisfied, explains what's missing → triggers replan
 *
 * Zero runtime dependencies.
 *
 * @module goal-verifier
 */

export interface ProviderAdapter {
  chat(params: {
    messages: Array<{ role: string; content: string }>
  }): Promise<{ content: string }>
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface GoalVerificationResult {
  satisfied: boolean
  confidence: number
  gap?: string
  evidence?: string
  impossible: boolean
  impossible_reason?: string
  suggestions?: string[]
}

export interface GoalContext {
  goal: string
  stopConditions?: string[]
  conversationSummary: string
  dagProgress: {
    total: number
    completed: number
    failed: number
    pending: number
  }
  sessionId: string
  retryCount: number
}

export interface GoalVerifierConfig {
  maxRetries: number
  temperature: number
  maxTokens: number
  model?: string
}

export const DEFAULT_GOAL_VERIFIER_CONFIG: GoalVerifierConfig = {
  maxRetries: 3,
  temperature: 0.1,
  maxTokens: 2000,
}

// ── Prompt ─────────────────────────────────────────────────────────────────

const VERIFICATION_SYSTEM_PROMPT = `You are an impartial Goal Verification Agent. Your job is to determine whether an AI agent has actually completed the task the user requested.

## Rules
1. Be SKEPTICAL — the agent may claim "done" when it hasn't truly finished
2. Compare the original user goal against actual evidence in the conversation
3. Look for: missing files, unimplemented features, unsolved bugs, incomplete analysis
4. If the goal is ambiguous, err on the side of asking for clarification
5. Consider both explicit AND implicit requirements in the goal

## Output Format (JSON only)
{
  "satisfied": boolean,
  "confidence": number (0-1),
  "evidence": "summary of what was accomplished" (if satisfied),
  "gap": "what is still missing" (if not satisfied),
  "impossible": boolean,
  "impossible_reason": "why it cannot be done" (if impossible),
  "suggestions": ["specific", "next", "steps"] (if not satisfied)
}

## Important
- Only mark "impossible: true" if the goal truly cannot be achieved
- If the work is partially done, set satisfied=false and describe the gap
- Confidence should reflect how certain you are of your verdict`

// ── GoalVerifier ───────────────────────────────────────────────────────────

export class GoalVerifier {
  readonly config: GoalVerifierConfig
  private provider: ProviderAdapter | null = null

  constructor(config?: Partial<GoalVerifierConfig>) {
    this.config = { ...DEFAULT_GOAL_VERIFIER_CONFIG, ...config }
  }

  setProvider(provider: ProviderAdapter): void {
    this.provider = provider
  }

  /**
   * Verify whether the agent has completed the user's goal.
   * Called when DAG is complete and all nodes succeeded.
   */
  async verify(context: GoalContext): Promise<GoalVerificationResult> {
    // Dead-loop protection: force exit after max retries
    if (context.retryCount >= this.config.maxRetries) {
      return {
        satisfied: true,
        confidence: 0.5,
        evidence: `Forced completion after ${this.config.maxRetries} verification attempts (dead-loop protection).`,
        impossible: false,
        suggestions: ["Review the work manually to confirm completion"],
      }
    }

    if (this.provider) {
      return this.llmVerify(context)
    }

    return this.heuristicVerify(context)
  }

  // ── LLM Verification ──────────────────────────────────────────────────

  private async llmVerify(context: GoalContext): Promise<GoalVerificationResult> {
    const userPrompt = this.buildVerificationPrompt(context)

    try {
      const response = await this.provider!.chat({
        messages: [
          { role: "system", content: VERIFICATION_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      })

      return this.parseVerificationResponse(response.content, context)
    } catch {
      return this.heuristicVerify(context)
    }
  }

  // ── Heuristic Fallback ───────────────────────────────────────────────

  private heuristicVerify(context: GoalContext): GoalVerificationResult {
    const { dagProgress } = context
    const total = dagProgress.total
    const completed = dagProgress.completed
    const failed = dagProgress.failed

    if (total === 0) {
      return {
        satisfied: false,
        confidence: 0.3,
        gap: "No tasks were defined in the DAG.",
        impossible: false,
        suggestions: ["Define and execute concrete tasks"],
      }
    }

    const completionRatio = completed / total
    const failureRatio = failed / total

    if (completionRatio >= 1.0 && failureRatio === 0) {
      return {
        satisfied: true,
        confidence: 0.8,
        evidence: `All ${total} DAG nodes completed successfully.`,
        impossible: false,
      }
    }

    if (completionRatio >= 0.9 && failureRatio <= 0.1) {
      return {
        satisfied: true,
        confidence: 0.6,
        evidence: `${completed}/${total} nodes completed (${failed} failed).`,
        impossible: false,
        suggestions: ["Review the failed nodes to ensure they're non-critical"],
      }
    }

    if (completionRatio >= 0.5) {
      return {
        satisfied: false,
        confidence: 0.7,
        gap: `${total - completed - failed} nodes remain pending, ${failed} failed.`,
        impossible: false,
        suggestions: ["Complete remaining nodes", "Address failed nodes"],
      }
    }

    return {
      satisfied: false,
      confidence: 0.9,
      gap: `Only ${completed}/${total} nodes completed.`,
      impossible: false,
      suggestions: ["Substantial work remains — continue execution"],
    }
  }

  // ── Prompt Building ──────────────────────────────────────────────────

  private buildVerificationPrompt(context: GoalContext): string {
    const parts: string[] = []

    parts.push("## Original User Goal")
    parts.push(context.goal)

    if (context.stopConditions && context.stopConditions.length > 0) {
      parts.push("\n## User Stop Conditions")
      for (const cond of context.stopConditions) {
        parts.push(`- ${cond}`)
      }
    }

    parts.push("\n## DAG Progress")
    parts.push(`- Total nodes: ${context.dagProgress.total}`)
    parts.push(`- Completed: ${context.dagProgress.completed}`)
    parts.push(`- Failed: ${context.dagProgress.failed}`)
    parts.push(`- Pending: ${context.dagProgress.pending}`)

    parts.push(`\n## Verification Attempt\nThis is attempt ${context.retryCount + 1} of ${this.config.maxRetries}.`)

    parts.push("\n## Conversation Summary")
    parts.push(context.conversationSummary)

    parts.push("\n---")
    parts.push("Based on the above, determine if the user's goal has been FULLY satisfied.")
    parts.push("Respond with the JSON verdict as specified.")

    return parts.join("\n")
  }

  // ── Response Parsing ─────────────────────────────────────────────────

  private parseVerificationResponse(text: string, context: GoalContext): GoalVerificationResult {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return this.heuristicVerify(context)
    }

    try {
      const parsed = JSON.parse(jsonMatch[0])

      return {
        satisfied: Boolean(parsed.satisfied),
        confidence: clampConfidence(Number(parsed.confidence) || 0.5),
        evidence: parsed.evidence ?? undefined,
        gap: parsed.gap ?? undefined,
        impossible: Boolean(parsed.impossible),
        impossible_reason: parsed.impossible_reason ?? undefined,
        suggestions: Array.isArray(parsed.suggestions) ? (parsed.suggestions as unknown[]).map(String) : undefined,
      }
    } catch {
      return this.heuristicVerify(context)
    }
  }
}

function clampConfidence(value: number): number {
  if (Number.isNaN(value)) return 0.5
  return Math.max(0, Math.min(1, value))
}

/**
 * Create a {@link GoalVerifier} instance.
 *
 * @param args - Constructor arguments forwarded to {@link GoalVerifier}.
 * @returns A new {@link GoalVerifier}.
 */
export function createGoalVerifier(...args: ConstructorParameters<typeof GoalVerifier>): GoalVerifier {
  return new GoalVerifier(...args)
}
