import { describe, expect, test } from "bun:test"
import {
  StatelessWorkerPool,
  TimeoutError,
  type L1Snapshot,
} from "../src/index"

function makeSnapshot(overrides?: Partial<L1Snapshot>): L1Snapshot {
  return {
    sessionId: "test-session",
    cycleIndex: 0,
    checkpointId: "cp-0",
    createdAt: Date.now(),
    memory: { l2Working: [], l3LongTerm: [] },
    state: {},
    ...overrides,
  }
}

function makeTask(
  overrides: Partial<{
    taskId: string
    nodeId: string
    capabilityId: string
    inputs: Record<string, unknown>
  }> = {},
) {
  return {
    taskId: overrides.taskId ?? "t1",
    nodeId: overrides.nodeId ?? "n1",
    capabilityId: overrides.capabilityId ?? "noop",
    inputs: overrides.inputs ?? {},
    contextSnapshot: makeSnapshot(),
  }
}

describe("StatelessWorkerPool", () => {
  // ── Registry ───────────────────────────────────────────────────────────

  test("registerHandler and execute a task", async () => {
    const pool = new StatelessWorkerPool()

    pool.registerHandler("uppercase", async (task) => {
      const text = task.inputs.text as string
      return {
        taskId: task.taskId,
        nodeId: task.nodeId,
        success: true,
        output: text.toUpperCase(),
        durationMs: 0,
        tokenCost: 0,
      }
    })

    const result = await pool.executeTask(makeTask({
      capabilityId: "uppercase",
      inputs: { text: "hello" },
    }))

    expect(result.success).toBe(true)
    expect(result.output).toBe("HELLO")
    expect(result.durationMs).toBeGreaterThanOrEqual(0)

    await pool.shutdown()
  })

  test("unregisterHandler removes handler and returns true", async () => {
    const pool = new StatelessWorkerPool()

    pool.registerHandler("temp", async (task) => ({
      taskId: task.taskId,
      nodeId: task.nodeId,
      success: true,
      output: { done: true },
      durationMs: 0,
      tokenCost: 0,
    }))
    expect(pool.getHandlerCount()).toBe(1)

    const removed = pool.unregisterHandler("temp")
    expect(removed).toBe(true)
    expect(pool.getHandlerCount()).toBe(0)

    await pool.shutdown()
  })

  test("executeTask fails for unregistered capability", async () => {
    const pool = new StatelessWorkerPool()

    const result = await pool.executeTask(makeTask({
      capabilityId: "nonexistent",
    }))

    expect(result.success).toBe(false)
    expect(result.error).toContain("No handler registered")

    await pool.shutdown()
  })

  // ── Timeout and Abort ──────────────────────────────────────────────────

  test("task times out and returns TimeoutError", async () => {
    const pool = new StatelessWorkerPool(3, 10)

    pool.registerHandler("slow", async (task) => {
      return new Promise((resolve) => {
        const id = setTimeout(() => {
          resolve({
            taskId: task.taskId,
            nodeId: task.nodeId,
            success: true,
            output: { done: true },
            durationMs: 0,
            tokenCost: 0,
          })
        }, 5000)
        task.signal?.addEventListener("abort", () => {
          clearTimeout(id)
          resolve({
            taskId: task.taskId,
            nodeId: task.nodeId,
            success: false,
            error: "Aborted",
            durationMs: 0,
            tokenCost: 0,
          })
        })
      })
    })

    const result = await pool.executeTask(makeTask({ capabilityId: "slow" }))

    expect(result.success).toBe(false)
    expect(result.error).toContain("timed out")

    await pool.shutdown()
  })

  test("TimeoutError is a proper Error subclass", () => {
    const err = new TimeoutError(5000)
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe("TimeoutError")
    expect(err.message).toContain("5000")
  })

  test("task can be aborted via external signal", async () => {
    const pool = new StatelessWorkerPool(3, 30_000)
    const controller = new AbortController()

    pool.registerHandler("abortable", async (task) => {
      return new Promise((resolve) => {
        task.signal?.addEventListener("abort", () =>
          resolve({
            taskId: task.taskId,
            nodeId: task.nodeId,
            success: false,
            error: "Aborted",
            durationMs: 0,
            tokenCost: 0,
          }),
        )
      })
    })

    setTimeout(() => controller.abort(), 20)

    const result = await pool.executeTask({
      ...makeTask({ capabilityId: "abortable" }),
      signal: controller.signal,
    })

    expect(result.success).toBe(false)

    await pool.shutdown()
  })

  // ── Parallel Execution ─────────────────────────────────────────────────

  test("executeTasksInParallel runs all tasks", async () => {
    const pool = new StatelessWorkerPool()

    pool.registerHandler("multiply", async (task) => {
      const n = task.inputs.n as number
      await new Promise((r) => setTimeout(r, 10))
      return {
        taskId: task.taskId,
        nodeId: task.nodeId,
        success: true,
        output: n * 2,
        durationMs: 0,
        tokenCost: 0,
      }
    })

    const results = await pool.executeTasksInParallel([
      makeTask({ taskId: "t1", nodeId: "n1", capabilityId: "multiply", inputs: { n: 1 } }),
      makeTask({ taskId: "t2", nodeId: "n2", capabilityId: "multiply", inputs: { n: 2 } }),
      makeTask({ taskId: "t3", nodeId: "n3", capabilityId: "multiply", inputs: { n: 3 } }),
    ])

    expect(results.length).toBe(3)
    expect(results.every((r) => r.success)).toBe(true)
    expect(results[0]!.output).toBe(2)
    expect(results[1]!.output).toBe(4)
    expect(results[2]!.output).toBe(6)

    await pool.shutdown()
  })

  test("executeTasksInParallel respects concurrency limit", async () => {
    const pool = new StatelessWorkerPool()
    let maxConcurrent = 0
    let current = 0

    pool.registerHandler("concurrent", async (task) => {
      current++
      if (current > maxConcurrent) maxConcurrent = current
      await new Promise((r) => setTimeout(r, 50))
      current--
      return {
        taskId: task.taskId,
        nodeId: task.nodeId,
        success: true,
        output: { ok: true },
        durationMs: 0,
        tokenCost: 0,
      }
    })

    await pool.executeTasksInParallel(
      Array.from({ length: 10 }, (_, i) =>
        makeTask({ taskId: `t${i}`, nodeId: `n${i}`, capabilityId: "concurrent" }),
      ),
      { concurrency: 3 },
    )

    expect(maxConcurrent).toBeLessThanOrEqual(3)

    await pool.shutdown()
  })

  test("executeTasksInParallel stopOnFailure prevents further execution", async () => {
    const pool = new StatelessWorkerPool()
    let counter = 0

    pool.registerHandler("failOn2", async (task) => {
      const n = task.inputs.n as number
      if (n === 2) throw new Error("intentional failure")
      counter++
      return {
        taskId: task.taskId,
        nodeId: task.nodeId,
        success: true,
        output: { n },
        durationMs: 0,
        tokenCost: 0,
      }
    })

    const results = await pool.executeTasksInParallel(
      [
        makeTask({ taskId: "t1", nodeId: "n1", capabilityId: "failOn2", inputs: { n: 1 } }),
        makeTask({ taskId: "t2", nodeId: "n2", capabilityId: "failOn2", inputs: { n: 2 } }),
        makeTask({ taskId: "t3", nodeId: "n3", capabilityId: "failOn2", inputs: { n: 3 } }),
      ],
      { concurrency: 1, stopOnFailure: true },
    )

    expect(results.length).toBe(3)
    const failures = results.filter((r) => !r.success)
    expect(failures.length).toBeGreaterThanOrEqual(1)

    await pool.shutdown()
  })

  // ── Sequential Execution ───────────────────────────────────────────────

  test("executeTasksSequential runs in order and stops on failure", async () => {
    const pool = new StatelessWorkerPool()
    const executed: number[] = []

    pool.registerHandler("seq", async (task) => {
      const n = task.inputs.n as number
      if (n === 2) throw new Error("fail at 2")
      executed.push(n)
      return {
        taskId: task.taskId,
        nodeId: task.nodeId,
        success: true,
        output: { n },
        durationMs: 0,
        tokenCost: 0,
      }
    })

    const results = await pool.executeTasksSequential([
      makeTask({ taskId: "t1", nodeId: "n1", capabilityId: "seq", inputs: { n: 1 } }),
      makeTask({ taskId: "t2", nodeId: "n2", capabilityId: "seq", inputs: { n: 2 } }),
      makeTask({ taskId: "t3", nodeId: "n3", capabilityId: "seq", inputs: { n: 3 } }),
    ])

    expect(executed).toEqual([1])
    expect(results.length).toBe(2)
    expect(results[0]!.success).toBe(true)
    expect(results[1]!.success).toBe(false)

    await pool.shutdown()
  })

  // ── Metrics ────────────────────────────────────────────────────────────

  test("getMetrics returns correct values", async () => {
    const pool = new StatelessWorkerPool()

    pool.registerHandler("metricTest", async (task) => {
      await new Promise((r) => setTimeout(r, 10))
      const shouldFail = task.inputs.fail as boolean
      if (shouldFail) throw new Error("fail")
      return {
        taskId: task.taskId,
        nodeId: task.nodeId,
        success: true,
        output: { ok: true },
        durationMs: 0,
        tokenCost: 0,
      }
    })

    await pool.executeTask(makeTask({ taskId: "t1", capabilityId: "metricTest", inputs: { fail: false } }))
    await pool.executeTask(makeTask({ taskId: "t2", capabilityId: "metricTest", inputs: { fail: false } }))
    await pool.executeTask(makeTask({ taskId: "t3", capabilityId: "metricTest", inputs: { fail: true } }))

    const metrics = pool.getMetrics()
    expect(metrics.totalTasks).toBe(3)
    expect(metrics.completedTasks).toBe(2)
    expect(metrics.failedTasks).toBe(1)
    expect(metrics.avgDurationMs).toBeGreaterThan(0)

    await pool.shutdown()
  })

  test("reset clears all counters", async () => {
    const pool = new StatelessWorkerPool()

    pool.registerHandler("resetTest", async (task) => ({
      taskId: task.taskId,
      nodeId: task.nodeId,
      success: true,
      output: { ok: true },
      durationMs: 0,
      tokenCost: 0,
    }))

    await pool.executeTask(makeTask({ taskId: "t1", capabilityId: "resetTest" }))
    expect(pool.getMetrics().totalTasks).toBe(1)

    pool.reset()
    const metrics = pool.getMetrics()
    expect(metrics.totalTasks).toBe(0)
    expect(metrics.completedTasks).toBe(0)
    expect(metrics.failedTasks).toBe(0)
    expect(metrics.timedOutTasks).toBe(0)

    await pool.shutdown()
  })

  test("peakConcurrency tracks correctly during parallel execution", async () => {
    const pool = new StatelessWorkerPool()

    pool.registerHandler("concurrentMetric", async (task) => {
      await new Promise((r) => setTimeout(r, 100))
      return {
        taskId: task.taskId,
        nodeId: task.nodeId,
        success: true,
        output: { ok: true },
        durationMs: 0,
        tokenCost: 0,
      }
    })

    await pool.executeTasksInParallel(
      Array.from({ length: 6 }, (_, i) =>
        makeTask({ taskId: `t${i}`, nodeId: `n${i}`, capabilityId: "concurrentMetric" }),
      ),
      { concurrency: 4 },
    )

    const metrics = pool.getMetrics()
    expect(metrics.peakConcurrency).toBeGreaterThanOrEqual(1)
    expect(metrics.currentConcurrency).toBe(0)

    await pool.shutdown()
  })

  // ── Shutdown ───────────────────────────────────────────────────────────

  test("shutdown prevents new task execution", async () => {
    const pool = new StatelessWorkerPool()

    pool.registerHandler("post", async (task) => ({
      taskId: task.taskId,
      nodeId: task.nodeId,
      success: true,
      output: { ok: true },
      durationMs: 0,
      tokenCost: 0,
    }))

    await pool.shutdown()

    const result = await pool.executeTask(makeTask({ capabilityId: "post" }))

    expect(result.success).toBe(false)
    expect(result.error).toBe("Worker pool is shutting down")
  })

  test("shutdown with grace period allows running tasks to complete", async () => {
    const pool = new StatelessWorkerPool()

    pool.registerHandler("graceful", async (task) => {
      await new Promise((r) => setTimeout(r, 50))
      return {
        taskId: task.taskId,
        nodeId: task.nodeId,
        success: true,
        output: { done: true },
        durationMs: 0,
        tokenCost: 0,
      }
    })

    const taskPromise = pool.executeTask(makeTask({ capabilityId: "graceful" }))

    await new Promise((r) => setTimeout(r, 5))

    const shutdownPromise = pool.shutdown(5000)
    const result = await taskPromise
    expect(result.success).toBe(true)
    expect(result.output).toEqual({ done: true })

    await shutdownPromise
  })

  test("shutdown force-aborts running tasks when grace expires", async () => {
    const pool = new StatelessWorkerPool()

    pool.registerHandler("forever", async (task) => {
      return new Promise((resolve) => {
        task.signal?.addEventListener("abort", () =>
          resolve({
            taskId: task.taskId,
            nodeId: task.nodeId,
            success: false,
            error: "force-aborted",
            durationMs: 0,
            tokenCost: 0,
          }),
        )
      })
    })

    const taskPromise = pool.executeTask(makeTask({ capabilityId: "forever" }))

    await new Promise((r) => setTimeout(r, 5))

    await pool.shutdown(100)

    const result = await taskPromise
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  // ── Context Snapshot ───────────────────────────────────────────────────

  test("handler receives contextSnapshot from task", async () => {
    const pool = new StatelessWorkerPool()
    let receivedSnapshot: L1Snapshot | undefined

    pool.registerHandler("check-context", async (task) => {
      receivedSnapshot = task.contextSnapshot
      return {
        taskId: task.taskId,
        nodeId: task.nodeId,
        success: true,
        output: null,
        durationMs: 0,
        tokenCost: 0,
      }
    })

    const snapshot = makeSnapshot({ sessionId: "my-session", cycleIndex: 7 })
    await pool.executeTask(makeTask({ capabilityId: "check-context" }), undefined)
    // Override after construction isn't ideal; instead pass via task
    const task = makeTask({ capabilityId: "check-context" })
    task.contextSnapshot = snapshot
    await pool.executeTask(task)

    expect(receivedSnapshot).toBeDefined()
    expect(receivedSnapshot!.sessionId).toBe("my-session")
    expect(receivedSnapshot!.cycleIndex).toBe(7)

    await pool.shutdown()
  })
})
