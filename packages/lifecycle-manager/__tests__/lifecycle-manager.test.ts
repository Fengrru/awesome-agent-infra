import { describe, expect, test } from "bun:test"
import {
  LifecycleManager,
  AgentState,
  type IStateMachine,
  type ModuleLifecycle,
  type EngineContext,
} from "../src/index"

/** Minimal fake state machine capturing onEnter registrations */
class FakeStateMachine implements IStateMachine {
  state = AgentState.IDLE as string
  callbacks = new Map<string, (prev: string, next: string, reason?: string) => Promise<void>>()

  onEnter(state: string, callback: (prev: string, next: string, reason?: string) => Promise<void>): void {
    this.callbacks.set(state, callback)
  }

  async fireEnter(state: string): Promise<void> {
    await this.callbacks.get(state)?.("", state)
  }
}

function makeManager() {
  const sm = new FakeStateMachine()
  return { sm, manager: new LifecycleManager(sm) }
}

describe("registration", () => {
  test("register / unregister / getRegisteredIds", () => {
    const { manager } = makeManager()
    manager.register({ id: "mod-a" }, {})
    manager.register({ id: "mod-b" }, {})
    expect(manager.getRegisteredIds().sort()).toEqual(["mod-a", "mod-b"])

    manager.unregister("mod-a")
    expect(manager.getRegisteredIds()).toEqual(["mod-b"])
  })

  test("re-registering same id replaces the module", async () => {
    const { manager } = makeManager()
    const calls: string[] = []
    manager.register(
      { id: "mod", onEnter: { [AgentState.READY]: async () => { calls.push("v1") } } },
      {},
    )
    manager.register(
      { id: "mod", onEnter: { [AgentState.READY]: async () => { calls.push("v2") } } },
      {},
    )
    await manager.triggerStateEnter(AgentState.READY)
    expect(calls).toEqual(["v2"])
  })

  test("getRegistered returns lifecycle definitions", () => {
    const { manager } = makeManager()
    const lc: ModuleLifecycle = { id: "mod-a", priority: 10 }
    manager.register(lc, {})
    expect(manager.getRegistered()[0]!.id).toBe("mod-a")
    expect(manager.getRegistered()[0]!.priority).toBe(10)
  })
})

describe("triggerStateEnter", () => {
  test("invokes only modules hooked to that state", async () => {
    const { manager } = makeManager()
    const calls: string[] = []
    manager.register({ id: "a", onEnter: { [AgentState.READY]: async () => { calls.push("a") } } }, {})
    manager.register({ id: "b", onEnter: { [AgentState.FAILED]: async () => { calls.push("b") } } }, {})

    await manager.triggerStateEnter(AgentState.READY)
    expect(calls).toEqual(["a"])
  })

  test("executes in priority order (lower first), default priority 50", async () => {
    const { manager } = makeManager()
    const calls: string[] = []
    manager.register(
      { id: "late", priority: 90, onEnter: { [AgentState.READY]: async () => { calls.push("late") } } },
      {},
    )
    manager.register(
      { id: "default", onEnter: { [AgentState.READY]: async () => { calls.push("default") } } },
      {},
    )
    manager.register(
      { id: "early", priority: 1, onEnter: { [AgentState.READY]: async () => { calls.push("early") } } },
      {},
    )
    await manager.triggerStateEnter(AgentState.READY)
    expect(calls).toEqual(["early", "default", "late"])
  })

  test("module failure is isolated and does not block others", async () => {
    const { manager } = makeManager()
    const calls: string[] = []
    manager.register(
      { id: "boom", priority: 1, onEnter: { [AgentState.READY]: async () => { throw new Error("boom") } } },
      {},
    )
    manager.register(
      { id: "ok", priority: 2, onEnter: { [AgentState.READY]: async () => { calls.push("ok") } } },
      {},
    )
    await manager.triggerStateEnter(AgentState.READY)
    expect(calls).toEqual(["ok"])
  })

  test("passes context fields and injected module deps", async () => {
    const { manager } = makeManager()
    let received: EngineContext | null = null
    const myDep = { name: "dep" }
    manager.register(
      { id: "mod", onEnter: { [AgentState.EXECUTING]: async (ctx) => { received = ctx } } },
      { myDep },
    )
    await manager.triggerStateEnter(AgentState.EXECUTING, { sessionId: "s1", goal: "g", stepCount: 3 })
    expect(received!.sessionId).toBe("s1")
    expect(received!.goal).toBe("g")
    expect(received!.stepCount).toBe(3)
    expect((received!.modules as { myDep: unknown }).myDep).toBe(myDep)
  })

  test("context defaults are filled when not provided", async () => {
    const { manager } = makeManager()
    let received: EngineContext | null = null
    manager.register(
      { id: "mod", onEnter: { [AgentState.IDLE]: async (ctx) => { received = ctx } } },
      {},
    )
    await manager.triggerStateEnter(AgentState.IDLE)
    expect(received!.sessionId).toBe("")
    expect(received!.tokenUsage).toBe(0)
    expect(received!.currentDAG).toBeNull()
  })
})

describe("triggerStateExit", () => {
  test("invokes onExit hooks in priority order with error isolation", async () => {
    const { manager } = makeManager()
    const calls: string[] = []
    manager.register(
      { id: "b", priority: 2, onExit: { [AgentState.EXECUTING]: async () => { calls.push("b") } } },
      {},
    )
    manager.register(
      { id: "boom", priority: 1, onExit: { [AgentState.EXECUTING]: async () => { throw new Error("x") } } },
      {},
    )
    await manager.triggerStateExit(AgentState.EXECUTING)
    expect(calls).toEqual(["b"])
  })
})

describe("triggerPhase", () => {
  test("invokes matching phase hooks only", async () => {
    const { manager } = makeManager()
    const calls: string[] = []
    manager.register({ id: "a", onPhase: { before_step: async () => { calls.push("before") } } }, {})
    manager.register({ id: "b", onPhase: { after_step: async () => { calls.push("after") } } }, {})

    await manager.triggerPhase("before_step")
    expect(calls).toEqual(["before"])
    await manager.triggerPhase("after_step")
    expect(calls).toEqual(["before", "after"])
  })

  test("phase with no subscribers is a no-op", async () => {
    const { manager } = makeManager()
    await manager.triggerPhase("on_shutdown")
    // no throw = pass
  })
})

describe("hookStateMachine", () => {
  test("registers onEnter callback for every AgentState", () => {
    const { sm, manager } = makeManager()
    manager.hookStateMachine()
    for (const state of Object.values(AgentState)) {
      expect(sm.callbacks.has(state)).toBe(true)
    }
  })

  test("is idempotent — second call does not re-register", () => {
    const { sm, manager } = makeManager()
    manager.hookStateMachine()
    const count = sm.callbacks.size
    manager.hookStateMachine()
    expect(sm.callbacks.size).toBe(count)
  })

  test("state machine transition triggers module hooks", async () => {
    const { sm, manager } = makeManager()
    const calls: string[] = []
    manager.register(
      { id: "mod", onEnter: { [AgentState.PLANNING]: async () => { calls.push("planned") } } },
      {},
    )
    manager.hookStateMachine()
    await sm.fireEnter(AgentState.PLANNING)
    expect(calls).toEqual(["planned"])
  })
})
