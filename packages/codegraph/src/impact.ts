/**
 * Impact Analysis Engine
 *
 * Core impact analysis logic: query the code graph + call sites
 * to predict what will break when a code change is made.
 *
 * Supports:
 * - Direct caller analysis (1-hop)
 * - Transitive caller propagation (up to maxDepth)
 * - Signature break detection via CallSite comparison
 * - Override chain analysis (parent method changes)
 * - Type usage analysis
 * - Risk scoring with explainable factors
 * - Test affinity via heuristic matching
 *
 * @module codegraph/impact
 */

import { CodeGraph } from "./graph"
import type { CallSiteStore } from "./callsite"
import type {
  CodeGraphNode,
  ImpactResult,
  ImpactChain,
  SignatureBreak,
  SymbolMetadata,
} from "./types"

export interface ImpactAnalysisConfig {
  maxDepth: number
  riskWeights?: {
    directCallerWeight: number
    transitiveCallerWeight: number
    affectedFileWeight: number
    publicApiPenalty: number
    signatureBreakPenalty: number
    testCoveredBonus: number
  }
}

const DEFAULT_IMPACT_CONFIG: ImpactAnalysisConfig = {
  maxDepth: 3,
  riskWeights: {
    directCallerWeight: 0.05,
    transitiveCallerWeight: 0.02,
    affectedFileWeight: 0.05,
    publicApiPenalty: 0.15,
    signatureBreakPenalty: 0.2,
    testCoveredBonus: 0.1,
  },
}

export class ImpactAnalyzer {
  private graph: CodeGraph
  private callSites: CallSiteStore | null
  private config: ImpactAnalysisConfig

  constructor(
    graph: CodeGraph,
    callSites?: CallSiteStore,
    config?: Partial<ImpactAnalysisConfig>,
  ) {
    this.graph = graph
    this.callSites = callSites ?? null
    this.config = { ...DEFAULT_IMPACT_CONFIG, ...config }
  }

  /**
   * Analyze the impact of modifying an entity.
   *
   * @param entityId - The primary entity being changed
   * @param editType - The type of edit (affects risk calculation)
   * @param newSignature - Optional new parameter info for signature break detection
   */
  analyzeImpact(
    entityId: string,
    editType: "modify_signature" | "modify_body" | "delete" | "rename",
    newSignature?: {
      paramCount: number
      requiredParamCount: number
      paramNames: string[]
    },
  ): ImpactResult {
    const entity = this.graph.getNode(entityId)

    const directCallers = this.graph.getCallersOf(entityId)
    const transitiveCallers = this.graph.getTransitiveCallers(entityId, this.config.maxDepth)

    const allTransitiveCallers: CodeGraphNode[] = []
    for (const [, callers] of transitiveCallers) {
      for (const caller of callers) {
        allTransitiveCallers.push(caller)
      }
    }

    const affectedFiles = this.graph.getAffectedFiles(entityId, this.config.maxDepth)

    const overriddenBy = this.graph.getOverriddenBy(entityId)
    const typeUsers = this.graph.getTypeUsersOf(entityId)

    const signatureBreaks = this.computeSignatureBreaks(
      entityId,
      editType,
      newSignature,
    )

    const affectedTests = this.graph.getTestsFor(entityId)
    if (affectedTests.length === 0) {
      const heuristicTests = this.findTestsHeuristically(entityId, [...directCallers, ...allTransitiveCallers])
      affectedTests.push(...heuristicTests)
    }

    const impactChains = this.buildImpactChains(entityId, directCallers, transitiveCallers)

    const isPublicApi = entity ? !entity.name.startsWith("_") : false

    const riskScore = this.computeRiskScore({
      directCallerCount: directCallers.length,
      transitiveCallerCount: allTransitiveCallers.length,
      affectedFileCount: affectedFiles.length,
      isPublicApi,
      signatureBreakCount: signatureBreaks.length,
      testCount: affectedTests.length,
    })

    return {
      primaryEntityId: entityId,
      riskScore,
      directCallers,
      transitiveCallers: allTransitiveCallers,
      affectedFiles,
      affectedTests,
      signatureBreaks,
      impactChains,
      isPublicApi,
    }
  }

