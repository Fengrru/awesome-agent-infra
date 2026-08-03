export type NoteTag = "discovery" | "error" | "decision" | "observation" | "general"

export interface NoteEntry {
  timestamp: number
  content: string
  tag: NoteTag
}

export interface NotesConfig {
  notesDir: string
  maxSizeChars?: number
}

interface FsModule {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>
  appendFile(path: string, data: string, options?: { encoding?: string }): Promise<void>
  readFile(path: string, options?: { encoding?: string }): Promise<string>
  writeFile(path: string, data: string, options?: { encoding?: string }): Promise<void>
  unlink(path: string): Promise<void>
}

interface PathModule {
  join(...paths: string[]): string
}

type Backend = "fs" | "memory"

interface Fallback {
  store: Map<string, NoteEntry[]>
  append(sessionId: string, entry: NoteEntry): void
  readAll(sessionId: string): NoteEntry[]
  clear(sessionId: string): void
  shouldCompact(sessionId: string, maxSizeChars: number): boolean
  deleteSession(sessionId: string): void
}

/**
 * Load the fs/path modules. Returns null when the filesystem backend is
 * unavailable — either because the imports failed, or because the
 * `NOTES_MANAGER_BACKEND=memory` environment variable explicitly forces the
 * in-memory fallback (useful in sandboxed/no-filesystem environments).
 */
async function loadFs(): Promise<{ fs: FsModule; path: PathModule } | null> {
  if (process.env.NOTES_MANAGER_BACKEND === "memory") {
    return null
  }
  try {
    const fs = (await import("node:fs/promises")) as unknown as FsModule
    const path = (await import("node:path")) as unknown as PathModule
    return { fs, path }
  } catch {
    return null
  }
}

function createFallback(): Fallback {
  const store = new Map<string, NoteEntry[]>()

  return {
    store,
    append(sessionId: string, entry: NoteEntry): void {
      const entries = store.get(sessionId)
      if (entries) {
        entries.push(entry)
      } else {
        store.set(sessionId, [entry])
      }
    },
    readAll(sessionId: string): NoteEntry[] {
      return store.get(sessionId) ?? []
    },
    clear(sessionId: string): void {
      store.delete(sessionId)
    },
    shouldCompact(sessionId: string, maxSizeChars: number): boolean {
      const entries = store.get(sessionId) ?? []
      const json = JSON.stringify(entries)
      return json.length > maxSizeChars
    },
    deleteSession(sessionId: string): void {
      store.delete(sessionId)
    },
  }
}

const DEFAULT_MAX_SIZE_CHARS = 50000

function emptyTagRecord(): Record<NoteTag, NoteEntry[]> {
  return { discovery: [], error: [], decision: [], observation: [], general: [] }
}

function parseJsonl(content: string): NoteEntry[] {
  return content
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as NoteEntry)
}

export class NotesManager {
  private config: Required<NotesConfig>
  private ready = false
  private initPromise: Promise<void>
  private backend: Backend = "memory"
  private fsModule: { fs: FsModule; path: PathModule } | null = null
  private fallback: Fallback | null = null

  constructor(config: NotesConfig) {
    this.config = {
      maxSizeChars: DEFAULT_MAX_SIZE_CHARS,
      ...config,
    }
    this.initPromise = this.initialize()
  }

  private async initialize(): Promise<void> {
    const loaded = await loadFs()
    if (loaded) {
      this.fsModule = loaded
      this.backend = "fs"
      await loaded.fs.mkdir(this.config.notesDir, { recursive: true })
    } else {
      this.fallback = createFallback()
      this.backend = "memory"
    }
    this.ready = true
  }

  private async ensureReady(): Promise<void> {
    if (!this.ready) {
      await this.initPromise
    }
  }

  private filePath(sessionId: string): string {
    if (this.fsModule) {
      return this.fsModule.path.join(this.config.notesDir, `${sessionId}.jsonl`)
    }
    return `${this.config.notesDir}/${sessionId}.jsonl`
  }

  async append(sessionId: string, content: string, tag: NoteTag = "general"): Promise<void> {
    await this.ensureReady()
    const entry: NoteEntry = { timestamp: Date.now(), content, tag }

    if (this.backend === "memory" && this.fallback) {
      this.fallback.append(sessionId, entry)
      return
    }

    const line = `${JSON.stringify(entry)}\n`
    await this.fsModule!.fs.appendFile(this.filePath(sessionId), line, { encoding: "utf-8" })
  }

  async readAll(sessionId: string): Promise<NoteEntry[]> {
    await this.ensureReady()

    if (this.backend === "memory" && this.fallback) {
      return [...this.fallback.readAll(sessionId)]
    }

    try {
      const content = await this.fsModule!.fs.readFile(this.filePath(sessionId), { encoding: "utf-8" })
      return parseJsonl(content)
    } catch {
      return []
    }
  }

  async readByTag(sessionId: string): Promise<Record<NoteTag, NoteEntry[]>> {
    const entries = await this.readAll(sessionId)
    const result = emptyTagRecord()
    for (const entry of entries) {
      result[entry.tag].push(entry)
    }
    return result
  }

  async clear(sessionId: string): Promise<void> {
    await this.ensureReady()

    if (this.backend === "memory" && this.fallback) {
      this.fallback.clear(sessionId)
      return
    }

    await this.fsModule!.fs.writeFile(this.filePath(sessionId), "", { encoding: "utf-8" })
  }

  async shouldCompact(sessionId: string): Promise<boolean> {
    await this.ensureReady()

    if (this.backend === "memory" && this.fallback) {
      return this.fallback.shouldCompact(sessionId, this.config.maxSizeChars)
    }

    try {
      const content = await this.fsModule!.fs.readFile(this.filePath(sessionId), { encoding: "utf-8" })
      return content.length > this.config.maxSizeChars
    } catch {
      return false
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.ensureReady()

    if (this.backend === "memory" && this.fallback) {
      this.fallback.deleteSession(sessionId)
      return
    }

    try {
      await this.fsModule!.fs.unlink(this.filePath(sessionId))
    } catch {
      // File doesn't exist or already deleted — no-op
    }
  }
}

/**
 * Create a {@link NotesManager} instance.
 *
 * @param args - Constructor arguments forwarded to {@link NotesManager}.
 * @returns A new {@link NotesManager}.
 */
export function createNotesManager(...args: ConstructorParameters<typeof NotesManager>): NotesManager {
  return new NotesManager(...args)
}
