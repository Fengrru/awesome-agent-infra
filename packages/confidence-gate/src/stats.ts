/**
 * Statistics helpers — mean, variance, Pearson and Spearman correlation.
 * @module confidence-gate/stats
 */

export function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

export function variance(values: number[], mu?: number): number {
  if (values.length < 2) return 0
  const m = mu ?? mean(values)
  return values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1)
}

function cov(xs: number[], ys: number[], mx?: number, my?: number): number {
  if (xs.length !== ys.length || xs.length < 2) return 0
  const mx_ = mx ?? mean(xs)
  const my_ = my ?? mean(ys)
  let c = 0
  for (let i = 0; i < xs.length; i++) c += (xs[i] - mx_) * (ys[i] - my_)
  return c / (xs.length - 1)
}

export function pearsonR(xs: number[], ys: number[]): number {
  const vx = variance(xs)
  const vy = variance(ys)
  if (vx === 0 || vy === 0) return 0
  return cov(xs, ys) / Math.sqrt(vx * vy)
}

/**
 * Compute Spearman's rank correlation coefficient.
 *
 * Spearman ρ measures monotonic relationship between two variables.
 * Empirically more robust than Pearson for calibration evaluation
 * (handles non-linear confidence-accuracy relationships).
 */
export function spearmanR(xs: number[], ys: number[]): number {
  if (xs.length < 2) return 0

  // Assign ranks to xs (with average rank for ties)
  const xRanks = rank(xs)
  const yRanks = rank(ys)

  return pearsonR(xRanks, yRanks)
}

/** Assign ranks with average-rank tie breaking. */
function rank(values: number[]): number[] {
  const indexed = values.map((v, i) => ({ v, i }))
  indexed.sort((a, b) => a.v - b.v)

  const ranks = new Array<number>(values.length)
  let j = 0
  while (j < indexed.length) {
    let k = j
    while (k < indexed.length && indexed[k]!.v === indexed[j]!.v) k++
    const avgRank = (j + k + 1) / 2 // 1-based average rank
    for (let m = j; m < k; m++) ranks[indexed[m]!.i] = avgRank
    j = k
  }
  return ranks
}