  /**
   * Compute signature break details by comparing existing call sites
   * with proposed new signature.
   */
  private computeSignatureBreaks(
    entityId: string,
    editType: string,
    newSignature?: {
      paramCount: number
      requiredParamCount: number
      paramNames: string[]
    },
  ): SignatureBreak[] {
    if (editType !== "modify_signature" || !newSignature || !this.callSites) {
      return []
    }

    const staleCallSites = this.callSites.getStaleCallSites(
      entityId,
      newSignature.paramCount,
      newSignature.requiredParamCount,
      newSignature.paramNames,
    )

    return staleCallSites.map((cs) => ({
      callSiteId: cs.id,
      entityId: cs.callerId,
      reason: this.describeBreakReason(cs, newSignature),
      location: {
        filePath: cs.filePath,
        startLine: cs.startLine,
        endLine: cs.endLine,
      },
    }))
  }

  private describeBreakReason(
    cs: { argCount: number; keywordArgs: string[] },
    newSig: { requiredParamCount: number; paramNames: string[] },
  ): string {
    if (cs.argCount < newSig.requiredParamCount) {
      return `Insufficient arguments: ${cs.argCount} provided, ${newSig.requiredParamCount} required`
    }
    for (const kw of cs.keywordArgs) {
      if (!newSig.paramNames.includes(kw)) {
        return `Unknown keyword argument '${kw}' — parameter renamed or removed`
      }
    }
    return "Potential signature incompatibility"
  }

  /**
   * Build impact chains showing propagation paths.
   */
  private buildImpactChains(
    entityId: string,
    directCallers: CodeGraphNode[],
    transitiveCallers: Map<number, CodeGraphNode[]>,
  ): ImpactChain[] {
    const chains: ImpactChain[] = []

    for (const caller of directCallers) {
      chains.push({
        depth: 1,
        path: [entityId, caller.id],
        impactType: "signature_mismatch",
        confidence: 1.0,
      })
    }

    for (const [depth, callers] of transitiveCallers) {
      for (const caller of callers) {
        const path = this.findPath(entityId, caller.id, depth)
        chains.push({
          depth,
          path: path.length > 0 ? path : [entityId, caller.id],
          impactType: "behavioral_change",
          confidence: 1.0 / depth,
        })
      }
    }

    return chains
  }

  /**
   * Find a path from source to target via called_by edges (BFS).
   */
  private findPath(sourceId: string, targetId: string, maxDepth: number): string[] {
    if (sourceId === targetId) return [sourceId]

    const visited = new Set<string>([sourceId])
    const queue: Array<{ id: string; path: string[] }> = [{ id: sourceId, path: [sourceId] }]

    while (queue.length > 0) {
      const current = queue.shift()!
      if (current.path.length > maxDepth + 1) continue

      for (const caller of this.graph.getCallersOf(current.id)) {
        if (caller.id === targetId) {
          return [...current.path, targetId]
        }
        if (!visited.has(caller.id)) {
          visited.add(caller.id)
          queue.push({ id: caller.id, path: [...current.path, caller.id] })
        }
      }
    }

    return [sourceId, targetId]
  }

