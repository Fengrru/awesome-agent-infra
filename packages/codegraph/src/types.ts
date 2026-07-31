/**
 * CodeGraph Type Definitions
 *
 * Data models for the codebase-level heterogeneous graph:
 * symbols, files, modules as nodes; call, extend, implement, contain,
 * import, reference as edges.
 *
 * Extended with token-level positioning, bidirectional relations,
 * call sites, and incremental update state machine for
 * impact-aware code agent toolkit.
 *
 * @module codegraph/types
 */

export type NodeType = "file" | "module" | "symbol"
export type SymbolType =
  | "function"
  | "class"
  | "interface"
  | "method"
  | "variable"
  | "enum"
  | "type"
  | "namespace"
  | "decorator"
  | "unknown"

export interface CodeGraphNode {
  id: string
  type: NodeType
  symbolType?: SymbolType
  name: string
  filePath: string
  startLine: number
  endLine: number
  /** Byte offset in source (tree-sitter native) */
  startByte: number
  /** Byte offset in source (tree-sitter native) */
  endByte: number
  /** Starting token index for the configured tokenizer */
  startToken: number
  /** Ending token index for the configured tokenizer */
  endToken: number
  /** Tokenizer name used for token indexing (e.g. "cl100k_base", "qwen2.5") */
  tokenizerName: string
  metadata: SymbolMetadata | FileMetadata | ModuleMetadata
  mtime: number
}

export interface TokenPosition {
  startToken: number
  endToken: number
  tokenizerName: string
}

export interface SignatureHash {
  /** SHA-256 of parameter names + types + return type */
  hash: string
  /** The source text that was hashed */
  source: string
}

export interface ContentHash {
  /** SHA-256 of the full entity body source */
  hash: string
  /** The source text that was hashed */
  source: string
}

export interface SymbolMetadata {
  visibility?: "public" | "private" | "protected" | "internal"
  isAsync?: boolean
  isStatic?: boolean
  isAbstract?: boolean
  isExported?: boolean
  isDefault?: boolean
  returnType?: string
  parameters?: Array<{ name: string; type: string; optional?: boolean }>
  typeParams?: string[]
  docComment?: string
  parentId?: string
  /** Token range of the enclosing scope [startToken, endToken] */
  scopeRange?: [number, number]
  /** SHA-256 of the parameter list + return type */
  signatureHash?: string
  /** SHA-256 of the full entity body (for incremental change detection) */
  contentHash?: string
}

export interface FileMetadata {
  language: string
  size: number
  imports: Array<{ source: string; names: string[] }>
  exports: string[]
  /** SHA-256 of the full file content (for incremental change detection) */
  contentHash?: string
}

export interface ModuleMetadata {
  childFiles: string[]
  childModules: string[]
}

export type EdgeRelation =
  | "calls"
  | "called_by"
  | "extends"
  | "implements"
  | "contains"
  | "imports"
  | "references"
  | "defines"
  | "exports"
  | "decorates"
  | "overrides"
  | "overridden_by"
  | "type_uses"
  | "data_flow"
  | "test_covers"

export interface CodeGraphEdge {
  sourceId: string
  targetId: string
  relation: EdgeRelation
  weight?: number
  sourceLoc?: { startLine: number; endLine: number }
}

/** Relations that are auto-generated as reverse/bidirectional edges */
export const REVERSE_RELATIONS: Record<string, string> = {
  calls: "called_by",
  overrides: "overridden_by",
}

/**
 * CallSite — precise call location with token-level precision.
 * Records where a function/method is called, including argument info
 * for signature compatibility checking.
 */
export interface CallSite {
  id: string
  /** Entity ID of the caller function/method */
  callerId: string
  /** The symbol name being called (e.g. "authenticate") */
  calleeName: string
  /** Resolved entity ID of the callee (may be empty for dynamic calls) */
  calleeId: string
  /** File path where the call occurs */
  filePath: string
  /** Byte range in source */
  startByte: number
  endByte: number
  /** Token range for the configured tokenizer */
  startToken: number
  endToken: number
  /** Line range for human readability */
  startLine: number
  endLine: number
  /** Argument info for signature checking */
  argCount: number
  keywordArgs: string[]
  hasStarArgs: boolean
  hasKwargs: boolean
  /** Tokenizer used */
  tokenizerName: string
}

/**
 * StaleMarker — tracks entities affected by an incremental edit.
 * Used by the incremental parsing state machine.
 */
