# Changelog

## 0.2.0 — Seed extraction

Extract Seed demo primitives into reusable `@fengrru/*` packages and migrate the demo to consume them.

- New packages extracted from the former standalone `seed` project:
  - `@fengrru/evidence-log`: content-addressed append-only event log with evidence verification.
  - `@fengrru/knowledge-vault`: versioned knowledge store with derivation edges and verification states.
  - `@fengrru/history-compact`: deterministic history compaction for agent event logs.
  - `@fengrru/retrieval-feedback`: usage-based retrieval signals (`isExpired`, `injectable`, `usageFactor`).
  - `@fengrru/mcp-client`: stdio and streamable-HTTP MCP clients with JSON-RPC tooling.
- The `self-hosted-agent` demo now consumes these workspace packages through facade files.
- Demo environment variables renamed from `SEED_*` to `AGENT_*`; legacy `SEED_*` names are still accepted as fallbacks.
- Demo CLI output, worktree prefix, and benchmark system renamed from "seed" to "self-hosted".
- Tightened `knowledge-vault` `setVerification`/`setState` parameter types from `string` to `VerificationStatus`/`KnowledgeState`.
