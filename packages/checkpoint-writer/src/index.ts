/**
 * CheckpointWriter — LLM-Driven 11-Field Structured State Extraction
 *
 * An independent LLM subagent that extracts structured state from the full
 * conversation history at each cycle checkpoint. It does NOT share the main
 * agent's attention or token budget.
 *
 * Output: 11-field structured checkpoint written to JSON + Markdown files.
 * Promotes stable facts (3+ appearances) to Project Memory.
 *
 * 11 Fields:
 *   1. current_intent        — What the agent is currently trying to accomplish
 *   2. next_action           — The immediate next step(s)
 *   3. working_constraints   — Constraints the agent must respect
 *   4. task_tree             — Hierarchical breakdown of remaining work
 *   5. current_work          — What was just done (last few turns)
 *   6. involved_files        — Files touched, with summaries
 *   7. cross_task_discoveries — Insights applicable across tasks
 *   8. errors_and_fixes      — Errors encountered and how they were resolved
 *   9. runtime_state         — Environment state (git hash, ports, etc.)
 *  10. design_decisions      — Architectural decisions, with rationale
 *  11. miscellaneous_notes   — Anything that doesn't fit above
 *
 * Zero runtime dependencies — only Node.js built-in `node:fs/promises`.
 *
 * @module checkpoint-writer
 */

import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

// ── Minimal LLM Provider Interface ────────────────────────────────────────

/** Minimal chat-based LLM adapter — implement with OpenAI, Anthropic, etc. */
export interface ProviderAdapter {
  chat(params: {
    messages: Array<{ role: string; content: string }>
  }): Promise<{ content: string }>
}

// ── 11-Field Checkpoint Types ─────────────────────────────────────────────

export interface StructuredCheckpoint {
  version: number
  cycle_index: number
  session_id: string
  created_at: string
  is_incremental: boolean
  fields: CheckpointFields
}

export interface CheckpointFields {
  current_intent: string
  next_action: string
  working_constraints: string[]
  task_tree: TaskTreeNode[]
  current_work: RecentTurn[]
  involved_files: InvolvedFile[]
  cross_task_discoveries: Discovery[]
  errors_and_fixes: ErrorFix[]
  runtime_state: RuntimeState
  design_decisions: DesignDecision[]
  miscellaneous_notes: string[]
}

export interface TaskTreeNode {
  id: string
  description: string
  status: "pending" | "in_progress" | "done" | "blocked"
  children: TaskTreeNode[]
}

export interface RecentTurn {
  turn_number: number
  action: string
  result_summary: string
  files_changed: string[]
}

export interface InvolvedFile {
  path: string
  role: "read" | "modified" | "created" | "deleted"
  summary: string
  key_changes?: string
}

export interface Discovery {
  id: string
  description: string
  confidence: number
  applicable_to: string[]
}

export interface ErrorFix {
  error_summary: string
  root_cause: string
  fix_applied: string
  verified: boolean
}

export interface RuntimeState {
  git_head?: string
  active_ports?: number[]
  environment_vars?: Record<string, string>
  current_branch?: string
  workspace_hash?: string
}

export interface DesignDecision {
  id: string
  decision: string
  rationale: string
  alternatives_considered: string[]
  timestamp: string
}

// ── Project Memory Writer Interface ───────────────────────────────────────

export interface IProjectMemoryWriter {
  promoteFact(sessionId: string, discovery: Discovery, stabilityCount: number): Promise<void>
}

// ── Config ─────────────────────────────────────────────────────────────────

export interface WriterConfig {
  systemPrompt: string
  maxTokens: number
  temperature: number
  outputDir: string
  persistToDB: boolean
  maxConversationChars: number
}

