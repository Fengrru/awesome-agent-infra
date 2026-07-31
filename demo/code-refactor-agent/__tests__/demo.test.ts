import { describe, expect, test } from "bun:test"
import { CodeRefactorScenario } from "../src/scenario"

describe("Code Refactor Agent Demo", () => {
  test("completes all 8 package steps successfully", async () => {
    const scenario = new CodeRefactorScenario()
    const result = await scenario.run()

    expect(result.steps.length).toBeGreaterThanOrEqual(8)
    expect(result.steps.every((s) => s.status === "pass")).toBe(true)
    expect(result.overall).toBe("success")
    expect(result.snapshot.finalState).toBe("COMPLETED")
  })

  test("each package step has required fields", async () => {
    const scenario = new CodeRefactorScenario()
    const result = await scenario.run()

    for (const step of result.steps) {
      expect(step).toHaveProperty("step")
      expect(step).toHaveProperty("label")
      expect(step).toHaveProperty("package")
      expect(step).toHaveProperty("status")
      expect(step).toHaveProperty("detail")
    }
  })

  test("state machine tracks at least 5 transitions", async () => {
    const scenario = new CodeRefactorScenario()
    const result = await scenario.run()

    expect(result.snapshot.transitionCount).toBeGreaterThanOrEqual(5)
    expect(result.snapshot.finalState).toBe("COMPLETED")
  })

  test("confidence gate produces a valid report", async () => {
    const scenario = new CodeRefactorScenario()
    const result = await scenario.run()

    const conf = result.snapshot.confidence as { ece: number; temperature: number; threshold: number } | null
    expect(conf).not.toBeNull()
    expect(conf!.ece).toBeGreaterThan(0)
    expect(conf!.temperature).toBeGreaterThan(0)
    expect(conf!.threshold).toBeGreaterThan(0)
  })
})
