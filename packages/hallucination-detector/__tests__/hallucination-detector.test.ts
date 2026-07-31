import { describe, expect, test } from "bun:test"
import {
  DEFAULT_DETECTOR_CONFIG,
  type FactClaim,
  HallucinationDetector,
  type HallucinationReport,
  SpectralHallucinationDetector,
} from "../src/index"

describe("HallucinationDetector", () => {
  test("constructs with default config", () => {
    const detector = new HallucinationDetector()
    expect(detector.config.minClusterSize).toBe(2)
    expect(detector.config.similarityThreshold).toBe(0.7)
    expect(detector.config.maxClusters).toBe(5)
    expect(detector.config.selfConsistencySamples).toBe(3)
    expect(detector.config.hallucinationThreshold).toBe(0.3)
  })

  test("constructs with partial config override", () => {
    const detector = new HallucinationDetector({
      minClusterSize: 3,
      similarityThreshold: 0.5,
    })
    expect(detector.config.minClusterSize).toBe(3)
    expect(detector.config.similarityThreshold).toBe(0.5)
    expect(detector.config.maxClusters).toBe(5)
  })

  describe("extractClaims", () => {
    test("extracts claims with numbers", () => {
      const detector = new HallucinationDetector()
      const claims = detector.extractClaims("The population is 8 billion in 2024.")
      expect(claims.length).toBeGreaterThan(0)
      expect(claims[0].text).toContain("8 billion")
    })

    test("extracts claims with percentages", () => {
      const detector = new HallucinationDetector()
      const claims = detector.extractClaims("Revenue grew 15% in Q1.")
      expect(claims.length).toBeGreaterThan(0)
      expect(claims[0].text).toContain("15%")
    })

    test("extracts claims with dates", () => {
      const detector = new HallucinationDetector()
      const claims = detector.extractClaims("The event occurred on 01/15/2023.")
      expect(claims.length).toBeGreaterThan(0)
      expect(claims[0].confidence).toBeGreaterThan(0.3)
    })

    test("extracts claims with named entities", () => {
      const detector = new HallucinationDetector()
      const claims = detector.extractClaims("Microsoft released Windows 11.")
      expect(claims.length).toBeGreaterThan(0)
    })

    test("extracts claims with definitive verbs", () => {
      const detector = new HallucinationDetector()
      const claims = detector.extractClaims("The sun is a star.")
      expect(claims.length).toBeGreaterThan(0)
    })

    test("assigns higher confidence to claims with multiple signals", () => {
      const detector = new HallucinationDetector()
      const claims1 = detector.extractClaims("The sun is a star.")
      const claims2 = detector.extractClaims("Microsoft earned 10 billion dollars in 2023.")
      expect(claims2[0].confidence).toBeGreaterThan(claims1[0].confidence)
    })

    test("handles empty text", () => {
      const detector = new HallucinationDetector()
      const claims = detector.extractClaims("")
      expect(claims.length).toBe(0)
    })

    test("handles whitespace-only text", () => {
      const detector = new HallucinationDetector()
      const claims = detector.extractClaims("   ")
      expect(claims.length).toBe(0)
    })

    test("assigns source to claims", () => {
      const detector = new HallucinationDetector()
      const claims = detector.extractClaims("Earth is round.", "wikipedia")
      expect(claims[0].source).toBe("wikipedia")
    })

    test("default source is unknown", () => {
      const detector = new HallucinationDetector()
      const claims = detector.extractClaims("Earth is round.")
      expect(claims[0].source).toBe("unknown")
    })

    test("includes startIndex and endIndex", () => {
      const detector = new HallucinationDetector()
      const claims = detector.extractClaims("Earth is round. Mars is red.")
      expect(claims.length).toBe(2)
      expect(claims[0].startIndex).toBe(0)
      expect(claims[0].endIndex).toBe(15)
      expect(claims[1].startIndex).toBe(16)
    })

    test("multiple sentences produce multiple claims", () => {
      const detector = new HallucinationDetector()
      const claims = detector.extractClaims("Cats are mammals. Dogs are mammals. Birds are dinosaurs.")
      expect(claims.length).toBe(3)
    })
  })

  describe("computeSimilarity", () => {
    test("identical texts have max similarity", () => {
      const detector = new HallucinationDetector()
      const sim = detector.computeSimilarity("The cat sat on the mat.", "The cat sat on the mat.")
      expect(sim).toBeGreaterThan(0.9)
    })

    test("similar texts have high similarity", () => {
      const detector = new HallucinationDetector()
      const sim = detector.computeSimilarity("The cat sat on the mat.", "A cat was sitting on the mat.")
      expect(sim).toBeGreaterThan(0.25)
    })

    test("different texts have low similarity", () => {
      const detector = new HallucinationDetector()
      const sim = detector.computeSimilarity("The cat sat on the mat.", "Quantum physics explores subatomic particles.")
      expect(sim).toBeLessThan(0.5)
    })

    test("completely disjoint texts have near-zero similarity", () => {
      const detector = new HallucinationDetector()
      const sim = detector.computeSimilarity("apple banana orange", "quantum physics relativity")
      expect(sim).toBeLessThan(0.3)
    })

    test("empty strings", () => {
      const detector = new HallucinationDetector()
      const sim = detector.computeSimilarity("", "")
      expect(sim).toBeGreaterThanOrEqual(0)
    })
  })

  describe("checkSelfConsistency", () => {
    test("detects consistent claims when similar", () => {
      const detector = new HallucinationDetector({
        similarityThreshold: 0.25,
      })
      const claims = detector.extractClaims("Cats are pets. Cats are animals kept as companions.")
      const result = detector.checkSelfConsistency(claims)
      expect(result.rate).toBeGreaterThan(0)
      expect(result.consistent.length).toBeGreaterThan(0)
    })

    test("detects inconsistency with divergent claims", () => {
      const detector = new HallucinationDetector()
      const claims = detector.extractClaims(
        "Cats are mammals. Quantum computers use qubits. The moon is made of cheese.",
      )
      const result = detector.checkSelfConsistency(claims)
      expect(result.inconsistent.length).toBeGreaterThan(0)
    })

    test("uses reference facts for consistency check", () => {
      const detector = new HallucinationDetector({
        similarityThreshold: 0.2,
      })
      const claims = detector.extractClaims("Cats are mammals.")
      const result = detector.checkSelfConsistency(claims, ["Cats are warm-blooded animals."])
      expect(result.rate).toBeGreaterThan(0)
    })

    test("empty claims returns rate 1", () => {
      const detector = new HallucinationDetector()
      const result = detector.checkSelfConsistency([])
      expect(result.rate).toBe(1)
      expect(result.consistent.length).toBe(0)
      expect(result.inconsistent.length).toBe(0)
    })

    test("single claim without reference facts is inconsistent", () => {
      const detector = new HallucinationDetector({
        similarityThreshold: 0.7,
      })
      const claims = detector.extractClaims("The moon is made of green cheese.")
      const result = detector.checkSelfConsistency(claims)
      expect(result.inconsistent.length).toBe(1)
    })
  })

  describe("detect", () => {
    test("returns report with claims and clusters", () => {
      const detector = new HallucinationDetector()
      const report = detector.detect("Cats are mammals. Dogs are mammals. The sun is hot.")
      expect(report.claims.length).toBeGreaterThan(0)
      expect(report.clusters.length).toBeGreaterThan(0)
      expect(report.overallScore).toBeGreaterThan(0)
    })

    test("empty text returns empty report", () => {
      const detector = new HallucinationDetector()
      const report = detector.detect("")
      expect(report.claims.length).toBe(0)
      expect(report.clusters.length).toBe(0)
      expect(report.hallucinations.length).toBe(0)
      expect(report.overallScore).toBe(1)
    })

    test("flags unsupported claims with reference facts", () => {
      const detector = new HallucinationDetector({
        hallucinationThreshold: 0.6,
      })
      const report = detector.detect("The moon is made of green cheese and was created by aliens.", {
        referenceFacts: ["The moon is a natural satellite of Earth formed from debris after a giant impact."],
      })
      expect(report.claims.length).toBeGreaterThan(0)
    })

    test("knowledge base validation affects detection", () => {
      const detector = new HallucinationDetector({
        hallucinationThreshold: 0.9,
      })
      const report = detector.detect("Cats are mammals that can fly.", {
        knowledgeBase: ["Cats are mammals.", "Cats cannot fly.", "Cats have four legs."],
      })
      expect(report.hallucinations.length).toBeGreaterThan(0)
    })

    test("well-supported claims have high score", () => {
      const detector = new HallucinationDetector()
      const report = detector.detect("The Earth orbits the Sun. Water is H2O.", {
        referenceFacts: ["The Earth orbits the Sun.", "Water is H2O."],
        knowledgeBase: ["Earth orbits Sun", "Water chemical formula H2O"],
      })
      expect(report.overallScore).toBeGreaterThan(0.35)
    })

    test("report includes details string", () => {
      const detector = new HallucinationDetector()
      const report = detector.detect("Cats are animals.")
      expect(report.details.length).toBeGreaterThan(0)
    })

    test("single claim produces one cluster", () => {
      const detector = new HallucinationDetector()
      const report = detector.detect("Cats are mammals.")
      expect(report.clusters.length).toBe(1)
    })

    test("returns all claim types in report", () => {
      const detector = new HallucinationDetector()
      const report = detector.detect("Cats are mammals. Dogs are pets.")
      expect(Array.isArray(report.claims)).toBe(true)
      expect(Array.isArray(report.clusters)).toBe(true)
      expect(Array.isArray(report.hallucinations)).toBe(true)
      expect(typeof report.overallScore).toBe("number")
      expect(typeof report.details).toBe("string")
    })
  })

  describe("similarity correctness", () => {
    test("jaccard: identical sets have similarity 1", () => {
      const detector = new HallucinationDetector()
      const sim = detector.computeSimilarity("hello world", "hello world")
      expect(sim).toBeGreaterThan(0.9)
    })

    test("cosine: orthogonal-like vectors have lower similarity", () => {
      const detector = new HallucinationDetector()
      const sim1 = detector.computeSimilarity("cat dog mouse", "cat dog mouse")
      const sim2 = detector.computeSimilarity("cat dog mouse", "run jump swim")
      expect(sim1).toBeGreaterThan(sim2)
    })
  })
})