export const DEFAULT_WRITER_CONFIG: WriterConfig = {
  systemPrompt: `You are a checkpoint writer for an AI coding agent. Your job is to extract structured state from the conversation history.

Read the full conversation and produce a JSON object with these 11 fields. Be concise — each field should capture the essential information without repetition.

1. "current_intent": What the agent is currently trying to accomplish (1-2 sentences)
2. "next_action": The immediate next step(s) the agent should take (1-2 sentences)
3. "working_constraints": Array of constraints/rules the agent must respect
4. "task_tree": Hierarchical breakdown of remaining work [{id, description, status, children}]
5. "current_work": Recent turns with actions and results [{turn_number, action, result_summary, files_changed}]
6. "involved_files": Files touched with summaries [{path, role, summary}]
7. "cross_task_discoveries": Insights applicable across tasks [{id, description, confidence, applicable_to}]
8. "errors_and_fixes": Errors and how they were resolved [{error_summary, root_cause, fix_applied, verified}]
9. "runtime_state": Environment state {git_head, active_ports, current_branch, workspace_hash}
10. "design_decisions": Architectural decisions with rationale [{id, decision, rationale, alternatives_considered, timestamp}]
11. "miscellaneous_notes": Anything that doesn't fit above

Output ONLY valid JSON, no explanation outside the JSON object.`,

  maxTokens: 4096,
  temperature: 0.2,
  outputDir: ".fengru/checkpoints",
  persistToDB: true,
  maxConversationChars: 16000,
}

// ── CheckpointWriter ──────────────────────────────────────────────────────

export class CheckpointWriter {
  readonly config: WriterConfig
  private provider: ProviderAdapter | null = null
  private projectMemory: IProjectMemoryWriter | null = null
  private previousCheckpoint: StructuredCheckpoint | null = null
  private discoveryStability = new Map<string, number>()

  constructor(config?: Partial<WriterConfig>) {
    this.config = { ...DEFAULT_WRITER_CONFIG, ...config }
  }

  setProvider(provider: ProviderAdapter): void {
    this.provider = provider
  }
  setProjectMemoryWriter(writer: IProjectMemoryWriter): void {
    this.projectMemory = writer
  }

  // ── Write ──────────────────────────────────────────────────────────────

  /**
   * Write a structured checkpoint by calling the LLM to extract state from
   * the conversation history.
   *
   * @param sessionId — Current session ID
   * @param conversationHistory — Full or recent conversation turns
   * @param isIncremental — Whether to do incremental update
   * @param cycleIndex — Current cycle index
   * @returns The checkpoint file path
   */
  async write(
    sessionId: string,
    conversationHistory: Array<{ role: string; content: string }>,
    isIncremental: boolean,
    cycleIndex: number,
  ): Promise<string> {
    const fields = await this.extractFields(conversationHistory, isIncremental)

    // Track discovery stability and promote stable ones
    await this.trackAndPromoteDiscoveries(sessionId, fields.cross_task_discoveries)

    const checkpoint: StructuredCheckpoint = {
      version: (this.previousCheckpoint?.version ?? 0) + 1,
      cycle_index: cycleIndex,
      session_id: sessionId,
      created_at: new Date().toISOString(),
      is_incremental: isIncremental,
      fields,
    }

    const filePath = await this.writeToFile(sessionId, checkpoint)
    this.previousCheckpoint = checkpoint

    return filePath
  }

  // ── LLM Extraction ─────────────────────────────────────────────────────

  private async extractFields(
    conversationHistory: Array<{ role: string; content: string }>,
    isIncremental: boolean,
  ): Promise<CheckpointFields> {
    if (!this.provider) {
      return this.fallbackExtraction(conversationHistory, isIncremental)
    }

    const messages = this.buildMessages(conversationHistory, isIncremental)

    try {
      const response = await this.provider.chat({ messages })
      const jsonStr = this.extractJSON(response.content)
      const parsed = JSON.parse(jsonStr)
      return this.normalizeFields(parsed)
    } catch {
      return this.fallbackExtraction(conversationHistory, isIncremental)
    }
  }

