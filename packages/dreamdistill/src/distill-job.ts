/**
 * DistillJob — 30-Day Workflow Crystallization
 *
 * Analyze historical sessions for recurring patterns, crystallize into
 * reusable artifacts: skills, CLI commands, agent definitions, and SOPs.
 *
 * @module dreamdistill/distill-job
 */

import { writeFile, mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import type {
  ProviderAdapter,
  IProjectMemory,
  IEventArchiver,
  ISkillRegistrar,
  EventRow,
  DistillConfig,
  SessionPattern,
  DistilledArtifact,
  DistillResult,
  DistillMetrics,
} from "./types"
import { DEFAULT_DISTILL_CONFIG } from "./types"

export class DistillJob {
  readonly config: DistillConfig
  private eventArchiver: IEventArchiver | null = null
  private projectMemory: IProjectMemory | null = null
  private skillRegistrar: ISkillRegistrar | null = null
  private provider: ProviderAdapter | null = null
  private metrics: DistillMetrics = {
    lastDistillAt: null,
    totalDistills: 0,
    totalArtifactsGenerated: 0,
    totalPatternsFound: 0,
  }
  private lastCheckTime = 0
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(config?: Partial<DistillConfig>) {
    this.config = { ...DEFAULT_DISTILL_CONFIG, ...config }
  }

  /** Wire dependencies */
  setEventArchiver(archiver: IEventArchiver): void {
    this.eventArchiver = archiver
  }

  setProjectMemory(pm: IProjectMemory): void {
    this.projectMemory = pm
  }

  setSkillRegistrar(registrar: ISkillRegistrar): void {
    this.skillRegistrar = registrar
  }

  setProvider(provider: ProviderAdapter): void {
    this.provider = provider
  }

  // ── Trigger ────────────────────────────────────────────────────────────

  async shouldDistill(sessionCount: number): Promise<boolean> {
    const now = Date.now()
    const elapsed = now - this.lastCheckTime
    if (elapsed < this.config.intervalMs) return false

    this.lastCheckTime = now
    return sessionCount >= this.config.minSessions
  }

  // ── Distill ────────────────────────────────────────────────────────────

  async distill(sessionIds: string[]): Promise<DistillResult> {
    const startTime = Date.now()

    if (!this.eventArchiver) {
      throw new Error("DistillJob: EventArchiver not configured")
    }

    const sessionsToAnalyze = sessionIds.slice(0, this.config.maxSessionsToAnalyze)

    // Phase 1: Extract patterns from session history
    const patterns =
      this.config.useLLM && this.provider
        ? await this.llmPatternRecognition(sessionsToAnalyze)
        : await this.heuristicPatternRecognition(sessionsToAnalyze)

    // Phase 2: Generate artifacts from patterns
    const artifacts = await this.generateArtifacts(patterns)

    // Phase 3: Write artifacts to filesystem
    await this.writeArtifacts(artifacts)

    // Phase 4: Register skills if registrar available
    if (this.skillRegistrar) {
      for (const artifact of artifacts) {
        if (artifact.type === "skill" && !this.skillRegistrar.hasSkill(artifact.name)) {
          try {
            await this.skillRegistrar.registerSkill(
              artifact.name,
              artifact.content,
              "distilled",
            )
          } catch {
            // Registration is best-effort
          }
        }
      }
    }

    const durationMs = Date.now() - startTime

    this.metrics.lastDistillAt = new Date().toISOString()
    this.metrics.totalDistills++
    this.metrics.totalPatternsFound += patterns.length
    this.metrics.totalArtifactsGenerated += artifacts.length

    return {
      sessionsAnalyzed: sessionsToAnalyze.length,
      patternsFound: patterns,
      artifactsGenerated: artifacts,
      durationMs,
      performedAt: new Date().toISOString(),
    }
  }

  // ── Pattern Recognition ───────────────────────────────────────────────

  private async heuristicPatternRecognition(sessionIds: string[]): Promise<SessionPattern[]> {
    const patterns: SessionPattern[] = []
    const eventCounts = new Map<string, Map<string, number>>()

    for (const sid of sessionIds) {
      const counts = new Map<string, number>()
      // Query events per session from archiver (limited for performance)
      const events: EventRow[] = this.eventArchiver
        ? await this.eventArchiver.queryEvents(sid, 200)
        : []
      for (const event of events) {
        counts.set(event.event_type, (counts.get(event.event_type) ?? 0) + 1)
      }
      eventCounts.set(sid, counts)
    }

    // Cluster sessions by dominant event type
    const clusters = new Map<string, string[]>()
    for (const [sid, counts] of eventCounts) {
      if (counts.size === 0) continue
      const entries = [...counts.entries()]
      if (entries.length === 0) continue
      const dominant = entries.sort((a, b) => b[1] - a[1])[0]![0]
      const cluster = clusters.get(dominant) ?? []
      cluster.push(sid)
      clusters.set(dominant, cluster)
    }

    for (const [eventType, sessions] of clusters) {
      if (sessions.length < 3) continue

      patterns.push({
        name: `pattern_${eventType.toLowerCase().replace(/\s+/g, "_")}`,
        description: `Sessions primarily involving ${eventType} operations`,
        frequency: sessions.length,
        matchedSessions: sessions,
        taskSequence: [
          "Initialize workspace",
          `Perform ${eventType.toLowerCase()} operations`,
          "Validate results",
          "Clean up",
        ],
        typicalDuration: { min: 60000, max: 3600000, avg: 600000 },
        commonCapabilities: [eventType.toLowerCase()],
      })
    }

    return patterns
  }

  private async llmPatternRecognition(sessionIds: string[]): Promise<SessionPattern[]> {
    if (!this.provider) return this.heuristicPatternRecognition(sessionIds)

    try {
      const sessionSummaries = sessionIds.map((sid) => `- Session ${sid}`).join("\n")

      const response = await this.provider.chat({
        messages: [
          {
            role: "system",
            content: `You are a workflow pattern analyst. Analyze session histories and identify recurring patterns that could be automated.

## Output Format (JSON only)
{
  "patterns": [
    {
      "name": "pattern_name",
      "description": "what this pattern represents",
      "frequency": 5,
      "taskSequence": ["step 1", "step 2", "step 3"],
      "commonCapabilities": ["cap1", "cap2"],
      "suggestedAutomation": "how to automate this pattern"
    }
  ]
}

## Rules
- Only identify patterns that appear in 3+ sessions
- Focus on patterns that could be automated as skills, CLI commands, or agent definitions
- Be specific about the task sequence`,
          },
          {
            role: "user",
            content: `Analyze these sessions for recurring patterns:\n${sessionSummaries}\n\nIdentify up to 5 automation-worthy patterns.`,
          },
        ],
      })

      const jsonMatch = response.content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        if (Array.isArray(parsed.patterns)) {
          return parsed.patterns.map(
            (p: Record<string, unknown>, i: number): SessionPattern => ({
              name: String(p.name ?? `pattern_${i}`),
              description: String(p.description ?? ""),
              frequency: Number(p.frequency) || sessionIds.length,
              matchedSessions: sessionIds,
              taskSequence: Array.isArray(p.taskSequence)
                ? (p.taskSequence as unknown[]).map(String)
                : [],
              typicalDuration: { min: 60000, max: 3600000, avg: 600000 },
              commonCapabilities: Array.isArray(p.commonCapabilities)
                ? (p.commonCapabilities as unknown[]).map(String)
                : [],
            }),
          )
        }
      }
    } catch {
      // Fall back to heuristic
    }

    return this.heuristicPatternRecognition(sessionIds)
  }

  // ── Artifact Generation ────────────────────────────────────────────────

  private async generateArtifacts(patterns: SessionPattern[]): Promise<DistilledArtifact[]> {
    const artifacts: DistilledArtifact[] = []

    for (const pattern of patterns) {
      const skillArtifact = this.generateSkillArtifact(pattern)
      if (skillArtifact) artifacts.push(skillArtifact)

      if (pattern.frequency >= 5) {
        const cmdArtifact = this.generateCommandArtifact(pattern)
        if (cmdArtifact) artifacts.push(cmdArtifact)
      }

      if (pattern.taskSequence.length >= 4) {
        const agentArtifact = this.generateAgentArtifact(pattern)
        if (agentArtifact) artifacts.push(agentArtifact)
      }

      if (pattern.taskSequence.length >= 5 && pattern.frequency >= 7) {
        const sopArtifact = this.generateSOPArtifact(pattern)
        if (sopArtifact) artifacts.push(sopArtifact)
      }
    }

    return artifacts
  }

  private generateSkillArtifact(pattern: SessionPattern): DistilledArtifact | null {
    if (pattern.taskSequence.length === 0) return null

    const name = pattern.name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase()

    const content = [
      `# ${pattern.name}`,
      ``,
      `> Auto-generated skill from DistillJob — ${new Date().toISOString()}`,
      ``,
      `## Description`,
      pattern.description,
      ``,
      `## Frequency`,
      `Observed in ${pattern.frequency} sessions.`,
      ``,
      `## Task Sequence`,
      ...pattern.taskSequence.map((s, i) => `${i + 1}. ${s}`),
      ``,
      `## Common Capabilities`,
      ...pattern.commonCapabilities.map((c) => `- ${c}`),
      ``,
      `## Usage`,
      `This skill automates the following workflow:`,
      `\`\`\``,
      pattern.taskSequence.join(" → "),
      `\`\`\``,
    ].join("\n")

    return {
      type: "skill",
      name,
      description: pattern.description,
      content,
      filePath: join(this.config.outputDir, "skills", `${name}.md`),
    }
  }

  private generateCommandArtifact(pattern: SessionPattern): DistilledArtifact | null {
    const name = pattern.name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase()

    const content = [
      `#!/usr/bin/env bun`,
      `/**`,
      ` * CLI Command: ${pattern.name}`,
      ` * Auto-generated from DistillJob — ${new Date().toISOString()}`,
      ` *`,
      ` * ${pattern.description}`,
      ` * Frequency: ${pattern.frequency} sessions`,
      ` */`,
      ``,
      `const steps = ${JSON.stringify(pattern.taskSequence, null, 2)};`,
      ``,
      `async function main() {`,
      `  console.log("Running: ${pattern.name}");`,
      `  console.log("Steps:", steps.join(" → "));`,
      `  `,
      `  for (let i = 0; i < steps.length; i++) {`,
      `    console.log(\`Step \${i + 1}/\${steps.length}: \${steps[i]}\`);`,
      `    // TODO: Implement step logic`,
      `  }`,
      `  `,
      `  console.log("Done.");`,
      `}`,
      ``,
      `main().catch(console.error);`,
    ].join("\n")

    return {
      type: "command",
      name,
      description: pattern.description,
      content,
      filePath: join(this.config.outputDir, "commands", `${name}.ts`),
    }
  }

  private generateAgentArtifact(pattern: SessionPattern): DistilledArtifact | null {
    const name = pattern.name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase()

    const content = [
      `# Agent: ${pattern.name}`,
      ``,
      `> Auto-generated agent definition from DistillJob`,
      ``,
      `## Role`,
      `Specialized agent for: ${pattern.description}`,
      ``,
      `## Capabilities`,
      ...pattern.commonCapabilities.map((c) => `- ${c}`),
      ``,
      `## Workflow`,
      ...pattern.taskSequence.map((s, i) => `${i + 1}. ${s}`),
      ``,
      `## Configuration`,
      `\`\`\`json`,
      JSON.stringify(
        {
          name: pattern.name,
          description: pattern.description,
          capabilities: pattern.commonCapabilities,
          workflow: pattern.taskSequence,
        },
        null,
        2,
      ),
      `\`\`\``,
    ].join("\n")

    return {
      type: "agent",
      name,
      description: pattern.description,
      content,
      filePath: join(this.config.outputDir, "agents", `${name}.md`),
    }
  }

  private generateSOPArtifact(pattern: SessionPattern): DistilledArtifact | null {
    const name = pattern.name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase()

    const content = [
      `# Standard Operating Procedure: ${pattern.name}`,
      ``,
      `> Auto-generated SOP from DistillJob — ${new Date().toISOString()}`,
      ``,
      `## Purpose`,
      pattern.description,
      ``,
      `## Prerequisites`,
      ...pattern.commonCapabilities.map((c) => `- ${c}`),
      ``,
      `## Procedure`,
      ...pattern.taskSequence.map((s, i) => {
        const next = pattern.taskSequence[i + 1]
        return `### Step ${i + 1}: ${s}\n\n**Expected Outcome**: Complete successfully.\n${next ? `**Next**: ${next}` : "**Next**: Done."}\n`
      }),
      ``,
      `## Verification`,
      `After completing all steps, verify:`,
      ...pattern.taskSequence.map((s) => `- [ ] ${s} completed successfully`),
      ``,
      `## Frequency`,
      `This procedure was observed in ${pattern.frequency} historical sessions.`,
    ].join("\n")

    return {
      type: "sop",
      name,
      description: pattern.description,
      content,
      filePath: join(this.config.outputDir, "sop", `${name}.md`),
    }
  }

  // ── Persistence ────────────────────────────────────────────────────────

  private async writeArtifacts(artifacts: DistilledArtifact[]): Promise<void> {
    for (const artifact of artifacts) {
      const dir = dirname(artifact.filePath)
      await mkdir(dir, { recursive: true })
      await writeFile(artifact.filePath, artifact.content, "utf-8")
    }
  }

  // ── Timer Management ───────────────────────────────────────────────────

  startTimer(sessionCounter: () => number): void {
    if (this.timer) return
    this.timer = setInterval(async () => {
      try {
        if (await this.shouldDistill(sessionCounter())) {
          await this.distill([])
        }
      } catch (err) {
        console.error("[DistillJob] Distill cycle failed:", err)
      }
    }, 6 * 60 * 60 * 1000) // Check every 6 hours
  }

  stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  getMetrics(): DistillMetrics {
    return { ...this.metrics }
  }
}
