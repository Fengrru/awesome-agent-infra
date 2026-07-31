import { beforeEach, describe, expect, it } from "bun:test"
import { CycleActionType, CycleController, DEFAULT_CYCLE_CONFIG, clamp } from "../src/index"
import type { ConversationMessage, CycleAction, CycleCallbacks, ICheckpointWriter } from "../src/types"

function makeHistory(n: number): ConversationMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    role: "user" as const,
    content: `message ${i}`,
  }))
}

describe("clamp", () => {
  it("returns value within bounds", () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-5, 0, 10)).toBe(0)
    expect(clamp(15, 0, 10)).toBe(10)
  })
})

describe("CycleController", () => {
  let controller: CycleController

  beforeEach(() => {
    controller = new CycleController()
  })

  it("creates with default config", () => {
    const snap = controller.getSnapshot()
    expect(snap.config.tokenBudget).toBe(128_000)
    expect(snap.config.checkpointThresholds).toEqual([0.2, 0.45, 0.7])
    expect(snap.config.rebuildThreshold).toBe(0.9)
    expect(snap.cycleIndex).toBe(0)
    expect(snap.rebuildCount).toBe(0)
  })

  it("returns NOOP when token usage is below all thresholds", () => {
    const action = controller.evaluate(1000, 128_000, "s1", [])
    expect(action.type).toBe(CycleActionType.NOOP)
  })

  it("triggers CHECKPOINT at first threshold (20%)", () => {
    controller.advanceStep(5)
    const usage = Math.ceil(128_000 * 0.22)
    const action = controller.evaluate(usage, 128_000, "s1", makeHistory(10))
    expect(action.type).toBe(CycleActionType.CHECKPOINT)
    expect(action.threshold).toBe(0.2)
  })

  it("does NOT trigger same checkpoint threshold twice", async () => {
    controller.advanceStep(5)
    const usage1 = Math.ceil(128_000 * 0.25)
    const action1 = controller.evaluate(usage1, 128_000, "s1", makeHistory(10))
    await controller.executeCheckpoint("s1", makeHistory(10), action1)
    const state = controller.getSnapshot()
    expect(state.triggeredThresholds).toContain(0.2)

    controller.advanceStep(5)
    // Increase usage past the next threshold (0.45)
    const usage2 = Math.ceil(128_000 * 0.5)
    const action2 = controller.evaluate(usage2, 128_000, "s1", makeHistory(10))
    expect(action2.type).toBe(CycleActionType.CHECKPOINT)
    expect(action2.threshold).toBe(0.45)
  })

  it("triggers REBUILD at 90% threshold", () => {
    const usage = Math.ceil(128_000 * 0.92)
    const action = controller.evaluate(usage, 128_000, "s1", makeHistory(10))
    expect(action.type).toBe(CycleActionType.REBUILD)
  })

  it("respects minStepsBetweenCheckpoints", () => {
    const usage = Math.ceil(128_000 * 0.22)
    const action = controller.evaluate(usage, 128_000, "s1", makeHistory(10))
    expect(action.type).toBe(CycleActionType.NOOP)
    expect(action.reason).toContain("minStepsBetweenCheckpoints")
  })

  it("advanceStep increments counter", () => {
    expect(controller.getSnapshot().stepsSinceLastCheckpoint).toBe(0)
    controller.advanceStep(3)
    expect(controller.getSnapshot().stepsSinceLastCheckpoint).toBe(3)
  })

  it("getSnapshot and restoreFromSnapshot are symmetric", () => {
    const c = new CycleController({
      config: { tokenBudget: 100_000, maxCycles: 50 },
    })
    c.advanceStep(10)
    const usage1 = Math.ceil(100_000 * 0.25)
    c.evaluate(usage1, 100_000, "s1", makeHistory(10))
    const usage2 = Math.ceil(100_000 * 0.5)
    c.evaluate(usage2, 100_000, "s1", makeHistory(10))

    const snap = c.getSnapshot()
    const restored = new CycleController()
    restored.restoreFromSnapshot(snap)
    expect(restored.getSnapshot()).toEqual(snap)
  })

  it("executeCheckpoint calls writer when set", async () => {
    const writer: ICheckpointWriter = {
      async write(sid, hist, inc, idx) {
        return `ckpt-${sid}-${idx}`
      },
    }
    const c = new CycleController({ checkpointWriter: writer })
    c.advanceStep(5)
    const usage = Math.ceil(128_000 * 0.25)
    const action = c.evaluate(usage, 128_000, "s1", makeHistory(5))
    const result = await c.executeCheckpoint("s1", makeHistory(5), action)
    expect(result).toBe("ckpt-s1-0")
    expect(c.getSnapshot().stepsSinceLastCheckpoint).toBe(0)
  })

  it("executeCheckpoint returns null when writer is not set", async () => {
    const c = new CycleController()
    c.advanceStep(5)
    const usage = Math.ceil(128_000 * 0.25)
    const action = c.evaluate(usage, 128_000, "s1", makeHistory(5))
    const result = await c.executeCheckpoint("s1", makeHistory(5), action)
    expect(result).toBeNull()
  })

  it("executeRebuild advances cycle index and clears thresholds", async () => {
    const c = new CycleController()
    const action: CycleAction = {
      type: CycleActionType.REBUILD,
      threshold: 0.9,
      reason: "test rebuild",
    }
    await c.executeRebuild("s1", action)
    const snap = c.getSnapshot()
    expect(snap.cycleIndex).toBe(1)
    expect(snap.rebuildCount).toBe(1)
    expect(snap.triggeredThresholds).toEqual([])
    expect(snap.totalCyclesCompleted).toBe(1)
  })

  it("executeRebuild invokes callbacks", async () => {
    const calls: string[] = []
    const callbacks: CycleCallbacks = {
      onCompactingStart: async () => {
        calls.push("start")
      },
      onRebuild: async () => {
        calls.push("rebuild")
      },
      onCompactingEnd: async () => {
        calls.push("end")
      },
    }
    const c = new CycleController({ callbacks })
    const action: CycleAction = {
      type: CycleActionType.REBUILD,
      threshold: 0.9,
    }
    await c.executeRebuild("s1", action)
    expect(calls).toEqual(["start", "rebuild", "end"])
  })

  it("respects maxCycles limit", () => {
    const c = new CycleController({ config: { maxCycles: 2 } })
    const usage = Math.ceil(128_000 * 0.95)

    // First rebuild
    let action = c.evaluate(usage, 128_000, "s1", makeHistory(10))
    expect(action.type).toBe(CycleActionType.REBUILD)

    // After 2 rebuilds, no more rebuilds
    // We need to simulate what happens after a rebuild
    const snap = c.getSnapshot()
    snap.totalCyclesCompleted = 2
    c.restoreFromSnapshot(snap)

    action = c.evaluate(usage, 128_000, "s1", makeHistory(10))
    expect(action.type).toBe(CycleActionType.NOOP)
    expect(action.reason).toBe("maxCycles reached")
  })

  it("works standalone without eventBus or stateMachine", () => {
    const c = new CycleController()
    c.advanceStep(5)
    const usage = Math.ceil(128_000 * 0.22)
    const action = c.evaluate(usage, 128_000, "s1", makeHistory(10))
    expect(action.type).toBe(CycleActionType.CHECKPOINT)
  })

  it("respects custom tokenBudget from evaluate argument", () => {
    const c = new CycleController()
    c.advanceStep(5)
    const usage = Math.ceil(200_000 * 0.22)
    const action = c.evaluate(usage, 200_000, "s1", makeHistory(10))
    expect(action.type).toBe(CycleActionType.CHECKPOINT)
    expect(action.threshold).toBe(0.2)
  })

  it("reset clears all state", () => {
    const c = new CycleController()
    c.advanceStep(10)
    c.reset()
    const snap = c.getSnapshot()
    expect(snap.cycleIndex).toBe(0)
    expect(snap.stepsSinceLastCheckpoint).toBe(0)
    expect(snap.triggeredThresholds).toEqual([])
  })
})