  private buildMessages(
    conversationHistory: Array<{ role: string; content: string }>,
    isIncremental: boolean,
  ): Array<{ role: string; content: string }> {
    const prevContext =
      isIncremental && this.previousCheckpoint
        ? `\n\nPrevious checkpoint (incremental update — only include CHANGES since this state):\n${JSON.stringify(this.previousCheckpoint.fields, null, 2)}`
        : ""

    const historyText = conversationHistory
      .map((t) => `[${t.role}]: ${t.content.slice(0, 500)}${t.content.length > 500 ? "..." : ""}`)
      .join("\n\n")

    return [
      { role: "system", content: this.config.systemPrompt },
      {
        role: "user",
        content: `Extract the structured state from this conversation.${prevContext}\n\nConversation:\n${historyText.slice(0, this.config.maxConversationChars)}`,
      },
    ]
  }

  private extractJSON(text: string): string {
    const start = text.indexOf("{")
    const end = text.lastIndexOf("}")
    if (start >= 0 && end > start) {
      return text.slice(start, end + 1)
    }
    return text
  }

  // ── Normalization ──────────────────────────────────────────────────────

  private normalizeFields(raw: Record<string, unknown>): CheckpointFields {
    return {
      current_intent: String(raw.current_intent ?? raw.intent ?? ""),
      next_action: String(raw.next_action ?? ""),
      working_constraints: Array.isArray(raw.working_constraints)
        ? (raw.working_constraints as unknown[]).map(String)
        : [],
      task_tree: Array.isArray(raw.task_tree)
        ? (raw.task_tree as unknown[]).map((n) => this.normalizeTaskNode(n as Record<string, unknown>))
        : [],
      current_work: Array.isArray(raw.current_work)
        ? (raw.current_work as unknown[]).map((t) => this.normalizeTurn(t as Record<string, unknown>))
        : [],
      involved_files: Array.isArray(raw.involved_files)
        ? (raw.involved_files as unknown[]).map((f) => this.normalizeFile(f as Record<string, unknown>))
        : [],
      cross_task_discoveries: Array.isArray(raw.cross_task_discoveries)
        ? (raw.cross_task_discoveries as unknown[]).map((d) => this.normalizeDiscovery(d as Record<string, unknown>))
        : [],
      errors_and_fixes: Array.isArray(raw.errors_and_fixes)
        ? (raw.errors_and_fixes as unknown[]).map((e) => this.normalizeErrorFix(e as Record<string, unknown>))
        : [],
      runtime_state: this.normalizeRuntimeState((raw.runtime_state ?? {}) as Record<string, unknown>),
      design_decisions: Array.isArray(raw.design_decisions)
        ? (raw.design_decisions as unknown[]).map((d) => this.normalizeDecision(d as Record<string, unknown>))
        : [],
      miscellaneous_notes: Array.isArray(raw.miscellaneous_notes)
        ? (raw.miscellaneous_notes as unknown[]).map(String)
        : [],
    }
  }

  private normalizeTaskNode(n: Record<string, unknown>): TaskTreeNode {
    const status = String(n.status ?? "pending")
    return {
      id: String(n.id ?? ""),
      description: String(n.description ?? ""),
      status: (["pending", "in_progress", "done", "blocked"].includes(status)
        ? status
        : "pending") as TaskTreeNode["status"],
      children: Array.isArray(n.children)
        ? (n.children as unknown[]).map((c) => this.normalizeTaskNode(c as Record<string, unknown>))
        : [],
    }
  }

  private normalizeTurn(t: Record<string, unknown>): RecentTurn {
    return {
      turn_number: Number(t.turn_number ?? 0),
      action: String(t.action ?? ""),
      result_summary: String(t.result_summary ?? ""),
      files_changed: Array.isArray(t.files_changed) ? (t.files_changed as unknown[]).map(String) : [],
    }
  }

  private normalizeFile(f: Record<string, unknown>): InvolvedFile {
    const role = String(f.role ?? "read")
    return {
      path: String(f.path ?? ""),
      role: (["read", "modified", "created", "deleted"].includes(role) ? role : "read") as InvolvedFile["role"],
      summary: String(f.summary ?? ""),
      key_changes: f.key_changes ? String(f.key_changes) : undefined,
    }
  }

