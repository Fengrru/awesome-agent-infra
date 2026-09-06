// Facade: the knowledge vault now lives in the dependency-free
// @fengrru/knowledge-vault package (extracted from this demo). Re-exported here
// so the rest of the demo and its tests keep importing from a stable path.
export type { SelfStore } from "@fengrru/knowledge-vault"
export { DataCorruptionError, SqliteSelfStore } from "@fengrru/knowledge-vault"