  /**
   * Heuristically find test functions that are likely related to
   * the primary entity or its callers.
   */
  private findTestsHeuristically(
    entityId: string,
    callers: CodeGraphNode[],
  ): CodeGraphNode[] {
    const entity = this.graph.getNode(entityId)
    if (!entity) return []

    const results: CodeGraphNode[] = []
    const entityName = entity.name.toLowerCase()

    const allFuncs = this.graph.findNodes(
      (n) =>
        n.type === "symbol" &&
        (n.symbolType === "function" || n.symbolType === "method"),
    )

    for (const func of allFuncs) {
      const name = func.name.toLowerCase()
      if (!name.startsWith("test") && !name.startsWith("it") && !name.startsWith("spec")) continue
      if (
        name.includes(entityName) ||
        func.filePath.toLowerCase().includes("test") ||
        func.filePath.toLowerCase().includes("spec") ||
        func.filePath.toLowerCase().includes("__tests__")
      ) {
        results.push(func)
      }
    }

    return results
  }

  /**
   * Compute a risk score (0.0 to 1.0) based on impact factors.
   */
  private computeRiskScore(params: {
    directCallerCount: number
    transitiveCallerCount: number
    affectedFileCount: number
    isPublicApi: boolean
    signatureBreakCount: number
    testCount: number
  }): number {
    const w = this.config.riskWeights!
    let score = 0.0

    score += Math.min(params.directCallerCount * w.directCallerWeight, 0.3)
    score += Math.min(params.transitiveCallerCount * w.transitiveCallerWeight, 0.2)
    score += Math.min(params.affectedFileCount * w.affectedFileWeight, 0.15)

    if (params.isPublicApi) {
      score += w.publicApiPenalty
    }

    if (params.signatureBreakCount > 0) {
      score += w.signatureBreakPenalty
    }

    if (params.testCount > 0) {
      score -= w.testCoveredBonus
    }

    return Math.max(0, Math.min(score, 1.0))
  }

  /**
   * Format an impact result into a human-readable summary.
   */
  formatImpactSummary(result: ImpactResult): string {
    const lines: string[] = [
      `# Impact Analysis: ${result.primaryEntityId}`,
      "",
      `Risk Score: ${(result.riskScore * 100).toFixed(1)}% ${this.riskLabel(result.riskScore)}`,
      "",
      `Direct Callers: ${result.directCallers.length}`,
      `Transitive Callers: ${result.transitiveCallers.length}`,
      `Affected Files: ${result.affectedFiles.length}`,
      `Affected Tests: ${result.affectedTests.length}`,
      `Signature Breaks: ${result.signatureBreaks.length}`,
      `Public API: ${result.isPublicApi ? "Yes" : "No"}`,
      "",
    ]

    if (result.signatureBreaks.length > 0) {
      lines.push("## Signature Breaks")
      for (const sb of result.signatureBreaks) {
        lines.push(`- ${sb.location.filePath}:${sb.location.startLine} — ${sb.reason}`)
      }
      lines.push("")
    }

    if (result.impactChains.length > 0) {
      lines.push("## Impact Chains (top 10)")
      for (const chain of result.impactChains.slice(0, 10)) {
        const pathStr = chain.path.map((id) => this.shortId(id)).join(" → ")
        lines.push(`- [depth=${chain.depth}] ${pathStr}`)
      }
      lines.push("")
    }

    if (result.affectedFiles.length > 0) {
      lines.push("## Affected Files")
      for (const file of result.affectedFiles.slice(0, 15)) {
        lines.push(`- ${file}`)
      }
    }

    return lines.join("\n")
  }

  private riskLabel(score: number): string {
    if (score >= 0.7) return "HIGH"
    if (score >= 0.4) return "MEDIUM"
    return "LOW"
  }

  private shortId(id: string): string {
    const parts = id.split(":")
    return parts.length >= 3 ? parts.slice(2).join(".") : id
  }
}

/**
 * Standalone impact analysis function for quick use.
 */
export function analyzeImpact(
  graph: CodeGraph,
  entityId: string,
  callSites?: CallSiteStore,
  config?: Partial<ImpactAnalysisConfig>,
): ImpactResult {
  const analyzer = new ImpactAnalyzer(graph, callSites, config)
  return analyzer.analyzeImpact(entityId, "modify_signature")
}
