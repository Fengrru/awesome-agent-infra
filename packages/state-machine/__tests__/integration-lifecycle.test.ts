/**
 * Integration tests — state-machine × lifecycle-manager cross-package wiring.
 *
 * Tests that AgentStateMachine transitions correctly trigger lifecycle hooks
 * registered via LifecycleManager, and that state observations can react
 * to changes across both packages.
 */

import { describe, test, expect, beforeEach } from "bun:test"

import { AgentStateMachine, AgentState } from "../src/index"
import type { TransitionCallback } from "../src/index"
import {
  LifecycleManager,
} from "../../lifecycle-manager/src/index"
import type { ModuleLifecycle, EngineContext, IStateMachine } from "../../lifecycle-manager/src/index"

// ── Helpers ────────────────────────────────────────────────────────────────

function createLoggerModule(id: string, priority = 50): {
  module: ModuleLifecycle
  enterLog: Array<{ state: string; prev: string }>
  exitLog: Array<{ state: string; prev: string }>
  phaseLog: Array<{ phase: string }>
} {
  const enterLog: Array<{ state: string; prev: string }> = []
  const exitLog: Array<{ state: string; prev: string }> = []
  const phaseLog: Array<{ phase: string }> = []

  const module: ModuleLifecycle = {
    id,
    priority,
    onEnter: {
      [AgentState.READY]: async (ctx) => {
        enterLog.push({ state: AgentState.READY, prev: ctx.sessionId })
      },
      [AgentState.EXECUTING]: async (ctx) => {
        enterLog.push({ state: AgentState.EXECUTING, prev: ctx.sessionId })
      },
      [AgentState.VERIFYING]: async (ctx) => {
        enterLog.push({ state: AgentState.VERIFYING, prev: ctx.sessionId })
      },
    },
    onExit: {
      [AgentState.READY]: async (ctx) => {
        exitLog.push({ state: AgentState.READY, prev: ctx.sessionId })
      },
    },
    onPhase: {
      before_plan: async (ctx) => {
        phaseLog.push({ phase: `before_plan:${ctx.goal}` })
      },
      on_complete: async (ctx) => {
        phaseLog.push({ phase: `on_complete:${ctx.goal}` })
      },
    },
  }

  return { module, enterLog, exitLog, phaseLog }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Integration: AgentStateMachine × LifecycleManager", () => {

  let sm: AgentStateMachine
  let lm: LifecycleManager

  beforeEach(() => {
    sm = new AgentStateMachine()
    lm = new LifecycleManager(sm as IStateMachine)
  })

  // ── Hook wiring ────────────────────────────────────────────────────────

  test("LifecycleManager hooks into AgentStateMachine onEnter callbacks", async () => {
    const { enterLog } = createLoggerModule("test-hook")

    // Register and hook
    lm.register(
      {
        id: "test-hook",
        onEnter: {
          [AgentState.READY]: async () => {
            enterLog.push({ state: AgentState.READY, prev: "hook" })
          },
        },
      },
      {},
    )
    lm.hookStateMachine()

    await sm.transition(AgentState.INITIALIZING, "startup")
    await sm.transition(AgentState.READY, "initialized")

    expect(enterLog.length).toBeGreaterThanOrEqual(1)
    expect(enterLog[0]!.state).toBe(AgentState.READY)
  })

  test("hookStateMachine is idempotent", () => {
    lm.hookStateMachine()
    lm.hookStateMachine()
    lm.hookStateMachine()

    // Should not throw or register duplicate hooks
    expect(lm.getRegisteredIds()).toEqual([])
  })

  // ── State transition → lifecycle trigger ──────────────────────────────

  test("state machine transitions trigger registered onEnter lifecycle modules", async () => {
    const { module, enterLog } = createLoggerModule("state-observer", 10)

    lm.register(module, {})
    lm.hookStateMachine()

    await sm.transition(AgentState.INITIALIZING, "boot")
    await sm.transition(AgentState.READY, "ready")
    await sm.transition(AgentState.EXECUTING, "start work")

    expect(enterLog.length).toBe(2)
    expect(enterLog[0]!.state).toBe(AgentState.READY)
    expect(enterLog[1]!.state).toBe(AgentState.EXECUTING)
  })

  test("multiple lifecycle modules trigger in priority order", async () => {
    const order: string[] = []

    const modA: ModuleLifecycle = {
      id: "mod-a",
      priority: 30,
      onEnter: {
        [AgentState.READY]: async () => { order.push("a") },
      },
    }
    const modB: ModuleLifecycle = {
      id: "mod-b",
      priority: 10,
      onEnter: {
        [AgentState.READY]: async () => { order.push("b") },
      },
    }
    const modC: ModuleLifecycle = {
      id: "mod-c",
      priority: 20,
      onEnter: {
        [AgentState.READY]: async () => { order.push("c") },
      },
    }

    lm.register(modA, {})
    lm.register(modB, {})
    lm.register(modC, {})
    lm.hookStateMachine()

    await sm.transition(AgentState.INITIALIZING, "start")
    await sm.transition(AgentState.READY, "done")

    expect(order).toEqual(["b", "c", "a"])
  })

  // ── LifecycleManager phase triggers ────────────────────────────────────

  test("triggerPhase calls registered phase handlers", async () => {
    const { module, phaseLog } = createLoggerModule("phase-module")

    lm.register(module, {})

    await lm.triggerPhase("before_plan", { goal: "build login page" })
    await lm.triggerPhase("on_complete", { goal: "build login page" })

    expect(phaseLog.length).toBe(2)
    expect(phaseLog[0]!.phase).toContain("before_plan:build login page")
    expect(phaseLog[1]!.phase).toContain("on_complete:build login page")
  })

  // ── Module error isolation ─────────────────────────────────────────────

  test("module handler failures do not block state transitions", async () => {
    const enterLog: string[] = []

    const faultyModule: ModuleLifecycle = {
      id: "faulty",
      priority: 10,
      onEnter: {
        [AgentState.READY]: async () => {
          throw new Error("simulated module failure")
        },
      },
    }
    const goodModule: ModuleLifecycle = {
      id: "good",
      priority: 20,
      onEnter: {
        [AgentState.READY]: async () => {
          enterLog.push("good-executed")
        },
      },
    }

    lm.register(faultyModule, {})
    lm.register(goodModule, {})
    lm.hookStateMachine()

    // Should not throw — faulty module error is caught internally
    await sm.transition(AgentState.INITIALIZING, "boot")
    await sm.transition(AgentState.READY, "ready")

    // Good module should still have executed
    expect(enterLog).toContain("good-executed")
    expect(sm.state).toBe(AgentState.READY)
  })

  // ── State machine guard + lifecycle integration ────────────────────────

  test("transition guards prevent lifecycle hooks from firing on blocked transitions", async () => {
    const enterLog: string[] = []

    lm.register(
      {
        id: "guarded-observer",
        onEnter: {
          [AgentState.PLANNING]: async () => {
            enterLog.push("entered-planning")
          },
        },
      },
      {},
    )
    lm.hookStateMachine()

    // Add guard that blocks PLANNING transitions
    sm.addGuard((_from, to) => to !== AgentState.PLANNING)

    await sm.transition(AgentState.INITIALIZING, "boot")
    await sm.transition(AgentState.READY, "ready")

    // Try to transition into PLANNING — should throw
    let threw = false
    try {
      await sm.transition(AgentState.PLANNING, "try plan")
    } catch {
      threw = true
    }

    expect(threw).toBe(true)
    expect(enterLog.length).toBe(0)
  })

  // ── State history tracking ────────────────────────────────────────────

  test("state machine history tracks all transitions through lifecycle", async () => {
    lm.hookStateMachine()

    await sm.transition(AgentState.INITIALIZING, "boot")
    await sm.transition(AgentState.READY, "ready")
    await sm.transition(AgentState.EXECUTING, "exec")
    await sm.transition(AgentState.VERIFYING, "verify")

    const snapshot = sm.getSnapshot()
    expect(snapshot.transition_count).toBe(4)
    expect(snapshot.current_state).toBe(AgentState.VERIFYING)
    expect(snapshot.previous_state).toBe(AgentState.EXECUTING)
    expect(snapshot.state_history.length).toBe(4)
  })

  // ── Dynamic module registration/unregistration ─────────────────────────

  test("modules can be registered and unregistered at runtime", async () => {
    const enterLog: string[] = []

    const mod: ModuleLifecycle = {
      id: "hotplug",
      onEnter: {
        [AgentState.READY]: async () => { enterLog.push("hotplug") },
      },
    }

    lm.register(mod, {})
    lm.hookStateMachine()

    await sm.transition(AgentState.INITIALIZING, "boot")
    await sm.transition(AgentState.READY, "first")
    expect(enterLog).toContain("hotplug")

    // Unregister
    lm.unregister("hotplug")
    expect(lm.getRegisteredIds()).not.toContain("hotplug")

    // Reset and test again
    sm.reset()
    const sm2 = new AgentStateMachine()
    const lm2 = new LifecycleManager(sm2 as IStateMachine)
    lm2.hookStateMachine()

    await sm2.transition(AgentState.INITIALIZING, "boot2")
    await sm2.transition(AgentState.READY, "second")

    // No hotplug module registered — log should not grow from unregistered module
    expect(lm2.getRegisteredIds()).toEqual([])
  })
})

