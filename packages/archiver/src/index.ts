/**
 * @fengru/archiver — Event Archiver with Hot/Cold Tiering
 *
 * Manages event archiving with hot/cold tiering. When the number of hot
 * events exceeds maxHotEvents (default 10000), events are archived to
 * cold storage (disk). Supports optional gzip compression.
 *
 * Design:
 *   - ArchiveConfig controls threshold, storage directory, compression
 *   - ArchiveDatabase interface for persistence layer (injectable)
 *   - EventArchiver orchestrates: shouldArchive, archive, loadArchive
 *   - Optional gzip compression via node:zlib
 *   - Falls back to uncompressed JSON when gzip is unavailable
 *
 * Depends on Node.js fs/promises and zlib for file operations.
 *
 * @module archiver
 */

import * as fs from "node:fs/promises"
import * as path from "node:path"
import { gunzipSync, gzipSync } from "node:zlib"

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface ArchiveConfig {
  maxHotEvents: number
  storageDir: string
  compress: boolean
  coldPrefix: string
  /**
   * Custom synchronous compression function used when `compress` is enabled.
   * Return `null` (or throw) to fall back to uncompressed JSON.
   * Defaults to `gzipSync` from `node:zlib`.
   */
  gzipFn?: (data: Uint8Array) => Uint8Array | Buffer | null
}

export const DEFAULT_ARCHIVE_CONFIG: ArchiveConfig = {
  maxHotEvents: 10_000,
  storageDir: "./archives",
  compress: false,
  coldPrefix: "cold_",
}

export interface ArchiveResult {
  archiveId: string
  eventCount: number
  filePath: string
  compressed: boolean
  archivedAt: number
  byteSize: number
}

export interface ArchiveDatabase {
  getEventCount(): Promise<number>
  getEventsOlderThan(timestamp: number, limit: number): Promise<Record<string, unknown>[]>
  deleteEventsByIds(ids: string[]): Promise<number>
  getArchivedEvents(archiveId: string): Promise<Record<string, unknown>[]>
}

// ── Gzip Helpers (node:zlib, works on Node and Bun) ─────────────────────────────────────

function tryGunzipSync(data: Buffer | Uint8Array): Buffer | null {
  try {
    return gunzipSync(data)
  } catch {
    return null
  }
}

// ── EventArchiver ───────────────────────────────────────────────────────────

export class EventArchiver {
  readonly config: ArchiveConfig
  private database: ArchiveDatabase | null = null

  constructor(config?: Partial<ArchiveConfig>) {
    this.config = { ...DEFAULT_ARCHIVE_CONFIG, ...config }
  }

  setDatabase(db: ArchiveDatabase): void {
    this.database = db
  }

  async shouldArchive(): Promise<boolean> {
    if (!this.database) return false
    const count = await this.database.getEventCount()
    return count >= this.config.maxHotEvents
  }

  async archive(timestamp?: number): Promise<ArchiveResult | null> {
    if (!this.database) return null

    const count = await this.database.getEventCount()
    if (count === 0) return null

    const cutoff = timestamp ?? Date.now() - 7 * 24 * 60 * 60 * 1000 // default: 7 days old
    const events = await this.database.getEventsOlderThan(cutoff, this.config.maxHotEvents)

    if (events.length === 0) return null

    const archiveId = `${this.config.coldPrefix}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const jsonData = JSON.stringify(events)
    const buf = Buffer.from(jsonData, "utf-8")

    // Try compression if enabled (custom gzipFn may be injected for testing)
    let compressed: Uint8Array | Buffer | null = null
    if (this.config.compress) {
      const fn = this.config.gzipFn ?? gzipSync
      try {
        compressed = fn(buf) ?? null
      } catch {
        compressed = null
      }
    }
    const fileData = compressed ?? buf
    const ext = compressed ? ".json.gz" : ".json"
    const fileName = `${archiveId}${ext}`
    const filePath = path.join(this.config.storageDir, fileName)

    await fs.mkdir(this.config.storageDir, { recursive: true })
    await fs.writeFile(filePath, fileData)

    // Delete events from hot storage
    const ids = events.map((e) => e.eventId ?? e.id ?? "").filter(Boolean) as string[]
    if (ids.length > 0) {
      await this.database.deleteEventsByIds(ids)
    }

    return {
      archiveId,
      eventCount: events.length,
      filePath,
      compressed: compressed !== null,
      archivedAt: Date.now(),
      byteSize: fileData.byteLength,
    }
  }

  async loadArchive(archiveId: string): Promise<Record<string, unknown>[]> {
    const jsonPath = path.join(this.config.storageDir, `${archiveId}.json`)
    const gzPath = path.join(this.config.storageDir, `${archiveId}.json.gz`)

    let fileData: Buffer
    let isCompressed = false

    try {
      fileData = await fs.readFile(gzPath)
      isCompressed = true
    } catch {
      try {
        fileData = await fs.readFile(jsonPath)
      } catch {
        // Fallback to database if available
        if (this.database) {
          try {
            return await this.database.getArchivedEvents(archiveId)
          } catch {
            return []
          }
        }
        return []
      }
    }

    // Try decompression if the file was read from .json.gz
    if (isCompressed) {
      const decompressed = tryGunzipSync(fileData)
      if (decompressed) {
        fileData = decompressed
      }
    }

    const text = fileData.toString("utf-8")
    try {
      const parsed = JSON.parse(text)
      return Array.isArray(parsed) ? parsed : [parsed]
    } catch {
      return []
    }
  }

  async shouldCompress(eventCount: number): Promise<boolean> {
    return this.config.compress && eventCount > 1000
  }

  async listArchives(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.config.storageDir)
      const archives = new Set<string>()

      for (const entry of entries) {
        if (entry.startsWith(this.config.coldPrefix)) {
          const id = entry.replace(/\.json(\.gz)?$/, "")
          archives.add(id)
        }
      }

      return [...archives].sort()
    } catch {
      return []
    }
  }
}

/**
 * Create a {@link EventArchiver} instance.
 *
 * @param args - Constructor arguments forwarded to {@link EventArchiver}.
 * @returns A new {@link EventArchiver}.
 */
export function createEventArchiver(...args: ConstructorParameters<typeof EventArchiver>): EventArchiver {
  return new EventArchiver(...args)
}
