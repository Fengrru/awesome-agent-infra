/**
 * CodeGraph Persistence Layer
 *
 * Persists the code graph and call site store to disk.
 * Uses JSON-based storage with WAL (write-ahead log) for
 * atomic writes. Zero runtime dependencies — uses only
 * node:fs and node:path built-ins.
 *
 * @module codegraph/persist
 */

import { writeFile, readFile, mkdir, unlink, rename, readdir } from "node:fs/promises"
import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import type { CodeGraphNode, CodeGraphEdge, CallSite } from "./types"

export interface PersistedGraph {
  version: number
  timestamp: number
  nodes: CodeGraphNode[]
  edges: CodeGraphEdge[]
  callSites: CallSite[]
}

const CURRENT_VERSION = 1

export class GraphPersistence {
  private persistDir: string
  private nodesFile: string
  private edgesFile: string
  private callSitesFile: string
  private walDir: string
  private initialized = false

  constructor(rootDir: string | undefined) {
    this.persistDir = rootDir ?? join(process.cwd(), ".codegraph")
    this.nodesFile = join(this.persistDir, "nodes.json")
    this.edgesFile = join(this.persistDir, "edges.json")
    this.callSitesFile = join(this.persistDir, "callsites.json")
    this.walDir = join(this.persistDir, "wal")
  }

  private ensureDir(): void {
    if (!existsSync(this.persistDir)) {
      mkdirSync(this.persistDir, { recursive: true })
    }
    if (!existsSync(this.walDir)) {
      mkdirSync(this.walDir, { recursive: true })
    }
    this.initialized = true
  }

  /**
   * Save the full graph to disk with WAL-based atomic writes.
   */
  async save(nodes: CodeGraphNode[], edges: CodeGraphEdge[], callSites: CallSite[]): Promise<void> {
    this.ensureDir()

    const timestamp = Date.now()
    const walId = `${timestamp}`

    const nodesData = JSON.stringify(nodes)
    const edgesData = JSON.stringify(edges)
    const callSitesData = JSON.stringify(callSites)

    const nodesWalFile = join(this.walDir, `nodes_${walId}.json`)
    const edgesWalFile = join(this.walDir, `edges_${walId}.json`)
    const callSitesWalFile = join(this.walDir, `callsites_${walId}.json`)

    await writeFile(nodesWalFile, nodesData, "utf-8")
    await writeFile(edgesWalFile, edgesData, "utf-8")
    await writeFile(callSitesWalFile, callSitesData, "utf-8")

    try {
      await rename(nodesWalFile, this.nodesFile)
    } catch { /* Windows may need unlink first */ }
    try {
      await rename(edgesWalFile, this.edgesFile)
    } catch { /* Windows may need unlink first */ }
    try {
      await rename(callSitesWalFile, this.callSitesFile)
    } catch { /* Windows may need unlink first */ }

    await this.cleanupWal()
  }

  /**
   * Save nodes only (incremental).
   */
  async saveNodes(nodes: CodeGraphNode[]): Promise<void> {
    this.ensureDir()
    const timestamp = Date.now()
    const walFile = join(this.walDir, `nodes_${timestamp}.json`)
    await writeFile(walFile, JSON.stringify(nodes), "utf-8")
    try { await rename(walFile, this.nodesFile) } catch {}
  }

  /**
   * Save edges only (incremental).
   */
  async saveEdges(edges: CodeGraphEdge[]): Promise<void> {
    this.ensureDir()
    const timestamp = Date.now()
    const walFile = join(this.walDir, `edges_${timestamp}.json`)
    await writeFile(walFile, JSON.stringify(edges), "utf-8")
    try { await rename(walFile, this.edgesFile) } catch {}
  }

  /**
   * Save call sites only (incremental).
   */
  async saveCallSites(callSites: CallSite[]): Promise<void> {
    this.ensureDir()
    const timestamp = Date.now()
    const walFile = join(this.walDir, `callsites_${timestamp}.json`)
    await writeFile(walFile, JSON.stringify(callSites), "utf-8")
    try { await rename(walFile, this.callSitesFile) } catch {}
  }

  /**
   * Load the full graph from disk.
   */
  async load(): Promise<PersistedGraph | null> {
    this.ensureDir()

    try {
      const [nodesRaw, edgesRaw, callSitesRaw] = await Promise.all([
        this.safeRead(this.nodesFile),
        this.safeRead(this.edgesFile),
        this.safeRead(this.callSitesFile),
      ])

      if (!nodesRaw && !edgesRaw) return null

      const nodes: CodeGraphNode[] = nodesRaw ? JSON.parse(nodesRaw) : []
      const edges: CodeGraphEdge[] = edgesRaw ? JSON.parse(edgesRaw) : []
      const callSites: CallSite[] = callSitesRaw ? JSON.parse(callSitesRaw) : []

      return {
        version: CURRENT_VERSION,
        timestamp: Date.now(),
        nodes,
        edges,
        callSites,
      }
    } catch {
      return null
    }
  }

  /**
   * Load nodes only.
   */
  async loadNodes(): Promise<CodeGraphNode[] | null> {
    this.ensureDir()
    const raw = await this.safeRead(this.nodesFile)
    if (!raw) return null
    try { return JSON.parse(raw) } catch { return null }
  }

  /**
   * Load edges only.
   */
  async loadEdges(): Promise<CodeGraphEdge[] | null> {
    this.ensureDir()
    const raw = await this.safeRead(this.edgesFile)
    if (!raw) return null
    try { return JSON.parse(raw) } catch { return null }
  }

  /**
   * Load call sites only.
   */
  async loadCallSites(): Promise<CallSite[] | null> {
    this.ensureDir()
    const raw = await this.safeRead(this.callSitesFile)
    if (!raw) return null
    try { return JSON.parse(raw) } catch { return null }
  }

  /** Check if persisted data exists */
  async hasPersistedData(): Promise<boolean> {
    return existsSync(this.nodesFile) || existsSync(this.edgesFile)
  }

  private async safeRead(filePath: string): Promise<string | null> {
    try {
      if (!existsSync(filePath)) return null
      return await readFile(filePath, "utf-8")
    } catch {
      return null
    }
  }

  private async cleanupWal(): Promise<void> {
    if (!existsSync(this.walDir)) return
    try {
      const entries = await readdir(this.walDir)
      const now = Date.now()
      for (const entry of entries) {
        const fullPath = join(this.walDir, entry)
        try {
          const stat = await import("node:fs/promises").then((m) => m.stat(fullPath))
          if ((now - stat.mtimeMs) > 60_000) {
            await unlink(fullPath)
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }
}
