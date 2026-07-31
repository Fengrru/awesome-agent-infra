/**
 * Run all micro-benchmarks sequentially.
 *
 * Dynamic imports await each module's top-level `run()` before loading the
 * next one — static imports would interleave module evaluation (ESM awaits)
 * and corrupt the shared harness state.
 *
 * Run: bun run-all.ts   (from benchmarks/) or  bun benchmarks/run-all.ts
 */
const MODULES = [
  "./fuzzy-patch.bench.ts",
  "./event-bus.bench.ts",
  "./embedding.bench.ts",
  "./codegraph.bench.ts",
  "./agent-memory.bench.ts",
  "./confidence-gate.bench.ts",
  "./worker.bench.ts",
  "./txn-fs.bench.ts",
] as const

for (const mod of MODULES) {
  await import(mod)
}

export {} // top-level await requires module context
