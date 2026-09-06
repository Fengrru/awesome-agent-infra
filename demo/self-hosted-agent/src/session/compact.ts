import type { Event } from "@fengrru/evidence-log"
// Facade: deterministic history compaction now lives in the dependency-free
// @fengrru/history-compact package (extracted from this demo). Re-exported here
// so the rest of the demo and its tests keep importing from a stable path.
import { createPlanCompaction } from "@fengrru/history-compact"
export { DEFAULT_COMPACT_THRESHOLD, summarizeRound } from "@fengrru/history-compact"
export type { PlannedCompact } from "@fengrru/history-compact"
import { reconstructHistory } from "./history.js"

/**
 * Plan which completed rounds to fold so the reconstructed history fits under
 * the threshold. Uses the demo's own `reconstructHistory` renderer.
 */
export const planCompaction = createPlanCompaction(
  reconstructHistory as (
    events: Event[],
    options: { trustedCompacts: Set<string>; skipIds?: Set<string> },
  ) => unknown[],
)