describe("SpectralHallucinationDetector", () => {
  test("extends HallucinationDetector", () => {
    const sdetect = new SpectralHallucinationDetector()
    expect(sdetect).toBeInstanceOf(HallucinationDetector)
  })

  test("inherits config", () => {
    const sdetect = new SpectralHallucinationDetector({
      minClusterSize: 4,
    })
    expect(sdetect.config.minClusterSize).toBe(4)
  })

  test("detect method works", () => {
    const sdetect = new SpectralHallucinationDetector()
    const report = sdetect.detect("Cats are animals. Dogs are animals.")
    expect(report.claims.length).toBeGreaterThan(0)
  })

  test("extractClaims works", () => {
    const sdetect = new SpectralHallucinationDetector()
    const claims = sdetect.extractClaims("Earth is a planet.")
    expect(claims.length).toBe(1)
  })

  test("computeSimilarity works", () => {
    const sdetect = new SpectralHallucinationDetector()
    const sim = sdetect.computeSimilarity("hello", "hello")
    expect(sim).toBeGreaterThan(0.9)
  })
})

describe("DEFAULT_DETECTOR_CONFIG", () => {
  test("has expected default values", () => {
    expect(DEFAULT_DETECTOR_CONFIG.minClusterSize).toBe(2)
    expect(DEFAULT_DETECTOR_CONFIG.similarityThreshold).toBe(0.7)
    expect(DEFAULT_DETECTOR_CONFIG.maxClusters).toBe(5)
    expect(DEFAULT_DETECTOR_CONFIG.selfConsistencySamples).toBe(3)
    expect(DEFAULT_DETECTOR_CONFIG.hallucinationThreshold).toBe(0.3)
  })
})
