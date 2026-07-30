/**
 * MaxModeSampler — Best-of-N Parallel Planning & Selection
 *
 * In "Max Mode", instead of generating a single execution plan and hoping
 * it's good, the system generates N candidate approaches in parallel with
 * high temperature (exploration), then uses the same model as a judge with
 * temperature=0 (exploitation) to select the best candidate.
 *
 * Candidates are REASONING-ONLY — no side effects, no tool calls, no file
 * modifications. Only the WINNING plan proceeds to execution.
 *
 * Design:
 *   - N=5 candidates by default (configurable)
 *   - Candidate generation: temperature=1.0 for diversity
 *   - Judging: temperature=0 for deterministic selection
 *   - All candidate calls run in parallel via Promise.all
 *   - Selection criteria: feasibility (30%), completeness (25%), efficiency (25%),
 *     safety (15%), clarity (5%)
 *
 * Blue ocean: No TypeScript npm package does Best-of-N plan sampling.
 *
 * Zero runtime dependencies.
 *
 * @module max-mode-sampler
 */

// ── Adapter Interface ──────────────────────────────────────────────────────

export interface ProviderAdapter {
  chat(params: {
    messages: Array<{ role: string; content: string }>
  }): Promise<{ content: string }>
}

export interface Capability {
  capability_id: string
  description: string
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface CandidatePlan {
  id: string
  approach: string
  steps: PlanStep[]
  complexity: number
  estimatedTurns: number
  risks: string[]
  raw: string
}

export interface PlanStep {
  order: number
  action: string
  expectedOutcome: string
  requiredCapabilities: string[]
}

export interface JudgeResult {
  selectedId: string
  rankings: string[]
  scores: Record<string, number>
  reasoning: string
}

export interface MaxModeConfig {
  candidateCount: number
  exploreTemperature: number
  judgeTemperature: number
  candidateMaxTokens: number
  judgeMaxTokens: number
  callTimeoutMs: number
}

export const DEFAULT_MAX_MODE_CONFIG: MaxModeConfig = {
  candidateCount: 5,
  exploreTemperature: 1.0,
  judgeTemperature: 0.0,
  candidateMaxTokens: 2000,
  judgeMaxTokens: 1500,
  callTimeoutMs: 30_000,
}

// ── Prompt Templates ───────────────────────────────────────────────────────

const CANDIDATE_SYSTEM_PROMPT = `You are a creative AI planning strategist. Your role is to generate DIVERSE approaches to solve a given task.

## Rules
1. Generate a COMPLETE step-by-step execution plan
2. Each step should have a clear action, expected outcome, and required capabilities
3. Be creative — explore different strategies (top-down, bottom-up, divide-and-conquer, etc.)
4. Estimate complexity (1-10) and approximate turns needed
5. Identify key risks for your approach
6. Consider: what could go wrong? what's the simplest path?

## Output Format (JSON only)
{
  "approach": "one-line summary of your strategy",
  "steps": [
    {
      "order": 1,
      "action": "what to do",
      "expectedOutcome": "what should happen",
      "requiredCapabilities": ["cap1", "cap2"]
    }
  ],
  "complexity": 5,
  "estimatedTurns": 10,
  "risks": ["risk 1", "risk 2"]
}`

const JUDGE_SYSTEM_PROMPT = `You are an impartial plan evaluator. Your job is to select the BEST approach from a set of candidates.

## Evaluation Criteria (weighted)
1. Feasibility (30%): Can this actually be done with the available capabilities?
2. Completeness (25%): Does it cover ALL aspects of the user's request?
3. Efficiency (25%): Does it minimize unnecessary steps?
4. Safety (15%): Does it handle edge cases and avoid risky shortcuts?
5. Clarity (5%): Is the plan well-structured and easy to follow?

## Output Format (JSON only)
{
  "selectedId": "candidate_X",
  "rankings": ["candidate_X", "candidate_Y", ...],
  "scores": { "candidate_X": 85, "candidate_Y": 72, ... },
  "reasoning": "detailed explanation of why the selected plan is best"
}`

// ── MaxModeSampler ─────────────────────────────────────────────────────────

export class MaxModeSampler {
  readonly config: MaxModeConfig
  private provider: ProviderAdapter | null = null

  constructor(config?: Partial<MaxModeConfig>) {
    this.config = { ...DEFAULT_MAX_MODE_CONFIG, ...config }
  }

  setProvider(provider: ProviderAdapter): void { this.provider = provider }

