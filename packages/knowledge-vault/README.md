# @fengrru/knowledge-vault

Zero-dependency append-only knowledge vault for agents: version chains,
content-addressed ids, derivation edges, verification states, and usage
metrics.

Extracted from the [seed self-hosted-agent](../../demo/self-hosted-agent/README.md)
project; see `docs/` there for the surrounding design.

## Why

Agents that learn from their own runs need a store that is safe to read and
safe to inject from:

- **Version chains**: every update creates a new version linked to its parent
  (`parentId`), never mutates history.
- **Content-addressed**: the id of a version is the hash of `(name, kind,
  content)`. Re-adding identical content is idempotent (git-style).
- **Derivation edges**: `provenance.refs[].knowledgeId` records upstream
  dependencies. `dependentsOf(upstreamId)` makes cascade invalidation cheap.
- **Trust gate**: `latestTrusted()` omits entries whose newest version is still a
  draft, so unverified claims cannot overwrite established knowledge.
- **Verification + usage metrics**: statuses (`unverified`/`verified`/`failed`/`stale`),
  optional verification checks, and `uses/successes/lastUsedAt` for retrieval
  ranking.
- **Driver-free**: never imports a SQLite driver. Hand it a compatible object.

## Install

```sh
bun add @fengrru/knowledge-vault
```

## Usage

```ts
import { Database } from "bun:sqlite"
import { SqliteSelfStore } from "@fengrru/knowledge-vault"

const store = new SqliteSelfStore(new Database("agent.db"))

const obj = store.add("project:rules", {
  kind: "memory",
  content: "Always prefer explicit imports.",
  provenance: { source: "human", refs: [], created: Date.now() },
  evidence: ["evt-1"],
  verification: { status: "unverified", check: null, lastVerifiedAt: null },
  ttl: null,
  state: "draft",
  metrics: { uses: 0, successes: 0, lastUsedAt: null },
})

store.setVerification("memory", "project:rules", "verified", Date.now())
store.setState("memory", "project:rules", "active")

// Only non-draft latest versions are safe to inject.
console.log(store.latestTrusted())
```

## API

Public exports: `SqliteSelfStore`, `SelfStore`, `DataCorruptionError`,
`KnowledgeObject`, `NewKnowledgeObject`, `KnowledgeKind`, `KnowledgeState`,
`VerificationStatus`, `ProvenanceSource`, `Ref`, `Check`, `Verification`,
`Metrics`, `Provenance`, `contentHash`, `stableStringify`, plus the
`isX`/`parseX` runtime guards.

## License

MIT. Extracted from the MIT-licensed seed project.
