import type { EvaluationMetrics } from "./utils"

/**
 * Compute evaluation metrics for a batch of predictions against ground truth.
 *
 * Covers: exact match, partial match, F1, ROUGE-1/2/L, BLEU (corpus-level), ECE, and efficiency.
 */
export class MetricCalculator {
  /**
   * Compute all evaluation metrics for a dataset.
   *
   * @param predictions - List of predicted answers.
   * @param references  - List of ground truth answers.
   * @param confidences - Optional confidence scores [0, 1].
   * @param callCounts   - Optional generation call counts per sample.
   * @param timesMs      - Optional elapsed times in milliseconds per sample.
   */
  static compute(
    predictions: string[],
    references: string[],
    confidences: number[] = [],
    callCounts: number[] = [],
    timesMs: number[] = [],
  ): EvaluationMetrics {
    const N = Math.min(predictions.length, references.length);
    if (N === 0) {
      return {
        numSamples: 0,
        exactMatch: 0,
        partialMatch: 0,
        f1: 0,
        rouge1: 0,
        rouge2: 0,
        rougeL: 0,
        bleu: 0,
        ece: 0,
        efficiency: { avgCalls: 0, avgTime: 0, harmonicEfficiency: 0 },
      };
    }

    // ── Exact & Partial Match ──
    let exactMatches = 0;
    let partialMatches = 0;
    for (let i = 0; i < N; i++) {
      const pred = predictions[i]!.trim().toLowerCase();
      const ref = references[i]!.trim().toLowerCase();
      if (pred === ref) exactMatches++;
      if (pred.includes(ref) || ref.includes(pred)) partialMatches++;
    }

    // ── Token-level F1 ──
    let f1Sum = 0;
    for (let i = 0; i < N; i++) {
      const predTokens = MetricCalculator.tokenize(predictions[i]!);
      const refTokens = MetricCalculator.tokenize(references[i]!);
      f1Sum += MetricCalculator.computeF1(predTokens, refTokens);
    }

    // ── ROUGE Scores ──
    let rouge1Sum = 0;
    let rouge2Sum = 0;
    let rougeLSum = 0;
    for (let i = 0; i < N; i++) {
      const predTokens = MetricCalculator.tokenize(predictions[i]!);
      const refTokens = MetricCalculator.tokenize(references[i]!);
      rouge1Sum += MetricCalculator.rougeN(predTokens, refTokens, 1);
      rouge2Sum += MetricCalculator.rougeN(predTokens, refTokens, 2);
      rougeLSum += MetricCalculator.rougeL(predTokens, refTokens);
    }

    // ── BLEU (corpus-level, with brevity penalty) ──
    const bleu = MetricCalculator.corpusBleu(predictions, references);

    // ── ECE (Expected Calibration Error) ──
    let ece = 0;
    if (confidences.length >= N && N > 0) {
      const corrects = predictions.map((p, i) =>
        p.trim() === references[i]?.trim() ? 1 : 0,
      );
      ece = MetricCalculator.computeECE(confidences.slice(0, N), corrects, 10);
    }

    // ── Efficiency ──
    const avgCalls = callCounts.length > 0
      ? callCounts.reduce((a, b) => a + b, 0) / callCounts.length
      : 0;
    const avgTime = timesMs.length > 0
      ? timesMs.reduce((a, b) => a + b, 0) / timesMs.length
      : 0;
    const harmonicEfficiency =
      avgCalls > 0 && avgTime > 0
        ? (2 * (1 / Math.max(avgCalls, 0.01)) * (1 / Math.max(avgTime, 1))) /
          ((1 / Math.max(avgCalls, 0.01)) + (1 / Math.max(avgTime, 1)))
        : 0;

    return {
      numSamples: N,
      exactMatch: N > 0 ? exactMatches / N : 0,
      partialMatch: N > 0 ? partialMatches / N : 0,
      f1: N > 0 ? f1Sum / N : 0,
      rouge1: N > 0 ? rouge1Sum / N : 0,
      rouge2: N > 0 ? rouge2Sum / N : 0,
      rougeL: N > 0 ? rougeLSum / N : 0,
      bleu,
      ece,
      efficiency: { avgCalls, avgTime, harmonicEfficiency },
    };
  }

  // ── Tokenization ──

