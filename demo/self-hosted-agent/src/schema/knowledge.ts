// Facade: the knowledge schema now lives in the dependency-free
// @fengrru/knowledge-vault package (extracted from this demo). Re-exported here
// so the rest of the demo can keep importing from a stable local path.
export type {
  Check,
  KnowledgeKind,
  KnowledgeObject,
  KnowledgeState,
  Metrics,
  NewKnowledgeObject,
  Provenance,
  ProvenanceSource,
  Ref,
  Verification,
  VerificationStatus,
} from "@fengrru/knowledge-vault"
export { contentHash, stableStringify } from "@fengrru/knowledge-vault"
