# Benchmarks

Micro-benchmarks for the core `@fengru/*` packages. Each benchmark imports the
package **source directly** (`../packages/<name>/src/index.ts`) — no build step,
measuring the exact code that ships.

## Why a custom harness?

Bun 1.3.14 does not ship a `bun:bench` module (nor a `bun bench` CLI command),
so `benchmarks/bench-utils.ts` is a ~100-line zero-dependency harness built on
`performance.now()`:

1. **Warmup** — run until ~100ms of work is done (JIT, caches)
2. **Estimate** — per-iteration cost from 5 runs
3. **Measure** — adaptive iteration count targeting 1000ms
4. **Report** — iterations, min/median/mean latency, ops/sec

Prefer the **median** column: rare GC pauses inflate the mean, while the median
reflects steady-state throughput. Benchmarks that intentionally exercise
worst-case paths (e.g. the Levenshtein fallback in `fuzzy-patch`) cap their
iteration count and are labeled as such.

## Running

```bash
bun run-all.ts                 # from benchmarks/ — runs everything
bun fuzzy-patch.bench.ts       # single benchmark
bunx tsc --noEmit -p tsconfig.json   # type-check
```

`bun bench` (Bun 1.3.14) does not exist — the `bench` script in
`benchmarks/package.json` maps to `bun run-all.ts`.

## Baseline (Bun 1.3.14, Windows, 2026-07)

| benchmark | median | ops/sec |
| --- | --- | --- |
| fuzzy-patch: exact match (60KB) | 0.0002 ms | 4.0M |
| fuzzy-patch: whitespace-normalized | 0.0002 ms | 4.1M |
| fuzzy-patch: levenshtein fallback | ~1335 ms | ~0.7 |
| event-bus: publish normal (batched) | 0.0002 ms | 3.3M |
| event-bus: publish critical (immediate) | 0.0004 ms | 1.9M |
| event-bus: publish + persistence | 0.0015 ms | 462k |
| embedding: add + remove document | 0.073 ms | 12.3k |
| embedding: search top-10 (300 docs) | 2.83 ms | 335 |
| embedding: cosine similarity | 0.0074 ms | 111k |
| codegraph: symbol search | 0.0029 ms | 236k |
| agent-memory: assemble context (300 L3) | 2.02 ms | 430 |
| agent-memory: upsert L3 memory | 0.0017 ms | 593k |
| confidence-gate: fit (500 samples) | 1.79 ms | 577 |
| confidence-gate: calibrate single | 0.0002 ms | 5.2M |
| worker: single task dispatch | 0.003 ms | 2.4k |
| worker: 20 tasks parallel (conc. 4) | 0.044 ms | 1.4k |
| worker: 20 tasks sequential | 0.033 ms | 22.9k |
| txn-fs: begin (10 files) | 0.010 ms | 72.5k |
| txn-fs: begin + propose + commit | 0.032 ms | 22.9k |
| txn-fs: three-way merge | 0.0002 ms | 5.4M |

Numbers are machine-specific — treat them as a relative signal, not an
absolute spec. CI runs the suite as a smoke check (any regression that makes a
benchmark crash or hang fails the job); the numbers themselves are not gated.

## Adding a benchmark

```ts
import { bench, run } from "./bench-utils.ts"

bench("my operation", () => {
  // code under test
})

await run()
```

Save as `benchmarks/<name>.bench.ts` and add it to `run-all.ts`.
