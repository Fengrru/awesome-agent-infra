/**
 * CodeGraph Type Definitions
 *
 * Data models for the codebase-level heterogeneous graph:
 * symbols, files, modules as nodes; call, extend, implement, contain,
 * import, reference as edges.
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
  metadata: SymbolMetadata | FileMetadata | ModuleMetadata
  mtime: number
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
}

export interface FileMetadata {
  language: string
  size: number
  imports: Array<{ source: string; names: string[] }>
  exports: string[]
}

export interface ModuleMetadata {
  childFiles: string[]
  childModules: string[]
}

export type EdgeRelation =
  | "calls"
  | "extends"
  | "implements"
  | "contains"
  | "imports"
  | "references"
  | "defines"
  | "exports"
  | "decorates"

export interface CodeGraphEdge {
  sourceId: string
  targetId: string
  relation: EdgeRelation
  weight?: number
  sourceLoc?: { startLine: number; endLine: number }
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
}

export const DEFAULT_CODEGRAPH_CONFIG: Partial<CodeGraphConfig> = {
  include: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.mjs"],
  exclude: ["**/node_modules/**", "**/dist/**", "**/.git/**", "**/build/**"],
  maxFiles: 0,
  enableGitAware: false,
  languages: ["typescript", "javascript"],
  persistToDb: true,
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