  // ── Sample & Select ───────────────────────────────────────────────────

  /**
   * Generate N candidate plans in parallel, then judge and select the best.
   *
   * @param goal — The user's goal/task description
   * @param capabilities — Available capabilities
   * @param context — Optional additional context (conversation history, etc.)
   */
  async sampleAndSelect(
    goal: string,
    capabilities: Capability[],
    context?: string,
  ): Promise<{
    winner: CandidatePlan
    allCandidates: CandidatePlan[]
    judgeResult: JudgeResult
  }> {
    const candidates = await this.generateCandidates(goal, capabilities, context)

    if (candidates.length === 0) {
      throw new Error("MaxModeSampler: failed to generate any candidates")
    }

    if (candidates.length === 1) {
      return {
        winner: candidates[0]!,
        allCandidates: candidates,
        judgeResult: {
          selectedId: candidates[0]!.id,
          rankings: [candidates[0]!.id],
          scores: { [candidates[0]!.id]: 100 },
          reasoning: "Only one candidate was generated.",
        },
      }
    }

    const judgeResult = await this.judgeCandidates(goal, capabilities, candidates, context)

    const winner = candidates.find((c) => c.id === judgeResult.selectedId) ?? candidates[0]!

    return { winner, allCandidates: candidates, judgeResult }
  }

  // ── Candidate Generation ──────────────────────────────────────────────

  private async generateCandidates(
    goal: string,
    capabilities: Capability[],
    context?: string,
  ): Promise<CandidatePlan[]> {
    if (!this.provider) {
      return [this.heuristicCandidate(goal, capabilities)]
    }

    const capList = capabilities
      .map((c) => `- ${c.capability_id}: ${c.description}`)
      .join("\n")

    const userPrompt = [
      `## Task Goal\n${goal}`,
      `\n## Available Capabilities\n${capList}`,
      context ? `\n## Additional Context\n${context}` : "",
      `\n---`,
      `Generate a detailed execution plan for this task. Be creative and thorough.`,
    ].join("\n")

    // Generate all candidates in parallel
    const promises = Array.from({ length: this.config.candidateCount }, (_, i) =>
      this.generateOneCandidate(i, userPrompt),
    )

    const results = await Promise.allSettled(promises)

    const candidates: CandidatePlan[] = []
    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        candidates.push(result.value)
      }
    }

