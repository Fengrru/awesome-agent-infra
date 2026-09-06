import type { SqliteDb } from "./db.js"
import {
  type KnowledgeKind,
  type KnowledgeObject,
  type KnowledgeState,
  type NewKnowledgeObject,
  type VerificationStatus,
  contentHash,
  isKnowledgeKind,
  isKnowledgeState,
  isProvenanceSource,
  isVerificationStatus,
  parseCheck,
  parseRef,
} from "./schema.js"

export interface SelfStore {
  add(name: string, obj: NewKnowledgeObject): KnowledgeObject
  get(kind: KnowledgeKind, name: string): KnowledgeObject | null
  findById(id: string): KnowledgeObject | null
  history(kind: KnowledgeKind, name: string): KnowledgeObject[]
  all(): KnowledgeObject[]
  latest(): KnowledgeObject[]
  // Newest non-draft version per entry: the only view safe for injection.
  latestTrusted(): KnowledgeObject[]
  touch(kind: KnowledgeKind, name: string): void
  recordOutcome(kind: KnowledgeKind, name: string, ok: boolean): void
  setVerification(kind: KnowledgeKind, name: string, status: VerificationStatus, lastVerifiedAt: number): void
  setState(kind: KnowledgeKind, name: string, state: KnowledgeState): void
  // Knowledge ids that declare a derivation edge to the given upstream id.
  dependentsOf(upstreamId: string): string[]
}

/** A persisted row that fails schema validation is surfaced loudly */
export class DataCorruptionError extends Error {
  readonly rowId: string

  constructor(rowId: string, detail: string) {
    super(`knowledge row ${rowId} is corrupt: ${detail}`)
    this.rowId = rowId
  }
}

interface Row {
  id: string
  name: string
  kind: string
  version: number
  parent_id: string | null
  content: string
  source: string
  refs: string
  evidence: string
  verification_status: string
  verification_check: string | null
  last_verified_at: number | null
  ttl: number | null
  state: string
  uses: number
  successes: number
  last_used_at: number | null
  created: number
}

function isNumber(value: unknown): value is number {
  return typeof value === "number"
}

function isOptionalNumber(value: unknown): value is number | null | undefined {
  return value === null || value === undefined || isNumber(value)
}

function mustParseJSON<T>(raw: string, label: string, rowId: string): T {
  try {
    return JSON.parse(raw) as T
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    throw new DataCorruptionError(rowId, `${label} is not valid JSON (${detail})`)
  }
}

function rowToObject(r: Row): KnowledgeObject {
  if (!isKnowledgeKind(r.kind)) throw new DataCorruptionError(r.id, `unknown kind ${r.kind}`)
  if (!isKnowledgeState(r.state)) throw new DataCorruptionError(r.id, `unknown state ${r.state}`)
  if (!isVerificationStatus(r.verification_status)) {
    throw new DataCorruptionError(r.id, `unknown verification status ${r.verification_status}`)
  }
  if (!isProvenanceSource(r.source)) throw new DataCorruptionError(r.id, `unknown source ${r.source}`)
  if (!isNumber(r.version)) throw new DataCorruptionError(r.id, "version is not a number")
  if (!isNumber(r.uses)) throw new DataCorruptionError(r.id, "uses is not a number")
  if (!isNumber(r.successes)) throw new DataCorruptionError(r.id, "successes is not a number")
  if (!isNumber(r.created)) throw new DataCorruptionError(r.id, "created is not a number")

  const content = mustParseJSON<unknown>(r.content, "content", r.id)
  const evidence = mustParseJSON<unknown[]>(r.evidence, "evidence", r.id)
  if (!Array.isArray(evidence) || !evidence.every(isString)) {
    throw new DataCorruptionError(r.id, "evidence is not an array of strings")
  }

  const refsRaw = mustParseJSON<unknown[]>(r.refs, "refs", r.id)
  if (!Array.isArray(refsRaw)) throw new DataCorruptionError(r.id, "refs is not an array")
  const refs: Array<{ knowledgeId?: string }> = []
  for (const [i, raw] of refsRaw.entries()) {
    const ref = parseRef(raw)
    if (ref === null) throw new DataCorruptionError(r.id, `refs[${i}] malformed`)
    refs.push(ref)
  }

  let check: { type: "command"; cmd: string } | { type: "assert"; expr: string } | null = null
  if (r.verification_check !== null) {
    const parsed = parseCheck(JSON.parse(r.verification_check))
    if (parsed === null) throw new DataCorruptionError(r.id, "verification check malformed")
    check = parsed
  }

  if (!isOptionalNumber(r.ttl) || !isOptionalNumber(r.last_verified_at) || !isOptionalNumber(r.last_used_at)) {
    throw new DataCorruptionError(r.id, "numeric/null field has wrong type")
  }

  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    version: r.version,
    parentId: r.parent_id,
    content,
    provenance: { source: r.source, refs, created: r.created },
    evidence,
    verification: { status: r.verification_status, check, lastVerifiedAt: r.last_verified_at },
    ttl: r.ttl,
    state: r.state,
    metrics: { uses: r.uses, successes: r.successes, lastUsedAt: r.last_used_at },
  }
}

