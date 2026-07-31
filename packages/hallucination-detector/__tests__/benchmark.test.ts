/**
 * Benchmark: hallucination-detector
 *
 * Measures performance of detection operations:
 * - Spectral clustering on 50/100/200 claims
 * - TF-IDF vector building
 * - Pre-clustering with random projections (SpectralHallucinationDetector)
 * - Full detect() pipeline
 *
 * NOTE: This is a benchmark file, not a strict correctness test.
 * Run with: bun test packages/hallucination-detector/__tests__/benchmark.test.ts
 */

import { describe, test } from "bun:test"
import { buildTFIDFVectors, computeCosineSimilarity } from "@fengru/internal-tfidf"
import { HallucinationDetector, SpectralHallucinationDetector } from "../src/index"
import type { FactClaim } from "../src/index"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function measure(
  label: string,
  fn: () => void,
  iterations = 100,
): { opsPerSec: number; avgMs: number; totalMs: number } {
  const start = performance.now()
  for (let i = 0; i < iterations; i++) fn()
  const totalMs = performance.now() - start
  return {
    opsPerSec: Math.round(iterations / (totalMs / 1000)),
    avgMs: totalMs / iterations,
    totalMs,
  }
}

const SAMPLE_TEXTS = [
  "The theory of relativity was proposed by Albert Einstein in 1905 and revolutionized modern physics.",
  "Quantum entanglement occurs when particles interact in such a way that the quantum state of each cannot be described independently.",
  "The human genome contains approximately 20,000-25,000 protein-coding genes spread across 23 pairs of chromosomes.",
  "Climate change is primarily driven by the increase in greenhouse gas concentrations from human activities since the 1750s.",
  "The first successful powered flight was achieved by the Wright brothers on December 17, 1903 at Kitty Hawk, North Carolina.",
  "Neural networks use layers of interconnected nodes to process data, with backpropagation as the primary learning algorithm.",
  "Blockchain technology enables decentralized consensus through cryptographic proof mechanisms like proof-of-work and proof-of-stake.",
  "The speed of light in vacuum is exactly 299,792,458 meters per second and is a fundamental constant of nature.",
  "Machine learning models can learn from labeled data through supervised learning techniques including regression and classification.",
  "DNA replication is semi-conservative, meaning each new double helix contains one original strand and one newly synthesized strand.",
  "The Standard Model of particle physics describes three of the four fundamental forces: electromagnetic, weak, and strong nuclear.",
  "Rust's ownership system prevents memory safety issues at compile time without needing a garbage collector or runtime overhead.",
  "TypeScript adds static type checking to JavaScript, enabling better tooling, IDE support, and early error detection during development.",
  "PostgreSQL supports advanced features like table partitioning, full-text search, and JSON querying capabilities for modern applications.",
  "Kubernetes orchestrates containerized applications across clusters of machines, providing automated deployment, scaling, and management.",
  "The Transformer architecture introduced in 2017 uses self-attention mechanisms and has become the foundation for modern large language models.",
  "GraphQL provides a flexible API query language that allows clients to request exactly the data they need from a single endpoint.",
  "Differential privacy provides mathematical guarantees that individual data points cannot be identified from aggregate statistical queries.",
  "Zero-knowledge proofs allow one party to prove to another that a statement is true without revealing any information beyond the validity.",
  "The CAP theorem states that a distributed system can only guarantee two of three properties: consistency, availability, and partition tolerance.",
  "Reinforcement learning agents learn optimal policies through trial-and-error interaction with an environment, maximizing cumulative reward.",
  "WebAssembly provides a binary instruction format that enables near-native performance for languages like C++ and Rust in web browsers.",
  "Homomorphic encryption allows computation on encrypted data without decrypting it first, enabling privacy-preserving cloud computing.",
  "The Linux kernel uses a monolithic architecture with loadable kernel modules to support diverse hardware and filesystem needs.",
  "Functional programming emphasizes pure functions, immutability, and declarative code, with languages like Haskell and Elixir leading the paradigm.",
]

function makeClaims(count: number): FactClaim[] {
  const claims: FactClaim[] = []
  let offset = 0
  for (let i = 0; i < count; i++) {
    const text =
      SAMPLE_TEXTS[i % SAMPLE_TEXTS.length]! +
      (i >= SAMPLE_TEXTS.length ? ` [variant ${Math.floor(i / SAMPLE_TEXTS.length)}]` : "")
    claims.push({
      text,
      startIndex: offset,
      endIndex: offset + text.length,
      confidence: 0.3 + Math.random() * 0.5,
      source: "benchmark",
    })
    offset += text.length + 1
  }
  return claims
}