export interface StaleMarker {
  /** Entity ID marked as stale */
  entityId: string
  /** Byte range of the edited region that caused this staleness */
  editRange: [number, number]
  /** Timestamp when marked */
  markedAt: number
  /** Whether 1-hop neighbors were also marked */
  neighborsMarked: boolean
}

/**
 * Incremental parse result after re-parsing a stale file region.
 */
export interface IncrementalParseResult {
  /** New/updated entities from the re-parsed region */
  entities: CodeGraphNode[]
  /** New/updated call sites */
  callSites: CallSite[]
  /** Entities that were removed (no longer exist in the source) */
  removedEntityIds: string[]
  /** Stale markers that were resolved */
  resolvedMarkers: StaleMarker[]
  /** The edit range that triggered this re-parse */
  editRange: [number, number]
}

/**
 * Impact analysis query result.
 */
export interface ImpactResult {
  /** The primary entity being analyzed */
  primaryEntityId: string
  /** Risk score (0.0 to 1.0) */
  riskScore: number
  /** Direct callers (1-hop) */
  directCallers: CodeGraphNode[]
  /** Transitive callers (2+ hops) */
  transitiveCallers: CodeGraphNode[]
  /** Files that would be affected */
  affectedFiles: string[]
  /** Tests that cover the affected code */
  affectedTests: CodeGraphNode[]
  /** Signature break details */
  signatureBreaks: SignatureBreak[]
  /** Impact chains (paths from primary to affected) */
  impactChains: ImpactChain[]
  /** Whether the entity is a public API (no underscore prefix) */
  isPublicApi: boolean
}

export interface SignatureBreak {
  /** The call site where the break occurs */
  callSiteId: string
  /** Entity that will break */
  entityId: string
  /** Reason for the break */
  reason: string
  /** File + line location */
  location: { filePath: string; startLine: number; endLine: number }
}

export interface ImpactChain {
  /** Depth from primary entity */
  depth: number
  /** Chain of entity IDs from primary to affected */
  path: string[]
  /** Type of impact at each step */
  impactType: "signature_mismatch" | "behavioral_change" | "type_change" | "deletion"
  /** Confidence of this impact chain (0.0 to 1.0) */
  confidence: number
}

export interface SubGraph {
  nodes: CodeGraphNode[]
  edges: CodeGraphEdge[]
  centerId?: string
  estimatedTokens: number
}

export interface CodeGraphConfig {
  rootDir: string
  include?: string[]
  exclude?: string[]
  maxFiles?: number
  enableGitAware?: boolean
  languages?: string[]
  persistToDb?: boolean
  /** Directory for persistent storage (defaults to rootDir/.codegraph) */
  persistDir?: string
  /** Tokenizer name for token-level indexing */
  tokenizerName?: string
  /** Maximum depth for transitive impact analysis */
  maxImpactDepth?: number
}

export const DEFAULT_CODEGRAPH_CONFIG: Partial<CodeGraphConfig> = {
  include: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.mjs"],
  exclude: ["**/node_modules/**", "**/dist/**", "**/.git/**", "**/build/**"],
  maxFiles: 0,
  enableGitAware: false,
  languages: ["typescript", "javascript"],
  persistToDb: false,
  tokenizerName: "simple",
  maxImpactDepth: 3,
}

export interface SearchOptions {
  maxResults?: number
  kHop?: number
  includeDocComments?: boolean
  includeSourceCode?: boolean
  contextLines?: number
}

export interface SearchResult {
  node: CodeGraphNode
  score: number
  matchedOn: "name" | "type" | "file" | "doc_comment" | "full_text"
  context?: SubGraph
}

export interface RankedNode {
  node: CodeGraphNode
  pageRank: number
  centrality: number
  changeFrequency?: number
  compositeScore: number
}

export interface RankingConfig {
  dampingFactor?: number
  maxIterations?: number
  convergenceThreshold?: number
  enableFileHotness?: boolean
  gitCommitWindow?: number
}

export const DEFAULT_RANKING_CONFIG: RankingConfig = {
  dampingFactor: 0.85,
  maxIterations: 100,
  convergenceThreshold: 0.0001,
  enableFileHotness: false,
  gitCommitWindow: 100,
}

export interface BuildEvent {
  type: "discover" | "extract" | "relate" | "index" | "complete" | "error"
  phase: string
  file?: string
  nodeCount?: number
  edgeCount?: number
  durationMs?: number
  message?: string
}

export type BuildObserver = (event: BuildEvent) => void
