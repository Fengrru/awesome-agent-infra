// Facade: the content-addressed event log now lives in the dependency-free
// @fengrru/evidence-log package (extracted from this demo). Re-exported here
// so the rest of the demo and its tests keep importing from a stable path.
export type { EvidenceCheck, Log } from "@fengrru/evidence-log"
export { SqliteLog, validEvidenceIds } from "@fengrru/evidence-log"
