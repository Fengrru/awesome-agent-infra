// Frozen E1 protocol. These values are part of every recorded result; change
// them only as a new experiment id, never silently.
export interface Protocol {
  maxSteps: number
  memoryTokenBudget: number
  temperature: number
  retrieveTopK: number
  testPhases: number
}

export const PROTOCOL: Protocol = {
  maxSteps: 30,
  // All systems inject memory under the same budget and the same rendering
  // (assembleContext). No system gets extra context on top.
  memoryTokenBudget: 8000,
  temperature: 0,
  retrieveTopK: 10,
  testPhases: 1,
}

export const DEFAULT_SEEDS = [1, 2, 3]

import { agentEnv } from "../src/cli-config.js"

export function defaultModelName(): string {
  return agentEnv("MODEL") ?? "deepseek-chat"
}

export function defaultBaseUrl(): string {
  return process.env.OPENAI_BASE_URL ?? "https://api.deepseek.com/v1"
}