  private normalizeDiscovery(d: Record<string, unknown>): Discovery {
    return {
      id: String(d.id ?? `discovery_${Date.now()}`),
      description: String(d.description ?? ""),
      confidence: Number(d.confidence ?? 0.5),
      applicable_to: Array.isArray(d.applicable_to) ? (d.applicable_to as unknown[]).map(String) : [],
    }
  }

  private normalizeErrorFix(e: Record<string, unknown>): ErrorFix {
    return {
      error_summary: String(e.error_summary ?? ""),
      root_cause: String(e.root_cause ?? ""),
      fix_applied: String(e.fix_applied ?? ""),
      verified: Boolean(e.verified ?? false),
    }
  }

  private normalizeRuntimeState(raw: Record<string, unknown>): RuntimeState {
    return {
      git_head: raw.git_head ? String(raw.git_head) : undefined,
      active_ports: Array.isArray(raw.active_ports) ? (raw.active_ports as unknown[]).map(Number) : undefined,
      current_branch: raw.current_branch ? String(raw.current_branch) : undefined,
      workspace_hash: raw.workspace_hash ? String(raw.workspace_hash) : undefined,
    }
  }

  private normalizeDecision(d: Record<string, unknown>): DesignDecision {
    return {
      id: String(d.id ?? `decision_${Date.now()}`),
      decision: String(d.decision ?? ""),
      rationale: String(d.rationale ?? ""),
      alternatives_considered: Array.isArray(d.alternatives_considered)
        ? (d.alternatives_considered as unknown[]).map(String)
        : [],
      timestamp: String(d.timestamp ?? new Date().toISOString()),
    }
  }

  // ── Fallback (no LLM) ──────────────────────────────────────────────────

  private fallbackExtraction(
    conversationHistory: Array<{ role: string; content: string }>,
    _isIncremental: boolean,
  ): CheckpointFields {
    const fullText = conversationHistory.map((t) => t.content).join("\n")
    const filePattern = /(?:^|\s)(\/?[\w./-]+\.[\w]+)/gm
    const errorPattern = /error|fail|exception|crash/i
    const files = new Set<string>()

    for (const match of fullText.matchAll(filePattern)) {
      files.add(match[1]!)
    }

    const errors: ErrorFix[] = []
    const errLines = fullText
      .split("\n")
      .filter((l) => errorPattern.test(l))
      .slice(0, 5)
    for (const line of errLines) {
      errors.push({
        error_summary: line.slice(0, 100),
        root_cause: "unknown",
        fix_applied: "not yet resolved",
        verified: false,
      })
    }

    return {
      current_intent: "Working on task (no LLM available for extraction)",
      next_action: "Continue with remaining work",
      working_constraints: [],
      task_tree: [],
      current_work: [
        {
          turn_number: conversationHistory.length,
          action: "checkpoint written (no LLM)",
          result_summary: `${files.size} files detected`,
          files_changed: [...files],
        },
      ],
      involved_files: [...files].map((f) => ({
        path: f,
        role: "modified" as const,
        summary: "",
      })),
      cross_task_discoveries: [],
      errors_and_fixes: errors,
      runtime_state: {},
      design_decisions: [],
      miscellaneous_notes: [],
    }
  }

  // ── Discovery Stability Tracking ────────────────────────────────────────

  private async trackAndPromoteDiscoveries(sessionId: string, discoveries: Discovery[]): Promise<void> {
    if (!this.projectMemory) return

    for (const disc of discoveries) {
      const count = (this.discoveryStability.get(disc.id) ?? 0) + 1
      this.discoveryStability.set(disc.id, count)

      if (count >= 3 && disc.confidence >= 0.7) {
        await this.projectMemory.promoteFact(sessionId, disc, count)
      }
    }
  }

  // ── File I/O ───────────────────────────────────────────────────────────