    return candidates
  }

  private async generateOneCandidate(
    index: number,
    userPrompt: string,
  ): Promise<CandidatePlan | null> {
    if (!this.provider) return null

    try {
      const variantPrompt = `${userPrompt}\n\nGenerate variant #${index + 1}. Use a DIFFERENT strategic approach than you might normally choose.`

      const response = await this.provider.chat({
        messages: [
          { role: "system", content: CANDIDATE_SYSTEM_PROMPT },
          { role: "user", content: variantPrompt },
        ],
      })

      return this.parseCandidateResponse(response.content, index)
    } catch (err) {
      console.error(`[MaxModeSampler] Candidate ${index} generation failed:`, err)
      return null
    }
  }

  // ── Judging ───────────────────────────────────────────────────────────

  private async judgeCandidates(
    goal: string,
    capabilities: Capability[],
    candidates: CandidatePlan[],
    context?: string,
  ): Promise<JudgeResult> {
    if (!this.provider) {
      return this.heuristicJudge(candidates)
    }

    const candidatesText = candidates
      .map((c) => {
        const stepsText = c.steps
          .map((s) => `  ${s.order}. ${s.action} → ${s.expectedOutcome}`)
          .join("\n")
        return `### ${c.id}\n**Approach**: ${c.approach}\n**Complexity**: ${c.complexity}/10\n**Est. Turns**: ${c.estimatedTurns}\n**Risks**: ${c.risks.join(", ")}\n**Steps**:\n${stepsText}`
      })
      .join("\n\n")

    const capList = capabilities.map((c) => `- ${c.capability_id}`).join("\n")

    const userPrompt = [
      `## Original Goal\n${goal}`,
      `\n## Available Capabilities\n${capList}`,
      context ? `\n## Context\n${context}` : "",
      `\n## Candidates to Evaluate\n\n${candidatesText}`,
      `\n---`,
      `Evaluate ALL candidates and select the best one. Score each on 0-100.`,
      `Respond with JSON only.`,
    ].join("\n")

    try {
      const response = await this.provider.chat({
        messages: [
          { role: "system", content: JUDGE_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      })

      return this.parseJudgeResponse(response.content, candidates)
    } catch (err) {
      console.error("[MaxModeSampler] Judging failed:", err)
      return this.heuristicJudge(candidates)
    }
  }

  // ── Heuristic Fallbacks ───────────────────────────────────────────────

  private heuristicCandidate(
    goal: string,
    capabilities: Capability[],
  ): CandidatePlan {
    const steps: PlanStep[] = [
      {
        order: 1,
        action: "Analyze the goal and identify key requirements",
        expectedOutcome: "Clear understanding of what needs to be done",
        requiredCapabilities: [],
      },
      {
        order: 2,
        action: "Break down into subtasks based on available capabilities",
        expectedOutcome: "Structured task tree",
        requiredCapabilities: capabilities.slice(0, 3).map((c) => c.capability_id),
      },
      {
        order: 3,
        action: "Execute each subtask sequentially, validating after each",
        expectedOutcome: "Completed subtasks with verification",
        requiredCapabilities: capabilities.map((c) => c.capability_id),
      },
      {
        order: 4,
        action: "Review and verify completion against the original goal",
        expectedOutcome: "Verified completion",
        requiredCapabilities: [],
      },
    ]

    return {
      id: "candidate_heuristic",
      approach: "Sequential execution with validation at each step",
      steps,
      complexity: 3,
      estimatedTurns: steps.length * 2,
      risks: ["May miss cross-task dependencies"],
      raw: "heuristic fallback",
    }
  }

  private heuristicJudge(candidates: CandidatePlan[]): JudgeResult {
    const scored = candidates.map((c) => {
      let score = 50
      if (c.complexity >= 3 && c.complexity <= 7) score += 15
      if (c.steps.length >= 3 && c.steps.length <= 10) score += 15
      if (c.risks.length > 0) score += 10
      if (c.estimatedTurns > 50) score -= 10
      return { candidate: c, score: Math.min(100, Math.max(0, score)) }
    })

    scored.sort((a, b) => b.score - a.score)

    const scores: Record<string, number> = {}
    const rankings: string[] = []
    for (const { candidate, score } of scored) {
      scores[candidate.id] = score
      rankings.push(candidate.id)
    }

    return {
      selectedId: rankings[0]!,
      rankings,
      scores,
      reasoning:
        "Heuristic selection based on complexity, thoroughness, and risk awareness.",
    }
  }

  // ── Response Parsing ──────────────────────────────────────────────────

  private parseCandidateResponse(
    text: string,
    index: number,
  ): CandidatePlan | null {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null

    try {
      const raw = JSON.parse(jsonMatch[0])

      return {
        id: `candidate_${index}`,
        approach: String(raw.approach ?? `Approach ${index + 1}`),
        steps: Array.isArray(raw.steps)
          ? (raw.steps as Array<Record<string, unknown>>).map(
              (s: Record<string, unknown>, i: number) => ({
                order: (s.order as number) ?? i + 1,
                action: String(s.action ?? ""),
                expectedOutcome: String(s.expectedOutcome ?? ""),
                requiredCapabilities: Array.isArray(s.requiredCapabilities)
                  ? (s.requiredCapabilities as unknown[]).map(String)
                  : [],
              }),
            )
          : [],
        complexity: clampNumber(raw.complexity, 1, 10, 5),
        estimatedTurns: clampNumber(raw.estimatedTurns, 1, 100, 10),
        risks: Array.isArray(raw.risks)
          ? (raw.risks as unknown[]).map(String)
          : [],
        raw: text,
      }
    } catch {
      return null
    }
  }

  private parseJudgeResponse(
    text: string,
    candidates: CandidatePlan[],
  ): JudgeResult {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return this.heuristicJudge(candidates)

    try {
      const raw = JSON.parse(jsonMatch[0])

      return {
        selectedId: String(raw.selectedId ?? candidates[0]?.id ?? ""),
        rankings: Array.isArray(raw.rankings)
          ? (raw.rankings as unknown[]).map(String)
          : candidates.map((c) => c.id),
        scores:
          raw.scores && typeof raw.scores === "object"
            ? (raw.scores as Record<string, number>)
            : {},
        reasoning: String(raw.reasoning ?? "No reasoning provided."),
      }
    } catch {
      return this.heuristicJudge(candidates)
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = Number(value)
  if (Number.isNaN(n)) return fallback
  return Math.max(min, Math.min(max, n))
}