function isString(value: unknown): value is string {
  return typeof value === "string"
}

export class SqliteSelfStore implements SelfStore {
  private readonly db: SqliteDb

  constructor(db: SqliteDb) {
    this.db = db
    db.run(`
      CREATE TABLE IF NOT EXISTS knowledge (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        version INTEGER NOT NULL,
        parent_id TEXT,
        content TEXT NOT NULL,
        source TEXT NOT NULL,
        refs TEXT NOT NULL,
        evidence TEXT NOT NULL,
        verification_status TEXT NOT NULL,
        verification_check TEXT,
        last_verified_at INTEGER,
        ttl INTEGER,
        state TEXT NOT NULL,
        uses INTEGER NOT NULL DEFAULT 0,
        successes INTEGER NOT NULL DEFAULT 0,
        last_used_at INTEGER,
        created INTEGER NOT NULL
      )
    `)
    db.run("CREATE INDEX IF NOT EXISTS knowledge_name_version ON knowledge(kind, name, version DESC)")
    db.run(`
      CREATE TABLE IF NOT EXISTS knowledge_deps (
        dependent_id TEXT NOT NULL,
        upstream_id TEXT NOT NULL,
        PRIMARY KEY (dependent_id, upstream_id)
      )
    `)
    try {
      db.run("CREATE UNIQUE INDEX IF NOT EXISTS knowledge_kind_name_version ON knowledge(kind, name, version)")
    } catch (e) {
      console.warn(`(knowledge store: could not create unique index: ${e instanceof Error ? e.message : String(e)})`)
    }
  }

