export interface FactClaim {
  text: string
  startIndex: number
  endIndex: number
  confidence: number
  source: string
}

export interface ClusterResult {
  clusterId: number
  claims: FactClaim[]
  centroid: number[]
  coherence: number
}

export interface HallucinationReport {
  claims: FactClaim[]
  clusters: ClusterResult[]
  hallucinations: FactClaim[]
  overallScore: number
  details: string
}

export interface DetectorConfig {
  minClusterSize: number
  similarityThreshold: number
  maxClusters: number
  selfConsistencySamples: number
  hallucinationThreshold: number
}

export const DEFAULT_DETECTOR_CONFIG: DetectorConfig = {
  minClusterSize: 2,
  similarityThreshold: 0.7,
  maxClusters: 5,
  selfConsistencySamples: 3,
  hallucinationThreshold: 0.3,
}

import { tokenize, buildTFIDFVectors, computeCosineSimilarity } from "@fengru/internal-tfidf"

function splitSentences(text: string): string[] {
  if (!text.trim()) return []
  const parts = text.match(/[^.!?\n]+[.!?\n]*/g)
  if (!parts || parts.length === 0) return [text.trim()]
  return parts
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function computeJaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  let intersection = 0
  for (const item of a) {
    if (b.has(item)) intersection++
  }
  const union = new Set([...a, ...b])
  return union.size > 0 ? intersection / union.size : 0
}

function computeTextSimilarity(
  a: string,
  b: string,
  similarityThreshold: number,
): number {
  const tokensA = new Set(tokenize(a))
  const tokensB = new Set(tokenize(b))
  const jaccard = computeJaccardSimilarity(tokensA, tokensB)
  const { vectors } = buildTFIDFVectors([a, b])
  if (vectors.length < 2) return jaccard
  const cosine = computeCosineSimilarity(vectors[0], vectors[1])
  return (jaccard + cosine) / 2
}

export class HallucinationDetector {
  config: DetectorConfig

  constructor(config?: Partial<DetectorConfig>) {
    this.config = { ...DEFAULT_DETECTOR_CONFIG, ...config }
  }

  extractClaims(text: string, source?: string): FactClaim[] {
    const sentences = splitSentences(text)
    const claims: FactClaim[] = []
    let offset = 0

    for (const sentence of sentences) {
      const startIndex = text.indexOf(sentence, offset)
      if (startIndex === -1) {
        offset += sentence.length
        continue
      }
      offset = startIndex + sentence.length

      let confidence = 0.25

      if (/\d+/.test(sentence)) confidence += 0.15
      if (/\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}/.test(sentence))
        confidence += 0.1
      if (/\d+(\.\d+)?\s*%/.test(sentence)) confidence += 0.1

      const words = sentence.split(/\s+/)
      const capitalWords = words.filter((w) => /^[A-Z][a-z]{2,}$/.test(w))
      if (capitalWords.length > 0)
        confidence += Math.min(0.2, capitalWords.length * 0.05)

      if (
        /\b(is|are|was|were|has|have|will|shall|must|can|could|should|would|did|does|do|had|been)\b/i.test(
          sentence,
        )
      ) {
        confidence += 0.1
      }

      confidence = Math.min(1, Math.max(0, confidence))

      claims.push({
        text: sentence,
        startIndex,
        endIndex: startIndex + sentence.length,
        confidence,
        source: source || "unknown",
      })
    }

