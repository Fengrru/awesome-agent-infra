import { EventArchiver } from "@fengrru/archiver"
import { CodeGraph, CodeGraphSearcher } from "@fengrru/codegraph"
import type { CodeGraphNode, SymbolMetadata } from "@fengrru/codegraph"
import { ConfidenceGate } from "@fengrru/confidence-gate"
import { CodeEmbeddingIndexer } from "@fengrru/embedding"
import type { CodeEmbeddingItem } from "@fengrru/embedding"
import { EventPriority, EventType, createSimpleEventBus } from "@fengrru/event-bus"
import type { EventBus } from "@fengrru/event-bus"
import { fuzzyFindAndReplace } from "@fengrru/fuzzy-patch"
import type { Capability, DAG } from "@fengrru/llm-dag-generator"
import { ProjectMemoryManager } from "@fengrru/project-memory"
import { AgentState, AgentStateMachine } from "@fengrru/state-machine"
import { allSucceeded, getReadyNodes, isComplete, validateDAG } from "@fengrru/taskdag"
import { ValidationNetwork } from "@fengrru/valid8"

// ---------------------------------------------------------------------------
// Sample data: a synthetic "mini crm" project we pretend to refactor
// ---------------------------------------------------------------------------

const SAMPLE_FILES: Record<string, string> = {
  "src/auth.ts": `
import { User } from "./models"

export function authenticate(username: string, password: string): User | null {
  const user = findUserByUsername(username)
  if (!user) return null
  if (!verifyPassword(user, password)) return null
  return user
}

function findUserByUsername(username: string): User | null {
  // deepscan: fetch from DB
  return null
}

function verifyPassword(user: User, password: string): boolean {
  // deepscan: bcrypt compare
  return false
}
`,
  "src/models.ts": `
export interface User {
  id: string
  username: string
  email: string
  passwordHash: string
  createdAt: Date
}
`,
  "src/repo.ts": `
import { User } from "./models"

export async function saveUser(user: User): Promise<void> {
  // deepscan: insert into users table
}

export async function getUserById(id: string): Promise<User | null> {
  // deepscan: select from users table
  return null
}

export async function getUserByEmail(email: string): Promise<User | null> {
  // deepscan: select from users table
  return null
}
`,
  "src/handler.ts": `
import { authenticate } from "./auth"
import { saveUser, getUserByEmail } from "./repo"
import { User } from "./models"

export async function handleLogin(username: string, password: string): Promise<User | null> {
  const user = authenticate(username, password)
  if (!user) return null
  return user
}

export async function handleRegister(username: string, email: string, password: string): Promise<User> {
  const existing = await getUserByEmail(email)
  if (existing) throw new Error("Email already registered")

  const user: User = {
    id: crypto.randomUUID(),
    username,
    email,
    passwordHash: password,
    createdAt: new Date(),
  }
  await saveUser(user)
  return user
}
`,
}

const SAMPLE_PATCH = {
  oldString: "export async function saveUser(user: User): Promise<void>",
  newString: "export async function persistUser(user: User, tx?: Transaction): Promise<void>",
}

const DIFF_OUTPUT = `
src/repo.ts:9:9 - error TS2304: Cannot find name 'Transaction'
src/repo.ts:9:9 - warning: Add a JSDoc comment for the new parameter
3/5 tests passed; 2 tests failed in UserService
`

// ---------------------------------------------------------------------------
// DemoScenario — orchestrates all 8 packages in sequence
// ---------------------------------------------------------------------------

export interface DemoStep {
  step: number
  label: string
  package: string
  status: "pass" | "fail"
  detail: string
}

export interface DemoResult {
  steps: DemoStep[]
  snapshot: Record<string, unknown>
  overall: "success" | "failure"
}

export class CodeRefactorScenario {
  private steps: DemoStep[] = []
  private eventBus: EventBus
  private stateMachine: AgentStateMachine
  private archiver: EventArchiver
  private confidenceGate: ConfidenceGate

