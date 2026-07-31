/**
 * Zero-dependency micro-benchmark harness.
 *
 * `bun:bench` is unavailable on Bun 1.3.14 (Windows), so benchmarks use a
 * minimal harness built on `performance.now()`:
 *  1. warmup until ~100ms of work is done (JIT/caches)
 *  2. estimate per-iteration cost from 5 runs
 *  3. run an adaptive iteration count targeting `timeMs` (default 1000)
 *  4. report min/median/mean + ops/sec
 *
 * Usage in a `.bench.ts` file:
 *   import { bench, run } from "./bench-utils.ts"
 *   bench("name", () => { ... })
 *   await run()
 */
export interface BenchResult {
  name: string
  iterations: number
  totalMs: number
  meanMs: number
  medianMs: number
  minMs: number
  maxMs: number
  opsPerSec: number
}

export interface BenchOptions {
  /** Target measurement duration in ms (default 1000). */
  timeMs?: number
  /** Minimum iterations per benchmark (default 10). */
  minIterations?: number
  /** Maximum iterations per benchmark (default 1_000_000). */
  maxIterations?: number
}

interface PendingBench {
  name: string
  fn: () => void | Promise<void>
  options: BenchOptions
}

const results: BenchResult[] = []
const pending: PendingBench[] = []

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length)
}

function formatOps(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}k`
  return n.toFixed(2)
}

async function measure(name: string, fn: () => void | Promise<void>, options: BenchOptions): Promise<void> {
  const { timeMs = 1000, minIterations = 10, maxIterations = 1_000_000 } = options

  // Warmup: fill caches and let the JIT settle
  const warmStart = performance.now()
  while (performance.now() - warmStart < 100) {
    await fn()
  }

  // Estimate per-iteration cost
  const estStart = performance.now()
  const estimateRuns = 5
  for (let i = 0; i < estimateRuns; i++) await fn()
  const estimateMs = (performance.now() - estStart) / estimateRuns

  const iterations = Math.min(maxIterations, Math.max(minIterations, Math.ceil(timeMs / Math.max(estimateMs, 0.001))))

  // Measure
  const samples: number[] = []
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now()
    await fn()
    samples.push(performance.now() - t0)
  }

  samples.sort((a, b) => a - b)
  const totalMs = samples.reduce((a, b) => a + b, 0)
  results.push({
    name,
    iterations,
    totalMs,
    meanMs: totalMs / iterations,
    medianMs: samples[Math.floor(samples.length / 2)] ?? 0,
    minMs: samples[0] ?? 0,
    maxMs: samples[samples.length - 1] ?? 0,
    opsPerSec: 1000 / (totalMs / iterations),
  })
}

/** Register a benchmark. Runs when {@link run} is called (same semantics as `bun:bench`). */
export function bench(name: string, fn: () => void | Promise<void>, options: BenchOptions = {}): void {
  pending.push({ name, fn, options })
}

export async function run(): Promise<void> {
  for (const item of pending.splice(0)) {
    await measure(item.name, item.fn, item.options)
  }
  if (results.length === 0) return
  const width = Math.max(...results.map((r) => r.name.length), 24)
  const lines: string[] = []
  lines.push(`${pad("benchmark", width)}  iterations   median ms    mean ms     ops/sec`)
  for (const r of results) {
    lines.push(
      `${pad(r.name, width)}  ${pad(String(r.iterations), 10)}  ${pad(r.medianMs.toFixed(4), 10)}  ${pad(r.meanMs.toFixed(4), 10)}  ${formatOps(r.opsPerSec)}`,
    )
  }
  console.log(lines.join("\n"))
  results.length = 0
}