    return claims
  }

  computeSimilarity(a: string, b: string): number {
    return computeTextSimilarity(a, b, this.config.similarityThreshold)
  }

  checkSelfConsistency(
    claims: FactClaim[],
    referenceFacts?: string[],
  ): { consistent: FactClaim[]; inconsistent: FactClaim[]; rate: number } {
    if (claims.length === 0) {
      return { consistent: [], inconsistent: [], rate: 1 }
    }

    const consistent: FactClaim[] = []
    const inconsistent: FactClaim[] = []

    for (const claim of claims) {
      let maxSim = 0

      for (const other of claims) {
        if (other.text === claim.text) continue
        const sim = this.computeSimilarity(claim.text, other.text)
        if (sim > maxSim) maxSim = sim
      }

      if (referenceFacts) {
        for (const fact of referenceFacts) {
          const sim = this.computeSimilarity(claim.text, fact)
          if (sim > maxSim) maxSim = sim
        }
      }

      if (maxSim >= this.config.similarityThreshold) {
        consistent.push(claim)
      } else {
        inconsistent.push(claim)
      }
    }

    const rate =
      claims.length > 0 ? consistent.length / claims.length : 1
    return { consistent, inconsistent, rate }
  }

  detect(
    text: string,
    options?: {
      referenceFacts?: string[]
      knowledgeBase?: string[]
    },
  ): HallucinationReport {
    const claims = this.extractClaims(text)
    if (claims.length === 0) {
      return {
        claims: [],
        clusters: [],
        hallucinations: [],
        overallScore: 1,
        details: "No factual claims extracted from text.",
      }
    }

    const k = Math.min(
      this.config.maxClusters,
      Math.max(1, Math.ceil(claims.length / this.config.minClusterSize)),
    )
    const clusters = this.spectralCluster(claims, k)

    const hallucinations: FactClaim[] = []
    const scores: number[] = []

    for (const claim of claims) {
      const score = this.scoreClaim(
        claim,
        clusters,
        options?.referenceFacts,
      )
      if (options?.knowledgeBase && options.knowledgeBase.length > 0) {
        const kbScore = this.checkAgainstKnowledge(
          claim.text,
          options.knowledgeBase,
        )
        const adjustedScore = score * 0.7 + kbScore * 0.3
        scores.push(adjustedScore)
        if (adjustedScore < this.config.hallucinationThreshold) {
          hallucinations.push(claim)
        }
      } else {
        scores.push(score)
        if (score < this.config.hallucinationThreshold) {
          hallucinations.push(claim)
        }
      }
    }

    const overallScore =
      scores.length > 0
        ? scores.reduce((a, b) => a + b, 0) / scores.length
        : 1

    const hCount = hallucinations.length
    const details =
      hCount === 0
        ? `No hallucinations detected. ${claims.length} claims analyzed across ${clusters.length} clusters.`
        : `Detected ${hCount} hallucinated claim(s) out of ${claims.length} total claims. Overall score: ${overallScore.toFixed(2)}.`

    return { claims, clusters, hallucinations, overallScore, details }
  }

  private spectralCluster(
    claims: FactClaim[],
    k: number,
  ): ClusterResult[] {
    if (claims.length === 0) return []
    if (claims.length === 1) {
      return [
        {
          clusterId: 0,
          claims: [claims[0]],
          centroid: [],
          coherence: 1,
        },
      ]
    }

    const docs = claims.map((c) => c.text)
    const { vectors } = buildTFIDFVectors(docs)

    const n = claims.length
    const simMatrix: number[][] = Array.from({ length: n }, () =>
      new Array(n).fill(0),
    )

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const sim = computeCosineSimilarity(vectors[i], vectors[j])
        if (sim >= this.config.similarityThreshold) {
          simMatrix[i][j] = sim
          simMatrix[j][i] = sim
        }
      }
      simMatrix[i][i] = 1
    }

    const visited = new Array(n).fill(false)
    const components: number[][] = []

    for (let i = 0; i < n; i++) {
      if (visited[i]) continue
      const component: number[] = []
      const queue: number[] = [i]
      visited[i] = true

      while (queue.length > 0) {
        const node = queue.shift()!
        component.push(node)
        for (let j = 0; j < n; j++) {
          if (!visited[j] && simMatrix[node][j] > 0) {
            visited[j] = true
            queue.push(j)
          }
        }
      }

      components.push(component)
    }

    const clusters: ClusterResult[] = []

    for (let cid = 0; cid < components.length && cid < k; cid++) {
      const comp = components[cid]
      const clusterClaims = comp.map((idx) => claims[idx])
      const clusterVectors = comp.map((idx) => vectors[idx])

      const dim =
        clusterVectors.length > 0 ? clusterVectors[0].length : 0
      const centroid: number[] = new Array(dim).fill(0)
      for (const v of clusterVectors) {
        for (let d = 0; d < dim; d++) {
          centroid[d] += v[d]
        }
      }
      for (let d = 0; d < dim; d++) {
        centroid[d] /= clusterVectors.length
      }

      let coherence = 1
      if (comp.length > 1) {
        let sum = 0
        let count = 0
        for (let a = 0; a < comp.length; a++) {
          for (let b = a + 1; b < comp.length; b++) {
            sum += simMatrix[comp[a]][comp[b]]
            count++
          }
        }
        coherence = count > 0 ? sum / count : 1
      }

      clusters.push({
        clusterId: cid,
        claims: clusterClaims,
        centroid,
        coherence,
      })
    }

    return clusters
  }

  private scoreClaim(
    claim: FactClaim,
    clusters: ClusterResult[],
    referenceFacts?: string[],
  ): number {
    let clusterCoherence = 0
    for (const cluster of clusters) {
      const found = cluster.claims.some(
        (c) =>
          c.text === claim.text && c.startIndex === claim.startIndex,
      )
      if (found) {
        clusterCoherence = cluster.coherence
        break
      }
    }

    if (referenceFacts && referenceFacts.length > 0) {
      let maxSim = 0
      for (const fact of referenceFacts) {
        const sim = this.computeSimilarity(claim.text, fact)
        if (sim > maxSim) maxSim = sim
      }
      return (
        claim.confidence * 0.25 +
        clusterCoherence * 0.35 +
        maxSim * 0.4
      )
    }

    return claim.confidence * 0.4 + clusterCoherence * 0.6
  }

  private checkAgainstKnowledge(claim: string, kb: string[]): number {
    if (kb.length === 0) return 0
    let maxSim = 0
    for (const entry of kb) {
      const sim = this.computeSimilarity(claim, entry)
      if (sim > maxSim) maxSim = sim
    }
    return maxSim
  }

  private jaccardSimilarity(a: Set<string>, b: Set<string>): number {
    return computeJaccardSimilarity(a, b)
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    return computeCosineSimilarity(a, b)
  }

  private buildTFIDF(
    docs: string[],
  ): { vectors: number[][]; terms: string[] } {
    return buildTFIDFVectors(docs)
  }
}