// Access private method spectralCluster via index signature for benchmarking
function spectralClusterRaw(detector: HallucinationDetector, claims: FactClaim[], k: number) {
  return (detector as any).spectralCluster(claims, k)
}

// Access private precluster method on SpectralHallucinationDetector
function preclusterRaw(detector: SpectralHallucinationDetector, claims: FactClaim[], k: number) {
  return (detector as any).precluster(claims, k)
}

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

describe("benchmark: TF-IDF vector building", () => {
  for (const docCount of [50, 100, 200]) {
    test(`build TF-IDF vectors for ${docCount} documents`, () => {
      const docs = Array.from({ length: docCount }, (_, i) => SAMPLE_TEXTS[i % SAMPLE_TEXTS.length]!)

      const result = measure("", () => buildTFIDFVectors(docs), docCount >= 100 ? 10 : 30)
      console.log(`  ${docCount} docs: ${result.avgMs.toFixed(3)}ms avg`)
    })
  }
})

describe("benchmark: spectral clustering", () => {
  for (const claimCount of [50, 100, 200]) {
    test(`spectral cluster ${claimCount} claims`, () => {
      const claims = makeClaims(claimCount)
      const detector = new HallucinationDetector({
        minClusterSize: 2,
        similarityThreshold: 0.5,
        maxClusters: Math.min(10, Math.ceil(claimCount / 5)),
      })
      const k = Math.min(10, Math.max(1, Math.ceil(claimCount / 5)))

      const result = measure("", () => spectralClusterRaw(detector, claims, k), claimCount >= 100 ? 5 : 15)
      console.log(`  ${claimCount} claims → ${k} clusters: ${result.avgMs.toFixed(3)}ms avg`)
    })
  }
})

describe("benchmark: pre-clustering with random projections", () => {
  for (const claimCount of [50, 100, 200]) {
    test(`precluster ${claimCount} claims`, () => {
      const claims = makeClaims(claimCount)
      const detector = new SpectralHallucinationDetector({
        similarityThreshold: 0.5,
        maxClusters: Math.min(8, Math.ceil(claimCount / 5)),
        minClusterSize: 2,
      })
      const k = Math.min(8, Math.max(1, Math.ceil(claimCount / 5)))

      const result = measure("", () => preclusterRaw(detector, claims, k), claimCount >= 100 ? 5 : 15)
      console.log(`  ${claimCount} claims → ${k} projections: ${result.avgMs.toFixed(3)}ms avg`)
    })
  }
})

describe("benchmark: claim extraction", () => {
  test("extract claims from long text", () => {
    const text = SAMPLE_TEXTS.join(". ")
    const detector = new HallucinationDetector()

    const result = measure("", () => detector.extractClaims(text), 200)
    console.log(`  extractClaims (${SAMPLE_TEXTS.length} sentences): ${result.avgMs.toFixed(4)}ms avg`)
  })
})

describe("benchmark: text similarity (Jaccard + Cosine)", () => {
  test("computeSimilarity pairs", () => {
    const detector = new HallucinationDetector()

    const result = measure(
      "",
      () => {
        for (let i = 0; i < SAMPLE_TEXTS.length - 1; i++) {
          detector.computeSimilarity(SAMPLE_TEXTS[i]!, SAMPLE_TEXTS[i + 1]!)
        }
      },
      50,
    )
    console.log(`  ${SAMPLE_TEXTS.length - 1} pairs: ${result.avgMs.toFixed(4)}ms avg`)
  })
})

describe("benchmark: full detect pipeline", () => {
  for (const paragraphCount of [3, 10, 25]) {
    test(`detect on ${paragraphCount} paragraphs`, () => {
      const text = SAMPLE_TEXTS.slice(0, paragraphCount).join(". ")
      const detector = new HallucinationDetector({
        minClusterSize: 2,
        similarityThreshold: 0.5,
        maxClusters: Math.min(5, Math.ceil(paragraphCount / 2)),
      })

      const result = measure("", () => detector.detect(text), paragraphCount >= 10 ? 5 : 20)
      console.log(`  ${paragraphCount} paragraphs: ${result.avgMs.toFixed(3)}ms avg`)
    })
  }
})