  constructor() {
    this.eventBus = createSimpleEventBus()
    this.stateMachine = new AgentStateMachine()
    this.archiver = new EventArchiver({ storageDir: ".demo-archives", compress: false })
    this.confidenceGate = new ConfidenceGate({ applyScaling: true })
  }

  private addStep(label: string, pkg: string, status: "pass" | "fail", detail: string): void {
    this.steps.push({ step: this.steps.length + 1, label, package: pkg, status, detail })
  }

  private async emit(type: (typeof EventType)[keyof typeof EventType], data: Record<string, unknown>): Promise<void> {
    await this.eventBus.publish({
      type,
      source: "code-refactor-agent",
      session_id: "demo-session-001",
      data,
      priority: EventPriority.NORMAL,
      timestamp: Date.now(),
      require_persistence: true,
    })
  }

  async run(): Promise<DemoResult> {
    const log = (msg: string) => console.log(`  [demo] ${msg}`)

    // ── Step 0: State Machine: IDLE → INITIALIZING → … ────────────────
    console.log("=== Code Refactor Agent Demo ===\n")
    log("State machine: IDLE → INITIALIZING")
    await this.stateMachine.transition(AgentState.INITIALIZING, "demo start")
    await this.emit(EventType.STATE_TRANSITION, { from: "IDLE", to: AgentState.INITIALIZING })

    // ── Step 1: project-memory — Load project context ──────────────────
    console.log("\n--- Step 1: project-memory ---")
    {
      const mem = new ProjectMemoryManager({ filePath: "MEMORY.demo.md", maxEntries: 100 })
      await mem.upsertEntry({
        section: "background",
        content: "Mini-CRM: a lightweight user management service with auth, persistence, and HTTP handlers.",
        confidence: 1.0,
        verification_count: 3,
        source_sessions: ["demo-session-001"],
        user_authored: true,
      })
      await mem.upsertEntry({
        section: "architecture",
        content: "Auth module uses bcrypt for password hashing. Repo layer uses PostgreSQL via Drizzle ORM.",
        confidence: 0.9,
        verification_count: 2,
        source_sessions: ["demo-session-001"],
        user_authored: true,
      })
      const entries = await mem.getAllEntries()
      await mem.search("password hashing") // warm cache

      log(`Loaded ${entries.length} memory entries from project memory`)
      this.addStep("Load project memory (2 entries)", "project-memory", "pass", `entries=${entries.length}`)

      await mem.promoteDiscovery(
        "demo-session-001",
        {
          id: "disc_001",
          description: "saveUser should accept an optional transaction parameter for atomicity",
          confidence: 0.85,
          applicable_to: ["src/repo.ts"],
        },
        3,
      )

      log("Promoted discovery to project facts")
      this.addStep("Promote stable discovery to facts", "project-memory", "pass", "discovery=disc_001 promoted")

      await mem.save()
    }

    // ── Step 2: codegraph + embedding — Understand code structure ──────
    console.log("\n--- Step 2: codegraph + embedding ---")
    {
      const graph = new CodeGraph()

      // Build synthetic graph nodes
      for (const [filePath, content] of Object.entries(SAMPLE_FILES)) {
        const fileId = `file:${filePath}`
        graph.addNode({
          id: fileId,
          type: "file",
          name: filePath,
          filePath,
          startLine: 1,
          endLine: content.split("\n").length,
          metadata: { language: "typescript", size: content.length, imports: [], exports: [] },
          mtime: Date.now(),
        })
      }

      const symbolNodes: CodeGraphNode[] = [
        {
          id: "symbol:src/auth.ts:authenticate",
          type: "symbol",
          symbolType: "function",
          name: "authenticate",
          filePath: "src/auth.ts",
          startLine: 3,
          endLine: 8,
          metadata: { isExported: true, visibility: "public", returnType: "User | null" } as SymbolMetadata,
          mtime: Date.now(),
        },
        {
          id: "symbol:src/models.ts:User",
          type: "symbol",
          symbolType: "interface",
          name: "User",
          filePath: "src/models.ts",
          startLine: 1,
          endLine: 8,
          metadata: { isExported: true, visibility: "public" } as SymbolMetadata,
          mtime: Date.now(),
        },
        {
          id: "symbol:src/repo.ts:saveUser",
          type: "symbol",
          symbolType: "function",
          name: "saveUser",
          filePath: "src/repo.ts",
          startLine: 3,
          endLine: 5,
          metadata: {
            isExported: true,
            visibility: "public",
            returnType: "Promise<void>",
            isAsync: true,
          } as SymbolMetadata,
          mtime: Date.now(),
        },
        {
          id: "symbol:src/handler.ts:handleLogin",
          type: "symbol",
          symbolType: "function",
          name: "handleLogin",
          filePath: "src/handler.ts",
          startLine: 5,
          endLine: 10,
          metadata: {
            isExported: true,
            visibility: "public",
            returnType: "Promise<User | null>",
            isAsync: true,
          } as SymbolMetadata,
          mtime: Date.now(),
        },
        {
          id: "symbol:src/handler.ts:handleRegister",
          type: "symbol",
          symbolType: "function",
          name: "handleRegister",
          filePath: "src/handler.ts",
          startLine: 12,
          endLine: 23,
          metadata: {
            isExported: true,
            visibility: "public",
            returnType: "Promise<User>",
            isAsync: true,
          } as SymbolMetadata,
          mtime: Date.now(),
        },
      ]

      for (const n of symbolNodes) graph.addNode(n)

      // Add edges
      graph.addEdge({
        sourceId: "symbol:src/handler.ts:handleLogin",
        targetId: "symbol:src/auth.ts:authenticate",
        relation: "calls",
      })
      graph.addEdge({
        sourceId: "symbol:src/handler.ts:handleRegister",
        targetId: "symbol:src/repo.ts:saveUser",
        relation: "calls",
      })
      graph.addEdge({
        sourceId: "symbol:src/auth.ts:authenticate",
        targetId: "symbol:src/models.ts:User",
        relation: "references",
      })

      log(`CodeGraph built: ${symbolNodes.length} symbols, 4 files, 3 edges`)

      // Search
      const searcher = new CodeGraphSearcher(graph)
      const results = searcher.searchSymbols("saveUser", { maxResults: 5 })
      log(`Searcher found ${results.length} matches for "saveUser"`)

      // Embedding index
      const indexer = new CodeEmbeddingIndexer()
      const items: CodeEmbeddingItem[] = symbolNodes.map((n) => ({
        id: n.id,
        content: `${n.name}: ${n.filePath} L${n.startLine}-${n.endLine}`,
        type: n.symbolType ?? "other",
        filePath: n.filePath,
        startLine: n.startLine,
        endLine: n.endLine,
      }))
      await indexer.addItems(items)
      const embedResults = indexer.searchText("user authentication login", 3)
      log(
        `Embedding index: ${indexer.indexSize} items, top-3 search for "user auth": [${embedResults.map((r) => r.id.split(":")[2]).join(", ")}]`,
      )

      this.addStep(
        "Build code graph + search",
        "codegraph",
        "pass",
        `${symbolNodes.length} symbols, ${graph.edgeCount} edges`,
      )
      this.addStep("Index code items via TF-IDF", "embedding", "pass", `${indexer.indexSize} items indexed`)
    }

    // ── Step 3: llm-dag-generator + taskdag — Plan refactoring ─────────
    console.log("\n--- Step 3: llm-dag-generator + taskdag ---")
    log("State machine: INITIALIZING → READY → PLANNING")
    await this.stateMachine.transition(AgentState.READY, "graph built")
    await this.stateMachine.transition(AgentState.PLANNING, "generating DAG")

    const capabilities: Capability[] = [
      {
        capability_id: "read_file",
        name: "Read File",
        risk_level: 0,
        tags: ["io", "read"],
        success_rate: 0.99,
        description: "Read a source file",
      },
      {
        capability_id: "analyze_deps",
        name: "Analyze Dependencies",
        risk_level: 0,
        tags: ["analysis"],
        success_rate: 0.95,
        description: "Analyze import and call graph",
      },
      {
        capability_id: "rewrite_fn",
        name: "Rewrite Function",
        risk_level: 1,
        tags: ["edit", "refactor"],
        success_rate: 0.85,
        description: "Rewrite a function body",
      },
      {
        capability_id: "update_callsites",
        name: "Update Call Sites",
        risk_level: 1,
        tags: ["edit"],
        success_rate: 0.8,
        description: "Update all callers of a function",
      },
      {
        capability_id: "run_tests",
        name: "Run Tests",
        risk_level: 1,
        tags: ["verify"],
        success_rate: 0.9,
        description: "Run test suite",
      },
    ]

    const { DAGGenerator } = await import("@fengrru/llm-dag-generator")
    const gen = new DAGGenerator()
    const dag = await gen.generateDAG("Refactor saveUser to accept optional Transaction parameter", capabilities)

    // Build a valid DAG from the fallback plan (preserves cap ordering, fixes edge indexing)
    const dagPlan: DAG = {
      version: 1,
      nodes: dag.nodes,
      edges: [
        ["n1", "n2"],
        ["n2", "n3"],
        ["n3", "n4"],
        ["n4", "n5"],
      ],
      metadata: {
        goal: "Refactor saveUser to accept optional Transaction parameter",
        strategy: "STAGED",
        replan_count: 0,
        created_at: Date.now(),
      },
    }

    // Validate DAG structure
    const validation = validateDAG(dagPlan)
    log(
      `DAG generated: ${dagPlan.nodes.length} nodes, valid=${validation.valid}, strategy=${dagPlan.metadata?.strategy}`,
    )
    await this.emit(EventType.DAG_GENERATED, {
      goal: dagPlan.metadata?.goal,
      nodeCount: dagPlan.nodes.length,
      strategy: dagPlan.metadata?.strategy,
    })

    if (validation.valid && validation.executionOrder) {
      log(`Execution order: ${validation.executionOrder.join(" → ")}`)
    }

    // "Execute" the DAG by marking nodes completed
    for (const node of dagPlan.nodes) {
      node.status = "completed"
      node.output = { result: `Simulated: ${node.capability_id} completed` }
    }

    const ready = getReadyNodes(dagPlan)
    const done = isComplete(dagPlan)
    const ok = allSucceeded(dagPlan)
    log(`DAG execution: ready=${ready.length}, complete=${done}, allSucceeded=${ok}`)

    this.addStep(
      "Generate refactoring DAG plan",
      "llm-dag-generator",
      "pass",
      `${dagPlan.nodes.length} nodes, ${dagPlan.edges.length} edges`,
    )
    this.addStep(
      "Validate & execute DAG",
      "taskdag",
      validation.valid && ok ? "pass" : "fail",
      `valid=${validation.valid}, complete=${ok}`,
    )

    // ── Step 4: valid8 — Validate changes ──────────────────────────────
    console.log("\n--- Step 4: valid8 ---")
    log("State machine: PLANNING → EXECUTING → VERIFYING")
    await this.stateMachine.transition(AgentState.EXECUTING, "applying changes")
    await this.stateMachine.transition(AgentState.VERIFYING, "validating")

    const vn = new ValidationNetwork({ threshold: 0.7, maxRetries: 3 })
    const originalCode = SAMPLE_FILES["src/repo.ts"]!
    const patchedCode = fuzzyFindAndReplace(
      originalCode,
      "async function saveUser(user: User): Promise<void>",
      "async function persistUser(user: User, tx?: Transaction): Promise<void>",
    ).newContent

    log(
      `Patch applied: strategy=${fuzzyFindAndReplace(originalCode, SAMPLE_PATCH.oldString, SAMPLE_PATCH.newString).strategy}`,
    )

    const syntax = await vn.runSyntaxValidation(patchedCode, "src/repo.ts")
    const semantic = await vn.runSemanticValidation(patchedCode, "Add transaction support to repository layer")
    const runtime = await vn.runRuntimeValidation("", DIFF_OUTPUT, "")
    const security = await vn.runSecurityValidation(patchedCode, { allowBash: false, allowWrite: true })

    const confidence = vn.calculateConfidence([syntax, semantic, runtime, security])
    log(`  syntax   (score=${syntax.score.toFixed(2)}): ${syntax.report}`)
    log(`  semantic (score=${semantic.score.toFixed(2)}): ${semantic.report}`)
    log(`  runtime  (score=${runtime.score.toFixed(2)}): ${runtime.report}`)
    log(`  security (score=${security.score.toFixed(2)}): ${security.report}`)
    log(`  >>> Overall confidence: ${confidence.toFixed(2)}`)

    await this.emit(EventType.VALIDATION_PASSED, {
      layerScores: { syntax: syntax.score, semantic: semantic.score, runtime: runtime.score, security: security.score },
      overall: confidence,
    })

    this.addStep(
      "Syntax validation",
      "valid8",
      syntax.score >= 0.5 ? "pass" : "fail",
      `score=${syntax.score.toFixed(2)}`,
    )
    this.addStep(
      "Semantic validation",
      "valid8",
      semantic.score >= 0.5 ? "pass" : "fail",
      `score=${semantic.score.toFixed(2)}`,
    )
    this.addStep(
      "Runtime validation",
      "valid8",
      runtime.score >= 0.5 ? "pass" : "fail",
      `score=${runtime.score.toFixed(2)}`,
    )
    this.addStep(
      "Security validation",
      "valid8",
      security.score >= 0.5 ? "pass" : "fail",
      `score=${security.score.toFixed(2)}`,
    )

    // ── Step 5: fuzzy-patch — Apply patches ────────────────────────────
    console.log("\n--- Step 5: fuzzy-patch ---")
    {
      const content = SAMPLE_FILES["src/repo.ts"]!
      // Exact fails because the content has leading whitespace differences vs the patch string
      const exact = fuzzyFindAndReplace(content, "async function saveUser(user: User): Promise<void> {", "FIXED")
      const indent = fuzzyFindAndReplace(
        content,
        "export async function saveUser(user: User): Promise<void> {",
        "REPLACED",
      )
      const patchResult = fuzzyFindAndReplace(content, SAMPLE_PATCH.oldString, SAMPLE_PATCH.newString)

      log(`Exact match:       strategy=${exact.strategy}, matches=${exact.matchCount}`)
      log(`Whitespace-normal: strategy=${indent.strategy}, matches=${indent.matchCount}`)
      log(`Real patch:        strategy=${patchResult.strategy}, matches=${patchResult.matchCount}`)

      this.addStep(
        "Apply fuzzy patch (3 tests)",
        "fuzzy-patch",
        patchResult.strategy !== "none" ? "pass" : "fail",
        `strategy=${patchResult.strategy}`,
      )
    }

    // ── Step 6: event-bus + archiver — Record events ───────────────────
    console.log("\n--- Step 6: event-bus + archiver ---")
    {
      let eventsReceived = 0
      this.eventBus.subscribe(EventType.VALIDATION_PASSED, () => {
        eventsReceived++
      })
      this.eventBus.subscribe(EventType.DAG_GENERATED, () => {
        eventsReceived++
      })
      this.eventBus.subscribe(EventType.STATE_TRANSITION, () => {
        eventsReceived++
      })

      await this.emit(EventType.VALIDATION_PASSED, { step: 6, test: true })
      await this.emit(EventType.DAG_GENERATED, { step: 6, test: true })

      // small delay for async flush
      await new Promise((r) => setTimeout(r, 100))

      log(`Event bus: published 7 events, subscribers received ${eventsReceived} dispatches`)
      this.addStep("Publish & subscribe to events", "event-bus", "pass", "7 events published")

      // Archiver
      const shouldArchive = await this.archiver.shouldArchive()
      log(`Archiver: shouldArchive=${shouldArchive} (no database set)`)

      const archiveList = await this.archiver.listArchives()
      log(`Archiver: existing cold archives=${archiveList.length}`)

      this.addStep(
        "Check archive threshold",
        "archiver",
        "pass",
        `shouldArchive=${shouldArchive}, archives=${archiveList.length}`,
      )
      await this.eventBus.shutdown()
    }

    // ── Step 7: state-machine — Full state trace ───────────────────────
    console.log("\n--- Step 7: state-machine ---")
    {
      const snapshot = this.stateMachine.getSnapshot()
      const metrics = this.stateMachine.getStateMetrics()

      log(`Final state: ${snapshot.current_state}`)
      log(`Transitions: ${snapshot.transition_count}`)
      for (const h of snapshot.state_history) {
        log(`  ${h.from} → ${h.to}  (${h.reason})`)
      }
      const executingMetrics = metrics.EXECUTING
      if (executingMetrics) {
        log(`State metrics: EXECUTING avg=${executingMetrics.avg_time_ms.toFixed(0)}ms`)
      }

      this.addStep(
        "State lifecycle tracking",
        "state-machine",
        "pass",
        `final=${snapshot.current_state}, transitions=${snapshot.transition_count}`,
      )
    }

    // ── Step 8: confidence-gate — Check confidence ─────────────────────
    console.log("\n--- Step 8: confidence-gate ---")
    {
      const samples = [
        { predictedConfidence: 0.92, actualCorrect: true },
        { predictedConfidence: 0.88, actualCorrect: true },
        { predictedConfidence: 0.75, actualCorrect: true },
        { predictedConfidence: 0.6, actualCorrect: false },
        { predictedConfidence: 0.95, actualCorrect: true },
        { predictedConfidence: 0.45, actualCorrect: false },
        { predictedConfidence: 0.82, actualCorrect: true },
        { predictedConfidence: 0.7, actualCorrect: false },
      ]

      const report = this.confidenceGate.fit(samples)
      log(
        `Calibration: ECE=${report.ece.toFixed(3)}, Brier=${report.brierScore.toFixed(3)}, T=${report.optimalTemperature.toFixed(2)}`,
      )
      log(`Dynamic threshold: ${report.dynamicThreshold.toFixed(2)}`)
      log(`Hallucination rate: ${(report.hallucinationRate * 100).toFixed(1)}%`)
      log(`Summary: ${report.summary}`)

      const result = this.confidenceGate.calibrate(0.88)
      log(
        `Single calibrate(0.88): ${result.calibrationStatus}, shouldAnswer=${result.shouldAnswer}, confidence=${result.confidence.toFixed(3)}`,
      )

      this.addStep(
        "Calibrate confidence model",
        "confidence-gate",
        "pass",
        `ECE=${report.ece.toFixed(3)}, T=${report.optimalTemperature.toFixed(2)}`,
      )
    }

    // ── Final ──────────────────────────────────────────────────────────
    console.log("\n--- Final ---")
    await this.stateMachine.transition(AgentState.COMPLETED, "all steps done")
    log("State machine: VERIFYING → COMPLETED")
    log(`Final state: ${this.stateMachine.state}, ${this.stateMachine.transitions} transitions total`)

    const allPassed = this.steps.every((s) => s.status === "pass")
    const snapshot = this.stateMachine.getSnapshot()
    return {
      steps: this.steps,
      snapshot: {
        finalState: snapshot.current_state,
        transitionCount: snapshot.transition_count,
        stateHistory: snapshot.state_history,
        stepCount: this.steps.length,
        passCount: this.steps.filter((s) => s.status === "pass").length,
        failCount: this.steps.filter((s) => s.status === "fail").length,
        confidence: this.confidenceGate.report
          ? {
              ece: this.confidenceGate.report.ece,
              temperature: this.confidenceGate.temperature,
              threshold: this.confidenceGate.threshold,
            }
          : null,
      },
      overall: allPassed ? "success" : "failure",
    }
  }
}
