/**
 * Ebbinghaus forgetting curve utilities.
 * @module agent-metacog/ebbinghaus
 */

/**
 * Compute retention using the Ebbinghaus forgetting curve.
 *
 * R(t) = e^{-t / τ}
 *
 * where τ is the decay constant derived from half-life:
 * τ = halfLifeDays / ln(2)
 */
export function ebbinghausRetention(daysSinceAccess: number, halfLifeDays: number): number {
  if (daysSinceAccess < 0) return 1
  const decayConstant = halfLifeDays / Math.log(2)
  return Math.exp(-daysSinceAccess / decayConstant)
}

/**
 * Compute the recommended review interval to maintain retention above a threshold.
 * t_review = -τ * ln(threshold)
 */
export function nextReviewDays(halfLifeDays: number, threshold: number): number {
  const decayConstant = halfLifeDays / Math.log(2)
  return -decayConstant * Math.log(threshold)
}
