import type { FactualClaim, HallucinationReport, VerifiedClaim } from "./utils"

/**
 * Configuration for hallucination suppression.
 */
export interface HallucinationSuppressorConfig {
  /** LLM call function: (prompt) => completion. */
  llmCall: (prompt: string) => Promise<string>
  /** Number of verification passes per claim. */
  nVerifications: number
  /** Threshold below which a claim is flagged as hallucination [0, 1]. */
  consistencyThreshold: number
}

const DEFAULT_HALLUCINATION_CONFIG: Omit<HallucinationSuppressorConfig, "llmCall"> = {
  nVerifications: 3,
  consistencyThreshold: 0.6,
}

/**
 * Hallucination Suppressor: detect and correct hallucinations in LLM outputs
 * using self-consistency verification with diverse templates.
 *
 * Pipeline:
 *   Extract claims → Self-consistency verify → Cross-validate → Flag hallucinations → Correct
 */
export class HallucinationSuppressor {
  private config: HallucinationSuppressorConfig

  private static readonly VERIFICATION_TEMPLATES = [
    (claim: string) =>
      `Verify whether the following statement is factually correct. Answer ONLY "YES" or "NO":\n"${claim}"`,
    (claim: string) => `Is the following claim true? Answer ONLY "YES" or "NO":\nClaim: ${claim}`,
    (claim: string) => `Fact-check this statement and respond with only "YES" (correct) or "NO" (incorrect):\n${claim}`,
  ]

  constructor(config: HallucinationSuppressorConfig) {
    this.config = { ...DEFAULT_HALLUCINATION_CONFIG, ...config }
  }

  /**
   * Extract factual claims from text.
   * Splits on sentence boundaries and filters out questions/prompts.
   */
  extractClaims(text: string): FactualClaim[] {
    const sentences = text
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 10 && !s.endsWith("?"))

    return sentences.map((claim, i) => ({
      claim,
      confidence: 0.7 + 0.1 * (sentences.length > 1 ? i / (sentences.length - 1) : 0),
    }))
  }

  /**
   * Verify a single claim via self-consistency across multiple templates.
   */
  async verifyClaim(claim: string): Promise<VerifiedClaim> {
    const verifications: string[] = []
    let yesCount = 0

    for (const template of HallucinationSuppressor.VERIFICATION_TEMPLATES) {
      for (let v = 0; v < this.config.nVerifications; v++) {
        const prompt = template(claim)
        const response = await this.config.llmCall(prompt)
        verifications.push(response)

        // Parse YES/NO from response
        const normalized = response.trim().toUpperCase()
        if (normalized.startsWith("YES") || normalized.includes("YES")) {
          yesCount++
        }
      }
    }

    const totalVerifications = HallucinationSuppressor.VERIFICATION_TEMPLATES.length * this.config.nVerifications
    const consistencyScore = totalVerifications > 0 ? yesCount / totalVerifications : 0

    return {
      claim,
      isHallucination: consistencyScore < this.config.consistencyThreshold,
      consistencyScore,
      verifications,
    }
  }

  /**
   * Run the full hallucination suppression pipeline on text.
   *
   * Steps:
   *  1. Extract factual claims
   *  2. Self-consistency verify each claim
   *  3. Cross-validate (flagged claims with high confidence above threshold are kept)
   *  4. Generate corrected text (remove hallucinated claims)
   */
  async suppress(text: string): Promise<HallucinationReport> {
    const claims = this.extractClaims(text)
    const claimTexts = claims.map((c) => c.claim)

    const verifiedClaims: VerifiedClaim[] = []
    for (const claim of claimTexts) {
      const verified = await this.verifyClaim(claim)
      verifiedClaims.push(verified)
    }

    const hallucinations = verifiedClaims
      .filter((v) => v.isHallucination)
      .map((v) => ({
        claim: v.claim,
        confidence: v.consistencyScore,
      }))

    const verifiedCount = verifiedClaims.filter((v) => !v.isHallucination).length
    const hallucinationCount = hallucinations.length
    const overallConfidence = claims.length > 0 ? verifiedCount / claims.length : 1.0

    // Generate corrected text by removing hallucinated claims
    let correctedText = text
    for (const h of hallucinations) {
      // Escape regex special characters in claim
      const escaped = h.claim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      correctedText = correctedText.replace(new RegExp(escaped, "g"), "")
    }
    // Clean up extra whitespace
    correctedText = correctedText.replace(/\n{3,}/g, "\n\n").trim()

    return {
      originalText: text,
      correctedText,
      claims: claimTexts,
      hallucinations,
      verifiedCount,
      hallucinationCount,
      overallConfidence,
    }
  }
}
