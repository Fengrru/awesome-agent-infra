/**
 * txn-fs — transactional filesystem with conflict detection and 3-way merge.
 *
 * Run: bun run txn-fs.ts
 */
import { createGitTransactionManager } from "../packages/txn-fs/src/index.ts"

const mgr = createGitTransactionManager()
const baseline = "export const port = 3000\n"

// ── success path ──────────────────────────────────────────────────────────
const tx1 = mgr.begin("session-1", [{ path: "src/config.ts", content: baseline }])
mgr.propose("src/config.ts", "export const port = 8080\n")
// getCurrentContent returns the untouched workspace state -> no TOCTOU race
const ok = mgr.commit(tx1, () => baseline)
console.log("commit (clean workspace):", ok.status)

// ── conflict path ─────────────────────────────────────────────────────────
const tx2 = mgr.begin("session-2", [{ path: "src/config.ts", content: baseline }])
// someone else edited the workspace while we worked
const conflict = mgr.commit(tx2, () => "export const port = 9090\n")
console.log("commit (workspace drifted):", conflict.status, "-", conflict.reason)

// ── rollback path ─────────────────────────────────────────────────────────
const tx3 = mgr.begin("session-3", [{ path: "src/tmp.ts", content: "export const a = 1\n" }])
mgr.propose("src/tmp.ts", "export const a = 2\n")
mgr.rollback(tx3)
console.log("rollback status:", tx3.status)
