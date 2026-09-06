# @fengrru/retrieval-feedback

Zero-dependency retrieval filters and usage-based re-ranking for agent
knowledge. Extracted from the [seed self-hosted-agent](../../demo/self-hosted-agent/README.md)
project.

## Why

Any retrieval strategy eventually asks the same three questions:

- Is this entry still valid? (`isExpired`)
- Is it safe to inject as established truth? (`injectable`)
- Has using it actually helped? (`usageFactor`)

This package provides those shared signals so TF-IDF, dense embedding, keyword,
and hybrid rankers can all apply the same trust-and-feedback layer without
reinventing it.

## Usage

```ts
import { isExpired, injectable, usageFactor } from "@fengrru/retrieval-feedback"
import type { KnowledgeObject } from "@fengrru/knowledge-vault"

const scored = candidates
  .filter((o) => injectable(o) && !isExpired(o, Date.now()))
  .map((o) => ({ object: o, score: rawScore(o) * usageFactor(o) }))
  .sort((a, b) => b.score - a.score)
  .slice(0, limit)
```

## API

- `isExpired(obj, now)` — true when `created + ttl < now`.
- `injectable(obj)` — true for non-draft, non-stale/archived entries; skills must
  be verified.
- `usageFactor(obj)` — bounded multiplier based on `metrics.uses` and
  `metrics.successes`; healthy successes raise the score, failures lower it.
- `Retriever` — interface for a queryable knowledge source.

## License

MIT. Extracted from the MIT-licensed seed project.