  private async writeToFile(sessionId: string, checkpoint: StructuredCheckpoint): Promise<string> {
    const dir = join(this.config.outputDir, sessionId)
    await mkdir(dir, { recursive: true })

    const filename = `checkpoint_v${checkpoint.version}_cycle${checkpoint.cycle_index}.json`
    const filePath = join(dir, filename)

    await writeFile(filePath, JSON.stringify(checkpoint, null, 2), "utf-8")
    await this.writeMarkdownCheckpoint(sessionId, checkpoint)

    return filePath
  }

  private async writeMarkdownCheckpoint(sessionId: string, checkpoint: StructuredCheckpoint): Promise<void> {
    const dir = join(this.config.outputDir, sessionId)
    await mkdir(dir, { recursive: true })

    const f = checkpoint.fields
    const md = [
      "# Session Checkpoint",
      "",
      `> Version ${checkpoint.version} | Cycle ${checkpoint.cycle_index} | ${checkpoint.created_at}`,
      `> ${checkpoint.is_incremental ? "Incremental update" : "Full checkpoint"}`,
      "",
      "## Current Intent",
      f.current_intent,
      "",
      "## Next Action",
      f.next_action,
      "",
      "## Working Constraints",
      f.working_constraints.map((c) => `- ${c}`).join("\n") || "None",
      "",
      "## Task Tree",
      this.renderTaskTree(f.task_tree),
      "",
      "## Current Work",
      f.current_work.map((t) => `- [Turn ${t.turn_number}] ${t.action}: ${t.result_summary}`).join("\n") || "None",
      "",
      "## Involved Files",
      f.involved_files.map((ifile) => `- \`${ifile.path}\` (${ifile.role}): ${ifile.summary}`).join("\n") || "None",
      "",
      "## Cross-Task Discoveries",
      f.cross_task_discoveries
        .map((d) => `- [**${d.id}**] ${d.description} (confidence: ${d.confidence})`)
        .join("\n") || "None",
      "",
      "## Errors & Fixes",
      f.errors_and_fixes
        .map((e) => `- **${e.error_summary}** → ${e.fix_applied} ${e.verified ? "✓" : "⚠"}`)
        .join("\n") || "None",
      "",
      "## Runtime State",
      Object.entries(f.runtime_state)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `- ${k}: ${JSON.stringify(v)}`)
        .join("\n") || "No runtime state captured",
      "",
      "## Design Decisions",
      f.design_decisions.map((d) => `- [${d.id}] **${d.decision}**: ${d.rationale}`).join("\n") || "None",
      "",
      "## Miscellaneous Notes",
      f.miscellaneous_notes.map((n) => `- ${n}`).join("\n") || "None",
      "",
    ].join("\n")

    await writeFile(join(dir, "checkpoint.md"), md, "utf-8")
  }

  private renderTaskTree(nodes: TaskTreeNode[], indent = 0): string {
    return nodes
      .map((n) => {
        const prefix = "  ".repeat(indent)
        const statusIcon = {
          pending: "○",
          in_progress: "●",
          done: "✓",
          blocked: "✗",
        }[n.status]
        const line = `${prefix}- ${statusIcon} ${n.description}`
        const children = n.children.length > 0 ? `\n${this.renderTaskTree(n.children, indent + 1)}` : ""
        return line + children
      })
      .join("\n")
  }

  // ── Management ─────────────────────────────────────────────────────────

  getPreviousCheckpoint(): StructuredCheckpoint | null {
    return this.previousCheckpoint
  }

  setPreviousCheckpoint(cp: StructuredCheckpoint): void {
    this.previousCheckpoint = cp
  }

  reset(): void {
    this.previousCheckpoint = null
    this.discoveryStability.clear()
  }
}

/**
 * Create a {@link CheckpointWriter} instance.
 *
 * @param args - Constructor arguments forwarded to {@link CheckpointWriter}.
 * @returns A new {@link CheckpointWriter}.
 */
export function createCheckpointWriter(...args: ConstructorParameters<typeof CheckpointWriter>): CheckpointWriter {
  return new CheckpointWriter(...args)
}
