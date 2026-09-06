/**
 * Minimal SQLite surface used by the log. This deliberately mirrors the
 * bun:sqlite / better-sqlite3 call shapes so a real driver can be handed in
 * without an adapter, while the package itself stays free of any runtime
 * dependency on a specific driver.
 */

/** A prepared (or lazily prepared) statement handle */
export interface SqliteStatement {
  run(...params: unknown[]): unknown
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}

/** The database surface `SqliteLog` needs */
export interface SqliteDb {
  run(sql: string, ...params: unknown[]): unknown
  query(sql: string): SqliteStatement
}