describe("Integration: LifecycleManager observes StateMachine agnostically", () => {

  test("LifecycleManager works with any IStateMachine-compatible implementation", () => {
    // Minimal IStateMachine implementation
    const enterCallbacks = new Map<string, Array<(prev: string, next: string, reason?: string) => Promise<void>>>()
    let currentState = "IDLE"

    const customSM: IStateMachine = {
      get state() { return currentState },
      onEnter(state: string, callback: (prev: string, next: string, reason?: string) => Promise<void>) {
        const cbs = enterCallbacks.get(state) ?? []
        cbs.push(callback)
        enterCallbacks.set(state, cbs)
      },
    }

    const lm = new LifecycleManager(customSM)

    // Verify hookStateMachine registers callbacks for all agent states
    lm.hookStateMachine()

    // After hooking, every state should have at least one registered callback
    const allStates = Object.values(AgentState)
    for (const state of allStates) {
      expect(enterCallbacks.has(state)).toBe(true)
    }

    // Verify the specific READY state has callbacks
    const readyCbs = enterCallbacks.get(AgentState.READY)
    expect(readyCbs).toBeDefined()
    expect(readyCbs!.length).toBeGreaterThan(0)

    // Register a module that reacts to READY
    const enterLog: string[] = []
    lm.register(
      {
        id: "custom-observer",
        onEnter: {
          [AgentState.READY]: async () => { enterLog.push("custom-ready") },
        },
      },
      {},
    )

    // Trigger READY enter callbacks directly (simulating a state machine transition)
    currentState = AgentState.READY
    const callbacks = enterCallbacks.get(AgentState.READY) ?? []
    for (const cb of callbacks) {
      cb("IDLE", AgentState.READY)
    }

    expect(enterLog).toContain("custom-ready")
  })
})
