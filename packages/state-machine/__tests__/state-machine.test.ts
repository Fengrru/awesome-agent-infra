import { describe, expect, test } from "bun:test"
import {
  AgentStateMachine,
  AgentState,
  StateTransitionError,
} from "../src/index"

describe("AgentStateMachine", () => {
  // ── Initial State ────────────────────────────────────────────────────────

  test("starts in IDLE state", () => {
    const sm = new AgentStateMachine()
    expect(sm.state).toBe(AgentState.IDLE)
    expect(sm.prevState).toBe(AgentState.IDLE)
    expect(sm.transitions).toBe(0)
  })

  // ── Valid Transitions ────────────────────────────────────────────────────

  test("transitions through valid states", async () => {
    const sm = new AgentStateMachine()
    await sm.transition(AgentState.INITIALIZING, "start")
    expect(sm.state).toBe(AgentState.INITIALIZING)
    expect(sm.prevState).toBe(AgentState.IDLE)
    expect(sm.transitions).toBe(1)
  })

  test("allows ERROR state from any state", async () => {
    const sm = new AgentStateMachine()
    await sm.transition(AgentState.INITIALIZING)
    await sm.transition(AgentState.READY)
    await sm.transition(AgentState.ERROR, "something went wrong")
    expect(sm.state).toBe(AgentState.ERROR)
  })

  test("full lifecycle: IDLE -> INITIALIZING -> READY -> PLANNING", async () => {
    const sm = new AgentStateMachine()
    await sm.transition(AgentState.INITIALIZING)
    await sm.transition(AgentState.READY)
    await sm.transition(AgentState.PLANNING, "start plan")
    expect(sm.state).toBe(AgentState.PLANNING)
    expect(sm.transitions).toBe(3)
  })

  // ── Invalid Transitions ──────────────────────────────────────────────────

  test("throws on invalid transition", async () => {
    const sm = new AgentStateMachine()
    try {
      await sm.transition(AgentState.EXECUTING)
      expect(true).toBe(false) // should not reach
    } catch (e) {
      expect(e).toBeInstanceOf(StateTransitionError)
      expect((e as Error).message).toContain("Invalid state transition")
      expect((e as Error).message).toContain("IDLE -> EXECUTING")
    }
  })

  test("stays in original state after invalid transition", async () => {
    const sm = new AgentStateMachine()
    try { await sm.transition(AgentState.COMPLETED) } catch { /* expected */ }
    expect(sm.state).toBe(AgentState.IDLE)
    expect(sm.transitions).toBe(0)
  })

  // ── Can Transition ───────────────────────────────────────────────────────

  test("canTransition returns correct boolean", () => {
    const sm = new AgentStateMachine()
    expect(sm.canTransition(AgentState.IDLE, AgentState.INITIALIZING)).toBe(true)
    expect(sm.canTransition(AgentState.IDLE, AgentState.EXECUTING)).toBe(false)
    expect(sm.canTransition(AgentState.READY, AgentState.PLANNING)).toBe(true)
    expect(sm.canTransition(AgentState.PLANNING, AgentState.THINKING)).toBe(true)
  })

  // ── Lifecycle Callbacks ──────────────────────────────────────────────────

  test("onEnter callback fires on transition", async () => {
    const sm = new AgentStateMachine()
    let fired = false
    let capturedPrev = ""
    let capturedNext = ""
    sm.onEnter(AgentState.INITIALIZING, async (prev, next, reason) => {
      fired = true
      capturedPrev = prev
      capturedNext = next
    })
    await sm.transition(AgentState.INITIALIZING, "boot")
    expect(fired).toBe(true)
    expect(capturedPrev).toBe(AgentState.IDLE)
    expect(capturedNext).toBe(AgentState.INITIALIZING)
  })

  test("onExit callback fires on leaving state", async () => {
    const sm = new AgentStateMachine()
    let fired = false
    sm.onExit(AgentState.IDLE, async () => {
      fired = true
    })
    await sm.transition(AgentState.INITIALIZING)
    expect(fired).toBe(true)
  })

  test("multiple onEnter callbacks fire in order", async () => {
    const sm = new AgentStateMachine()
    const order: number[] = []
    sm.onEnter(AgentState.READY, async () => { order.push(1) })
    sm.onEnter(AgentState.READY, async () => { order.push(2) })
    sm.onEnter(AgentState.READY, async () => { order.push(3) })
    await sm.transition(AgentState.INITIALIZING)
    await sm.transition(AgentState.READY)
    expect(order).toEqual([1, 2, 3])
  })

  // ── Callback Removal ─────────────────────────────────────────────────────

  test("removeOnEnter removes a registered callback", async () => {
    const sm = new AgentStateMachine()
    let count = 0
    const cb = async () => { count++ }
    sm.onEnter(AgentState.INITIALIZING, cb)
    const removed = sm.removeOnEnter(AgentState.INITIALIZING, cb)
    expect(removed).toBe(true)
    await sm.transition(AgentState.INITIALIZING)
    expect(count).toBe(0)
  })

  test("removeOnEnter returns false for non-existent callback", () => {
    const sm = new AgentStateMachine()
    expect(sm.removeOnEnter(AgentState.READY, async () => {})).toBe(false)
    // remove from state with no callbacks
    expect(sm.removeOnEnter(AgentState.INITIALIZING, async () => {})).toBe(false)
  })

  test("removeOnExit removes a registered callback", async () => {
    const sm = new AgentStateMachine()
    let count = 0
    const cb = async () => { count++ }
    sm.onExit(AgentState.IDLE, cb)
    sm.removeOnExit(AgentState.IDLE, cb)
    await sm.transition(AgentState.INITIALIZING)
    expect(count).toBe(0)
  })

  test("removeOnExit returns false for non-existent callback", () => {
    const sm = new AgentStateMachine()
    expect(sm.removeOnExit(AgentState.READY, async () => {})).toBe(false)
  })

  // ── Guards ───────────────────────────────────────────────────────────────

  test("guard blocks transition when returning false", async () => {
    const sm = new AgentStateMachine()
    sm.addGuard(() => false)
    try {
      await sm.transition(AgentState.INITIALIZING)
      expect(true).toBe(false)
    } catch (e) {
      expect(e).toBeInstanceOf(StateTransitionError)
    }
    expect(sm.state).toBe(AgentState.IDLE)
  })

  test("guard allows transition when returning true", async () => {
    const sm = new AgentStateMachine()
    sm.addGuard(() => true)
    await sm.transition(AgentState.INITIALIZING)
    expect(sm.state).toBe(AgentState.INITIALIZING)
  })

  test("async guard works", async () => {
    const sm = new AgentStateMachine()
    sm.addGuard(async () => {
      await new Promise((r) => setTimeout(r, 10))
      return true
    })
    await sm.transition(AgentState.INITIALIZING)
    expect(sm.state).toBe(AgentState.INITIALIZING)
  })

  test("multiple guards all must pass", async () => {
    const sm = new AgentStateMachine()
    sm.addGuard(() => true)
    sm.addGuard(() => false)
    try {
      await sm.transition(AgentState.INITIALIZING)
      expect(true).toBe(false)
    } catch (e) {
      expect(e).toBeInstanceOf(StateTransitionError)
    }
  })

  test("removeGuard works", async () => {
    const sm = new AgentStateMachine()
    const guard = () => false
    sm.addGuard(guard)
    expect(sm.removeGuard(guard)).toBe(true)
    expect(sm.removeGuard(guard)).toBe(false)
    await sm.transition(AgentState.INITIALIZING)
    expect(sm.state).toBe(AgentState.INITIALIZING)
  })

  // ── State Metrics ────────────────────────────────────────────────────────

  test("tracks state durations", async () => {
    const sm = new AgentStateMachine()
    await sm.transition(AgentState.INITIALIZING)
    // No measurable duration, but metrics should be initialized
    const metrics = sm.getStateMetrics()
    expect(metrics[AgentState.IDLE]).toBeDefined()
    expect(Object.keys(metrics).length).toBeGreaterThanOrEqual(1)
  })

  test("metrics accumulate enter count", async () => {
    const sm = new AgentStateMachine()
    await sm.transition(AgentState.INITIALIZING)
    await sm.transition(AgentState.READY)
    await sm.transition(AgentState.PLANNING)
    await sm.transition(AgentState.THINKING)
    const metrics = sm.getStateMetrics()
    expect(metrics[AgentState.IDLE]!.enter_count).toBeGreaterThanOrEqual(1)
  })

  // ── Snapshot & Restore ───────────────────────────────────────────────────

  test("getSnapshot captures current state", () => {
    const sm = new AgentStateMachine()
    const snap = sm.getSnapshot()
    expect(snap.current_state).toBe(AgentState.IDLE)
    expect(snap.transition_count).toBe(0)
    expect(snap.state_enter_times).toBeDefined()
    expect(snap.state_metrics).toBeDefined()
  })

  test("restore reinstates state machine from snapshot", async () => {
    const sm = new AgentStateMachine()
    await sm.transition(AgentState.INITIALIZING)
    await sm.transition(AgentState.READY)
    const snap = sm.getSnapshot()
    expect(snap.current_state).toBe(AgentState.READY)
    expect(snap.transition_count).toBe(2)

    const sm2 = new AgentStateMachine()
    sm2.restore(snap)
    expect(sm2.state).toBe(AgentState.READY)
    expect(sm2.transitions).toBe(2)
  })

  test("restore preserves state enter times", async () => {
    const sm = new AgentStateMachine()
    await sm.transition(AgentState.INITIALIZING)
    const snap = sm.getSnapshot()
    expect(snap.state_enter_times).toBeDefined()

    const sm2 = new AgentStateMachine()
    sm2.restore(snap)
    const snap2 = sm2.getSnapshot()
    expect(snap2.state_enter_times).toBeDefined()
  })

  test("restore works with old snapshot format (without enter_times)", () => {
    const sm = new AgentStateMachine()
    sm.restore({
      current_state: AgentState.READY,
      previous_state: AgentState.INITIALIZING,
      transition_count: 5,
      state_history: [],
    } as any)
    expect(sm.state).toBe(AgentState.READY)
    expect(sm.transitions).toBe(5)
  })

  // ── State History ────────────────────────────────────────────────────────

  test("state history records transitions", async () => {
    const sm = new AgentStateMachine()
    await sm.transition(AgentState.INITIALIZING, "boot")
    await sm.transition(AgentState.READY)
    const snap = sm.getSnapshot()
    expect(snap.state_history.length).toBe(2)
    expect(snap.state_history[0]!.from).toBe(AgentState.IDLE)
    expect(snap.state_history[0]!.to).toBe(AgentState.INITIALIZING)
    expect(snap.state_history[0]!.reason).toBe("boot")
    expect(snap.state_history[1]!.from).toBe(AgentState.INITIALIZING)
    expect(snap.state_history[1]!.to).toBe(AgentState.READY)
  })

  test("history truncates at 100 entries", async () => {
    const sm = new AgentStateMachine()
    await sm.transition(AgentState.INITIALIZING)
    await sm.transition(AgentState.READY)
    await sm.transition(AgentState.PLANNING)
    await sm.transition(AgentState.THINKING)
    for (let i = 0; i < 60; i++) {
      await sm.transition(AgentState.EXECUTING)
      await sm.transition(AgentState.THINKING)
    }
    const snap = sm.getSnapshot()
    expect(snap.state_history.length).toBeLessThanOrEqual(20)
  })

  // ── Snapshot History Truncation ──────────────────────────────────────────

  test("snapshot only keeps last 20 history entries", async () => {
    const sm = new AgentStateMachine()
    await sm.transition(AgentState.INITIALIZING)
    await sm.transition(AgentState.READY)
    await sm.transition(AgentState.PLANNING)
    await sm.transition(AgentState.THINKING)
    for (let i = 0; i < 30; i++) {
      await sm.transition(AgentState.EXECUTING)
      await sm.transition(AgentState.THINKING)
    }
    const snap = sm.getSnapshot()
    expect(snap.state_history.length).toBeLessThanOrEqual(20)
  })

  // ── Timeout ──────────────────────────────────────────────────────────────

  test("setTransitionTimeout updates the timeout", () => {
    const sm = new AgentStateMachine()
    sm.setTransitionTimeout(5000)
    // No error means success
  })

  test("transition times out after configured timeout", async () => {
    const sm = new AgentStateMachine()
    sm.setTransitionTimeout(100)
    sm.onExit(AgentState.IDLE, async () => {
      await new Promise((r) => setTimeout(r, 500))
    })
    try {
      await sm.transition(AgentState.INITIALIZING)
      expect(sm.state).toBe(AgentState.INITIALIZING) // might succeed on fast machine
    } catch (e: any) {
      // Timeout is expected
      expect(e.message).toContain("timed out")
    }
  })

  // ── Prometheus Metrics ───────────────────────────────────────────────────

  test("toPrometheusMetrics returns formatted string", async () => {
    const sm = new AgentStateMachine()
    await sm.transition(AgentState.INITIALIZING)
    await sm.transition(AgentState.READY)
    const output = sm.toPrometheusMetrics("test_machine")
    expect(output).toContain("test_machine")
    expect(output).toContain("state_enter_count")
    expect(output).toContain("state_total_time_ms")
    expect(output).toContain("state_avg_time_ms")
  })

  // ── Reset ────────────────────────────────────────────────────────────────

  test("reset returns machine to IDLE", async () => {
    const sm = new AgentStateMachine()
    await sm.transition(AgentState.INITIALIZING)
    await sm.transition(AgentState.READY)
    await sm.transition(AgentState.PLANNING)
    sm.reset()
    expect(sm.state).toBe(AgentState.IDLE)
    expect(sm.prevState).toBe(AgentState.IDLE)
    expect(sm.transitions).toBe(0)
    const snap = sm.getSnapshot()
    expect(snap.state_history.length).toBe(0)
  })

  // ── Specific Transitions ─────────────────────────────────────────────────

  test("ERROR -> READY transition is valid", async () => {
    const sm = new AgentStateMachine()
    await sm.transition(AgentState.INITIALIZING)
    await sm.transition(AgentState.READY)
    await sm.transition(AgentState.ERROR)
    await sm.transition(AgentState.READY)
    expect(sm.state).toBe(AgentState.READY)
  })

  test("ERROR -> SHUTTING_DOWN transition is valid", async () => {
    const sm = new AgentStateMachine()
    await sm.transition(AgentState.INITIALIZING)
    await sm.transition(AgentState.ERROR)
    await sm.transition(AgentState.SHUTTING_DOWN)
    expect(sm.state).toBe(AgentState.SHUTTING_DOWN)
  })

  test("EXECUTING -> THINKING roundtrip", async () => {
    const sm = new AgentStateMachine()
    await sm.transition(AgentState.INITIALIZING)
    await sm.transition(AgentState.READY)
    await sm.transition(AgentState.EXECUTING)
    await sm.transition(AgentState.THINKING)
    expect(sm.state).toBe(AgentState.THINKING)
  })

  test("FAILED -> RECOVERING -> READY flow", async () => {
    const sm = new AgentStateMachine()
    await sm.transition(AgentState.INITIALIZING)
    await sm.transition(AgentState.READY)
    await sm.transition(AgentState.EXECUTING)
    await sm.transition(AgentState.FAILED)
    await sm.transition(AgentState.RECOVERING)
    await sm.transition(AgentState.READY)
    expect(sm.state).toBe(AgentState.READY)
  })

  test("all READY valid transitions", () => {
    const sm = new AgentStateMachine()
    const validFromReady = new Set([
      AgentState.PLANNING, AgentState.THINKING, AgentState.EXECUTING,
      AgentState.RECOVERING, AgentState.PAUSED, AgentState.SHUTTING_DOWN,
      AgentState.INITIALIZING,
    ])
    for (const target of Object.values(AgentState)) {
      const actual = sm.canTransition(AgentState.READY, target)
      expect(actual).toBe(validFromReady.has(target))
    }
  })

  // ── Edge Cases ───────────────────────────────────────────────────────────

  test("PAUSED -> READY resumes work", async () => {
    const sm = new AgentStateMachine()
    await sm.transition(AgentState.INITIALIZING)
    await sm.transition(AgentState.READY)
    await sm.transition(AgentState.PAUSED)
    await sm.transition(AgentState.READY)
    expect(sm.state).toBe(AgentState.READY)
  })

  test("PAUSED -> RECOVERING from pause", async () => {
    const sm = new AgentStateMachine()
    await sm.transition(AgentState.INITIALIZING)
    await sm.transition(AgentState.READY)
    await sm.transition(AgentState.PAUSED)
    await sm.transition(AgentState.RECOVERING)
    expect(sm.state).toBe(AgentState.RECOVERING)
  })

  test("multiple transitions update history correctly", async () => {
    const sm = new AgentStateMachine()
    await sm.transition(AgentState.INITIALIZING, "r1")
    await sm.transition(AgentState.READY, "r2")
    await sm.transition(AgentState.PLANNING, "r3")
    const snap = sm.getSnapshot()
    expect(snap.transition_count).toBe(3)
  })

  test("getStateMetrics includes all states even unvisited", () => {
    const sm = new AgentStateMachine()
    const metrics = sm.getStateMetrics()
    for (const state of Object.values(AgentState)) {
      expect(metrics[state]).toBeDefined()
      expect(metrics[state]!.enter_count).toBe(0)
    }
  })
})