  private static tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 0);
  }

  // ── F1 ──

  private static computeF1(predTokens: string[], refTokens: string[]): number {
    const predSet = new Set(predTokens);
    const refSet = new Set(refTokens);
    let intersection = 0;
    for (const t of predSet) {
      if (refSet.has(t)) intersection++;
    }
    const precision = predSet.size > 0 ? intersection / predSet.size : 0;
    const recall = refSet.size > 0 ? intersection / refSet.size : 0;
    return precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : 0;
  }

  // ── ROUGE-N ──

  private static rougeN(predTokens: string[], refTokens: string[], n: number): number {
    const predNgrams = MetricCalculator.getNgrams(predTokens, n);
    const refNgrams = MetricCalculator.getNgrams(refTokens, n);
    if (refNgrams.length === 0) return 0;

    let overlap = 0;
    for (const ng of predNgrams) {
      const idx = refNgrams.indexOf(ng);
      if (idx !== -1) {
        overlap++;
        refNgrams.splice(idx, 1); // remove to avoid double-counting
      }
    }
    const totalPredNgrams = MetricCalculator.getNgrams(predTokens, n).length;
    const totalRefNgrams = MetricCalculator.getNgrams(refTokens, n).length;
    const precision = totalPredNgrams > 0 ? overlap / totalPredNgrams : 0;
    const recall = totalRefNgrams > 0 ? overlap / totalRefNgrams : 0;
    return precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : 0;
  }

  // ── ROUGE-L (Longest Common Subsequence) ──

  private static rougeL(predTokens: string[], refTokens: string[]): number {
    const lcsLen = MetricCalculator.lcsLength(predTokens, refTokens);
    const precision = predTokens.length > 0 ? lcsLen / predTokens.length : 0;
    const recall = refTokens.length > 0 ? lcsLen / refTokens.length : 0;
    // F-beta with beta=1 (F1)
    return precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : 0;
  }

  private static lcsLength(a: string[], b: string[]): number {
    const m = a.length;
    const n = b.length;
    // 1D DP optimization
    const dp = new Array<number>(n + 1).fill(0);
    for (let i = 0; i < m; i++) {
      let prev = 0;
      for (let j = 0; j < n; j++) {
        const temp = dp[j + 1]!;
        dp[j + 1] = a[i] === b[j] ? prev + 1 : Math.max(dp[j + 1]!, dp[j]!);
        prev = temp;
      }
    }
    return dp[n]!;
  }

  // ── N-gram helpers ──

  private static getNgrams(tokens: string[], n: number): string[] {
    const ngrams: string[] = [];
    for (let i = 0; i <= tokens.length - n; i++) {
      ngrams.push(tokens.slice(i, i + n).join(' '));
    }
    return ngrams;
  }

  // ── BLEU (corpus-level) ──

  private static corpusBleu(predictions: string[], references: string[]): number {
    if (predictions.length === 0) return 0;

    let totalPrecision = 0;
    let totalRefLen = 0;
    let totalPredLen = 0;

    for (let weight = 1; weight <= 4; weight++) {
      let weightedPrecision = 0;
      for (let i = 0; i < predictions.length; i++) {
        const predTokens = MetricCalculator.tokenize(predictions[i]!);
        const refTokens = MetricCalculator.tokenize(references[i]!);
        const predNgrams = MetricCalculator.getNgrams(predTokens, weight);
        const refNgrams = MetricCalculator.getNgrams(refTokens, weight);

        let matchCount = 0;
        const used = new Set<number>();
        for (const pn of predNgrams) {
          for (let j = 0; j < refNgrams.length; j++) {
            if (!used.has(j) && refNgrams[j] === pn) {
              matchCount++;
              used.add(j);
              break;
            }
          }
        }

        weightedPrecision += predNgrams.length > 0
          ? Math.log(matchCount / predNgrams.length)
          : 0;

        // Accumulate for brevity penalty (only on first pass)
        if (weight === 1) {
          totalRefLen += refTokens.length;
          totalPredLen += predTokens.length;
        }
      }
      totalPrecision += weightedPrecision / predictions.length;
    }

    // Brevity penalty
    const bp = totalPredLen < totalRefLen
      ? Math.exp(1 - totalRefLen / Math.max(totalPredLen, 1))
      : 1.0;

    // Geometric mean of n-gram precisions (weighted equally)
    return bp * Math.exp(totalPrecision / 4);
  }

  // ── ECE (Expected Calibration Error - equal-width binning) ──

  private static computeECE(
    confidences: number[],
    corrects: number[],
    numBins: number,
  ): number {
    if (confidences.length === 0) return 0;
    const N = confidences.length;
    const binSize = 1.0 / numBins;
    let ece = 0;

    for (let b = 0; b < numBins; b++) {
      const binLow = b * binSize;
      const binHigh = (b + 1) * binSize;

      let binSum = 0;
      let binCorrect = 0;

      for (let i = 0; i < N; i++) {
        const conf = confidences[i]!;
        if (conf >= binLow && conf < binHigh) {
          binSum++;
          binCorrect += corrects[i]!;
        }
      }

      if (binSum > 0) {
        const binAcc = binCorrect / binSum;
        const binConf = (binLow + binHigh) / 2;
        ece += (binSum / N) * Math.abs(binAcc - binConf);
      }
    }

    return ece;
  }
}

/**
 * Self-consistency evaluation: generate multiple completions with diverse
 * temperatures and use majority voting.
 */
export async function selfConsistencyEvaluate(
  problem: string,
  generateFn: (prompt: string, n: number) => Promise<string[]>,
  numSamples: number = 10,
): Promise<{ answer: string; voteCounts: Map<string, number>; agreementRate: number }> {
  // Generate N samples with varied temperatures (simulated via n>1)
  const completions = await generateFn(problem, numSamples);

  // Majority voting
  const votes = new Map<string, number>();
  for (const c of completions) {
    // Normalize: take last non-empty line as answer
    const lines = c.trim().split('\n').filter(l => l.trim().length > 0);
    const answer = lines.length > 0 ? lines[lines.length - 1]!.trim() : c.trim();
    votes.set(answer, (votes.get(answer) ?? 0) + 1);
  }

  // Find max vote
  let bestAnswer = '';
  let maxVotes = 0;
  for (const [answer, count] of votes) {
    if (count > maxVotes) {
      maxVotes = count;
      bestAnswer = answer;
    }
  }

  return {
    answer: bestAnswer,
    voteCounts: votes,
    agreementRate: completions.length > 0 ? maxVotes / completions.length : 0,
  };
}