  add(name: string, obj: NewKnowledgeObject): KnowledgeObject {
    const id = contentHash({ name, kind: obj.kind, content: obj.content })
    const insert = this.db.transaction((record: KnowledgeObject) => {
      const current = this.get(record.kind, record.name)

      // Idempotent: re-adding identical content is a no-op.
      if (current && current.id === record.id) return current

      const version = current ? current.version + 1 : 1
      const parentId = current ? current.id : null
      const withVersion: KnowledgeObject = { ...record, version, parentId }

      this.db
        .query(
          `INSERT INTO knowledge (
            id, name, kind, version, parent_id, content, source, refs, evidence,
            verification_status, verification_check, last_verified_at, ttl, state,
            uses, successes, last_used_at, created
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          withVersion.id,
          withVersion.name,
          withVersion.kind,
          withVersion.version,
          withVersion.parentId,
          JSON.stringify(withVersion.content),
          withVersion.provenance.source,
          JSON.stringify(withVersion.provenance.refs),
          JSON.stringify(withVersion.evidence),
          withVersion.verification.status,
          withVersion.verification.check ? JSON.stringify(withVersion.verification.check) : null,
          withVersion.verification.lastVerifiedAt,
          withVersion.ttl,
          withVersion.state,
          withVersion.metrics.uses,
          withVersion.metrics.successes,
          withVersion.metrics.lastUsedAt,
          withVersion.provenance.created,
        )

      // Derivation edges belong to the version that declares them.
      if (current) this.db.query("DELETE FROM knowledge_deps WHERE dependent_id = ?").run(current.id)

      for (const ref of record.provenance.refs) {
        if (ref.knowledgeId === undefined) continue
        this.db
          .query("INSERT OR REPLACE INTO knowledge_deps (dependent_id, upstream_id) VALUES (?, ?)")
          .run(withVersion.id, ref.knowledgeId)
      }

      return withVersion
    })

    return insert({ ...obj, id, name, version: 0, parentId: null })
  }

  get(kind: KnowledgeKind, name: string): KnowledgeObject | null {
    const row = this.db
      .query("SELECT * FROM knowledge WHERE kind = ? AND name = ? ORDER BY version DESC LIMIT 1")
      .get(kind, name) as Row | undefined
    return row ? rowToObject(row) : null
  }

  findById(id: string): KnowledgeObject | null {
    const row = this.db.query("SELECT * FROM knowledge WHERE id = ?").get(id) as Row | undefined
    return row ? rowToObject(row) : null
  }

  dependentsOf(upstreamId: string): string[] {
    const rows = this.db
      .query("SELECT dependent_id FROM knowledge_deps WHERE upstream_id = ?")
      .all(upstreamId) as Array<{ dependent_id: string }>
    return rows.map((r) => r.dependent_id)
  }

  history(kind: KnowledgeKind, name: string): KnowledgeObject[] {
    const rows = this.db
      .query("SELECT * FROM knowledge WHERE kind = ? AND name = ? ORDER BY version DESC")
      .all(kind, name) as Row[]
    return rows.map(rowToObject)
  }

  all(): KnowledgeObject[] {
    const rows = this.db.query("SELECT * FROM knowledge ORDER BY kind ASC, name ASC, version DESC").all() as Row[]
    return rows.map(rowToObject)
  }

  latest(): KnowledgeObject[] {
    const rows = this.db
      .query(
        "SELECT * FROM knowledge WHERE version = (SELECT MAX(version) FROM knowledge k2 WHERE k2.kind = knowledge.kind AND k2.name = knowledge.name) ORDER BY kind ASC, name ASC",
      )
      .all() as Row[]
    return rows.map(rowToObject)
  }

  latestTrusted(): KnowledgeObject[] {
    const rows = this.db
      .query(
        `SELECT * FROM knowledge k1
         WHERE k1.state != 'draft'
           AND k1.version = (SELECT MAX(k2.version) FROM knowledge k2 WHERE k2.kind = k1.kind AND k2.name = k1.name AND k2.state != 'draft')
         ORDER BY k1.kind ASC, k1.name ASC`,
      )
      .all() as Row[]
    return rows.map(rowToObject)
  }

  touch(kind: KnowledgeKind, name: string): void {
    this.db
      .query(
        "UPDATE knowledge SET uses = uses + 1, last_used_at = ? WHERE kind = ? AND name = ? AND version = (SELECT MAX(version) FROM knowledge WHERE kind = ? AND name = ?)",
      )
      .run(Date.now(), kind, name, kind, name)
  }

  recordOutcome(kind: KnowledgeKind, name: string, ok: boolean): void {
    const current = this.get(kind, name)
    if (!current) return
    this.db
      .query("UPDATE knowledge SET uses = uses + 1, successes = successes + ?, last_used_at = ? WHERE id = ?")
      .run(ok ? 1 : 0, Date.now(), current.id)
  }

  setVerification(kind: KnowledgeKind, name: string, status: VerificationStatus, lastVerifiedAt: number): void {
    const current = this.get(kind, name)
    if (!current) return
    this.db
      .query("UPDATE knowledge SET verification_status = ?, last_verified_at = ? WHERE id = ?")
      .run(status, lastVerifiedAt, current.id)
  }

  setState(kind: KnowledgeKind, name: string, state: KnowledgeState): void {
    const current = this.get(kind, name)
    if (!current) return
    this.db.query("UPDATE knowledge SET state = ? WHERE id = ?").run(state, current.id)
  }
}
