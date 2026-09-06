/**
 * SQLite surface the knowledge vault needs. Like evidence-log, this package
 * never imports a specific driver; the caller supplies one. The interface is a
 * superset of evidence-log's `SqliteDb` because the vault uses explicit
 * transactions for version-chain integrity.
 */

export interface SqliteStatement {
  run(...params: unknown[]): unknown
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}

export interface SqliteDb {
  run(sql: string, ...params: unknown[]): unknown
  query(sql: string): SqliteStatement
  transaction<T>(fn: (arg: T) => T): (arg: T) => T
}
