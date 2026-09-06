// Facade: the event model now lives in the dependency-free
// @fengrru/evidence-log package (extracted from this demo). Re-exported here
// so the rest of the demo can keep importing from a stable local path.
export type {
  CompactEvent,
  ConsolidateEvent,
  DoneEvent,
  Event,
  EventType,
  HarvestEvent,
  PruneEvent,
  ResultEvent,
  StepEvent,
  StoppedReason,
  TaskEvent,
  TaskStatus,
  TurnEvent,
  VerdictEvent,
} from "@fengrru/evidence-log"
