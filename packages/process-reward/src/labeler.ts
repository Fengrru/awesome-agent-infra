/**
 * PRMLabeler — 3-tier step labeling for training data generation.
 * @module process-reward/labeler
 */

import type { TaskType, StepScore, TrainingSample, PRMConfig } from "./types"
import { DEFAULT_PRM_CONFIG } from "./types"
import { heuristicScore } from "./scoring"

export class PRMLabeler {
  config: PRMConfig

  constructor(config?: Partial<PRMConfig>) {
    this.config = { ...DEFAULT_PRM_CONFIG, ...config }
  }

  labelSteps(
    steps: string[], outcome: number, taskType: TaskType,
    options?: {
      verifierFn?: (fullText: string, reference: string) => boolean
      generateFn?: (state: string) => string
      referenceAnswer?: string
    },
  ): { labels: number[]; confidences: number[]; strategy: string } {
    if (steps.length === 0) return { labels: [], confidences: [], strategy: "weak_supervision" }
    const strategy = this.config.labelingStrategy
    const hasMC = (strategy === "mc_rollout" || strategy === "hybrid") &&
      options?.verifierFn && options?.generateFn && options?.referenceAnswer
    if (hasMC) {
      const result = this.mcRolloutLabel(steps, options!.verifierFn!, options!.generateFn!, options!.referenceAnswer!)
      return { ...result, strategy: "mc_rollout" }
    }
    if (strategy === "heuristic" || strategy === "hybrid") {
      const result = this.heuristicLabel(steps, outcome, taskType)
      return { ...result, strategy: "heuristic" }
    }
    const result = this.weakSupervisionLabel(steps, outcome, taskType)
    return { ...result, strategy: "weak_supervision" }
  }

  private mcRolloutLabel(
    steps: string[], verifierFn: (full: string, ref: string) => boolean,
    generateFn: (state: string) => string, reference: string,
  ): { labels: number[]; confidences: number[] } {
    const n = steps.length
    const numRollouts = this.config.numRollouts
    const labels: number[] = new Array(n).fill(0.5)
    const confidences: number[] = new Array(n).fill(0)
    for (let i = 0; i < n; i++) {
      const prefix = steps.slice(0, i + 1).join("\n")
      let successCount = 0
      for (let r = 0; r < numRollouts; r++) {
        const completion = generateFn(prefix)
        if (verifierFn(prefix + "\n" + completion, reference)) successCount++
      }
      labels[i] = successCount / numRollouts
      confidences[i] = 1 - 1 / Math.sqrt(numRollouts + 1)
    }
    return { labels, confidences }
  }

  private heuristicLabel(
    steps: string[], outcome: number, taskType: TaskType,
  ): { labels: number[]; confidences: number[] } {
    const n = steps.length
    const labels: number[] = []
    const confidences: number[] = []
    for (let i = 0; i < n; i++) {
      const prev = i > 0 ? steps[i - 1] : null
      labels.push(heuristicScore(steps[i]!, prev, taskType))
      confidences.push(0.7)
    }
    if (outcome >= 0.5 && n > 0) labels[n - 1] = Math.max(labels[n - 1]!, 0.85)
    if (outcome < 0.5 && n > 0) labels[n - 1] = Math.min(labels[n - 1]!, 0.2)
    return { labels, confidences }
  }

  private weakSupervisionLabel(
    steps: string[], outcome: number, taskType: TaskType,
  ): { labels: number[]; confidences: number[] } {
    const n = steps.length
    const base = outcome >= 0.5 ? 0.9 : 0.15
    const labels: number[] = []
    const confidences: number[] = []
    for (let i = 0; i < n; i++) {
      const prev = i > 0 ? steps[i - 1] : null
      const heur = heuristicScore(steps[i]!, prev, taskType)
      labels.push(0.7 * heur + 0.3 * base)
      confidences.push(0.3)
    }
    return { labels, confidences }
  }

  scorePath(steps: string[], taskType: TaskType): StepScore[] {
    return steps.map((step, i) => {
      const prev = i > 0 ? steps[i - 1] : null
      return {
        stepIndex: i,
        score: heuristicScore(step, prev, taskType),
        confidence: 0.7,
        method: "heuristic",
      }
    })
  }

  prepareTrainingData(
    paths: string[][], outcomes: number[], taskType: TaskType,
    verifierFn?: (full: string, ref: string) => boolean,
    generateFn?: (state: string) => string,
    referenceAnswers?: string[],
  ): TrainingSample[] {
    const samples: TrainingSample[] = []
    for (let p = 0; p < paths.length; p++) {
      const steps = paths[p]!
      const outcome = outcomes[p] ?? 0
      const reference = referenceAnswers?.[p]
      const { labels, confidences } = this.labelSteps(steps, outcome, taskType,
        reference !== undefined && verifierFn && generateFn
          ? { verifierFn, generateFn, referenceAnswer: reference } : undefined)
      for (let i = 1; i < steps.length; i++) {
        samples.push({ state: steps.slice(0, i).join("\n"), action: steps[i]!, label: labels[i]!, confidence: confidences[i]! })
      }
    }
    return samples
  }
}