export class SpectralHallucinationDetector extends HallucinationDetector {
  private precluster(claims: FactClaim[], k: number): number[][] {
    if (claims.length === 0 || k === 0) return []

    const docs = claims.map((c) => c.text)
    const { vectors } = buildTFIDFVectors(docs)

    if (vectors.length === 0 || vectors[0].length === 0) {
      return vectors.map(() => [])
    }

    const dim = vectors[0].length
    const projections: number[][] = []

    for (let i = 0; i < k; i++) {
      const proj: number[] = []
      for (let d = 0; d < dim; d++) {
        proj.push(Math.random() * 2 - 1)
      }
      const norm = Math.sqrt(proj.reduce((s, v) => s + v * v, 0))
      if (norm > 0) {
        for (let d = 0; d < dim; d++) proj[d] /= norm
      }
      projections.push(proj)
    }

    const assignments: number[][] = vectors.map(() =>
      new Array(k).fill(0),
    )

    for (let i = 0; i < vectors.length; i++) {
      const sims = projections.map((proj) =>
        computeCosineSimilarity(vectors[i], proj),
      )
      const maxIdx = sims.indexOf(Math.max(...sims))
      assignments[i][maxIdx] = 1
    }

    return assignments
  }

  private laplacianEigenDecomposition(
    similarityMatrix: number[][],
    k: number,
  ): { eigenvalues: number[]; eigenvectors: number[][] } {
    const n = similarityMatrix.length

    if (n === 0 || k === 0) {
      return { eigenvalues: [], eigenvectors: [] }
    }

    const degree: number[] = similarityMatrix.map((row) =>
      row.reduce((s, v) => s + v, 0),
    )

    const laplacian: number[][] = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => {
        if (i === j) {
          const deg = degree[i] > 0 ? degree[i] : 1
          return 1 + similarityMatrix[i][j] / deg
        }
        const denom = Math.sqrt(
          Math.max(degree[i] * degree[j], 1e-10),
        )
        return similarityMatrix[i][j] / denom
      }),
    )

    const eigenvectors: number[][] = []
    const eigenvalues: number[] = []
    const effectiveK = Math.min(k, n)

    for (let v = 0; v < effectiveK; v++) {
      let vec: number[] = Array.from(
        { length: n },
        () => Math.random() * 2 - 1,
      )
      let norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0))
      if (norm > 0) vec = vec.map((x) => x / norm)
      else vec = new Array(n).fill(0)

      for (const prev of eigenvectors) {
        const dot = vec.reduce((s, x, i) => s + x * prev[i], 0)
        vec = vec.map((x, i) => x - dot * prev[i])
      }
      norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0))
      if (norm > 0) vec = vec.map((x) => x / norm)

      const maxIter = 50
      const tol = 1e-6
      for (let iter = 0; iter < maxIter; iter++) {
        const newVec: number[] = new Array(n).fill(0)
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            newVec[i] += laplacian[i][j] * vec[j]
          }
        }

        for (const prev of eigenvectors) {
          const dot = newVec.reduce(
            (s, x, i) => s + x * prev[i],
            0,
          )
          for (let i = 0; i < n; i++) newVec[i] -= dot * prev[i]
        }

        const nrm = Math.sqrt(
          newVec.reduce((s, x) => s + x * x, 0),
        )
        if (nrm === 0) break
        for (let i = 0; i < n; i++) newVec[i] /= nrm

        const diff = vec.reduce(
          (s, x, i) => s + Math.abs(x - newVec[i]),
          0,
        )
        vec = newVec

        if (diff < tol) break
      }

      let lambda = 0
      const lv: number[] = new Array(n).fill(0)
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          lv[i] += laplacian[i][j] * vec[j]
        }
      }
      lambda = vec.reduce((s, x, i) => s + x * lv[i], 0)

      eigenvectors.push(vec)
      eigenvalues.push(lambda)
    }

    return { eigenvalues, eigenvectors }
  }
}
