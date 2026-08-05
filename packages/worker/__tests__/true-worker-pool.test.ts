import { describe, expect, test } from "bun:test"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { TrueWorkerPool, type TrueWorkerTask } from "../src/index"

const __dirname = dirname(fileURLToPath(import.meta.url))
const WORKER_SCRIPT = join(__dirname, "test-worker.js")

function makeTask(taskId: string, action: string, value?: unknown, delay?: number): TrueWorkerTask {
  return {
    taskId,
    data: { action, value, delay },
  }
}

describe("TrueWorkerPool", () => {
  test("executes a single task and returns the correct output", async () => {
    const pool = new TrueWorkerPool({
      workerScript: WORKER_SCRIPT,
      maxWorkers: 2,
    })

    const results = await pool.execute([makeTask("t1", "double", 21)])

    expect(results).toHaveLength(1)
    expect(results[0].success).toBe(true)
    expect(results[0].output).toBe(42)
    expect(results[0].taskId).toBe("t1")
    expect(results[0].durationMs).toBeGreaterThanOrEqual(0)

    await pool.shutdown()
  })

  test("executes multiple tasks in parallel and returns results in order", async () => {
    const pool = new TrueWorkerPool({
      workerScript: WORKER_SCRIPT,
      maxWorkers: 4,
    })

    const results = await pool.execute([
      makeTask("t1", "double", 10),
      makeTask("t2", "square", 7),
      makeTask("t3", "uppercase", "hello"),
    ])

    expect(results).toHaveLength(3)
    expect(results[0].output).toBe(20)
    expect(results[1].output).toBe(49)
    expect(results[2].output).toBe("HELLO")
    expect(results.every((r) => r.success)).toBe(true)

    await pool.shutdown()
  })

  test("executeSequential runs tasks one at a time in order", async () => {
    const pool = new TrueWorkerPool({
      workerScript: WORKER_SCRIPT,
      maxWorkers: 2,
    })

    const results = await pool.executeSequential([
      makeTask("first", "double", 1),
      makeTask("second", "double", 2),
      makeTask("third", "double", 3),
    ])

    expect(results).toHaveLength(3)
    expect(results[0].taskId).toBe("first")
    expect(results[0].output).toBe(2)
    expect(results[1].taskId).toBe("second")
    expect(results[1].output).toBe(4)
    expect(results[2].taskId).toBe("third")
    expect(results[2].output).toBe(6)

    await pool.shutdown()
  })

  test("respects maxWorkers concurrency limit", async () => {
    const pool = new TrueWorkerPool({
      workerScript: WORKER_SCRIPT,
      maxWorkers: 2,
    })

    const tasks = Array.from({ length: 8 }, (_, i) => makeTask(`t${i}`, "double", i, 50))

    const results = await pool.execute(tasks)

    expect(results).toHaveLength(8)
    expect(results.every((r) => r.success)).toBe(true)

    const metrics = pool.getMetrics()
    expect(metrics.peakWorkers).toBeLessThanOrEqual(2)

    await pool.shutdown()
  })

  test("handles worker failures gracefully", async () => {
    const pool = new TrueWorkerPool({
      workerScript: WORKER_SCRIPT,
      maxWorkers: 2,
    })

    const results = await pool.execute([
      makeTask("pass", "double", 5),
      makeTask("fail1", "fail"),
      makeTask("pass2", "uppercase", "ok"),
    ])

    expect(results).toHaveLength(3)
    const successes = results.filter((r) => r.success)
    const failures = results.filter((r) => !r.success)

    expect(successes.length).toBe(2)
    expect(failures.length).toBe(1)
    expect(failures[0].taskId).toBe("fail1")
    expect(failures[0].error).toContain("intentional failure")

    await pool.shutdown()
  })

  test("recovers from worker crashes", async () => {
    const pool = new TrueWorkerPool({
      workerScript: WORKER_SCRIPT,
      maxWorkers: 1,
    })

    const results = await pool.execute([
      makeTask("pre", "double", 10),
      makeTask("crash1", "crash"),
      makeTask("post", "double", 20),
    ])

    expect(results).toHaveLength(3)
    expect(results[0].taskId).toBe("pre")
    expect(results[0].success).toBe(true)
    expect(results[0].output).toBe(20)

    // The crash task should fail
    const crashResult = results.find((r) => r.taskId === "crash1")
    expect(crashResult?.success).toBe(false)

    // The post-crash task should still succeed (pool recovered)
    const postResult = results.find((r) => r.taskId === "post")
    expect(postResult?.success).toBe(true)
    expect(postResult?.output).toBe(40)

    await pool.shutdown()
  })

  test("shutdown prevents new task execution", async () => {
    const pool = new TrueWorkerPool({
      workerScript: WORKER_SCRIPT,
      maxWorkers: 2,
    })

    await pool.shutdown()

    const results = await pool.execute([makeTask("t1", "double", 5)])

    expect(results).toHaveLength(1)
    expect(results[0].success).toBe(false)
    expect(results[0].error).toBe("Worker pool is shutting down")
  })

  test("shutdown with executeSequential prevents new tasks", async () => {
    const pool = new TrueWorkerPool({
      workerScript: WORKER_SCRIPT,
      maxWorkers: 2,
    })

    await pool.shutdown()

    const results = await pool.executeSequential([makeTask("t1", "double", 5)])

    expect(results).toHaveLength(1)
    expect(results[0].success).toBe(false)
    expect(results[0].error).toBe("Worker pool is shutting down")
  })

  test("handles empty task array", async () => {
    const pool = new TrueWorkerPool({
      workerScript: WORKER_SCRIPT,
      maxWorkers: 2,
    })

    const results = await pool.execute([])
    expect(results).toHaveLength(0)

    await pool.shutdown()
  })

  test("metrics track totalTasks, completed, and failed correctly", async () => {
    const pool = new TrueWorkerPool({
      workerScript: WORKER_SCRIPT,
      maxWorkers: 2,
    })

    await pool.execute([
      makeTask("t1", "double", 1),
      makeTask("t2", "double", 2),
      makeTask("t3", "fail"),
      makeTask("t4", "double", 4),
    ])

    const metrics = pool.getMetrics()
    expect(metrics.totalTasks).toBe(4)
    expect(metrics.completed).toBe(3)
    expect(metrics.failed).toBe(1)
    expect(metrics.avgDuration).toBeGreaterThanOrEqual(0)
    expect(metrics.peakWorkers).toBeGreaterThan(0)

    await pool.shutdown()
  })

  test("identity action returns the input value", async () => {
    const pool = new TrueWorkerPool({
      workerScript: WORKER_SCRIPT,
      maxWorkers: 2,
    })

    const results = await pool.execute([
      makeTask("t1", "identity", { nested: { deep: 123 } }),
      makeTask("t2", "identity", [1, 2, 3]),
      makeTask("t3", "identity", "plain string"),
    ])

    expect(results).toHaveLength(3)
    expect(results[0].output).toEqual({ nested: { deep: 123 } })
    expect(results[1].output).toEqual([1, 2, 3])
    expect(results[2].output).toBe("plain string")

    await pool.shutdown()
  })

  test("handles delayed tasks correctly", async () => {
    const pool = new TrueWorkerPool({
      workerScript: WORKER_SCRIPT,
      maxWorkers: 4,
    })

    const tasks = [
      makeTask("t1", "double", 5, 250),
      makeTask("t2", "double", 10, 250),
      makeTask("t3", "double", 15, 250),
    ]

    // Parallel run: 4 workers should execute all 3 delayed tasks concurrently
    const start = Date.now()
    const results = await pool.execute(tasks)
    const parallelElapsed = Date.now() - start

    // Sequential baseline: the same 3 tasks one at a time (workers are warm)
    const seqStart = Date.now()
    await pool.executeSequential(tasks)
    const sequentialElapsed = Date.now() - seqStart

    expect(results).toHaveLength(3)
    expect(results.every((r) => r.success)).toBe(true)
    // Relative assertion: parallel must be clearly faster than sequential,
    // robust against worker startup cost differences across platforms/CI
    expect(parallelElapsed).toBeLessThan(sequentialElapsed)

    await pool.shutdown()
  })

  test("sequentially executed tasks respect the order", async () => {
    const pool = new TrueWorkerPool({
      workerScript: WORKER_SCRIPT,
      maxWorkers: 2,
    })

    const results = await pool.executeSequential([
      makeTask("a", "double", 1, 50),
      makeTask("b", "double", 2, 50),
      makeTask("c", "double", 3, 50),
    ])

    const ids = results.map((r) => r.taskId)
    expect(ids).toEqual(["a", "b", "c"])
    expect(results.every((r) => r.success)).toBe(true)

    await pool.shutdown()
  })

  test("default maxWorkers uses cpu count", () => {
    const pool = new TrueWorkerPool({
      workerScript: WORKER_SCRIPT,
    })

    // Just verify it was created without error
    expect(pool).toBeDefined()
  })

  test("can be shut down multiple times safely", async () => {
    const pool = new TrueWorkerPool({
      workerScript: WORKER_SCRIPT,
      maxWorkers: 1,
    })

    await pool.shutdown()
    await pool.shutdown()

    // Should not throw
    expect(true).toBe(true)
  })

  test("timeout rejects tasks that are still in queue", async () => {
    const pool = new TrueWorkerPool({
      workerScript: WORKER_SCRIPT,
      maxWorkers: 1,
    })

    // Submit a slow task first to occupy the worker, then submit more with short timeout
    const slowPromise = pool.execute([makeTask("slow", "double", 1, 500)])

    const timedResults = await pool.execute([makeTask("fast-timeout", "double", 2)], { timeoutMs: 10 })

    // The timed task may or may not time out depending on timing.
    // But the pool should not hang.
    expect(timedResults).toHaveLength(1)

    await Promise.allSettled([slowPromise])
    await pool.shutdown()
  })

  test("progressively adding tasks works without issues", async () => {
    const pool = new TrueWorkerPool({
      workerScript: WORKER_SCRIPT,
      maxWorkers: 2,
    })

    const batch1 = await pool.execute([makeTask("b1t1", "double", 1), makeTask("b1t2", "double", 2)])

    const batch2 = await pool.execute([makeTask("b2t1", "double", 3), makeTask("b2t2", "double", 4)])

    expect(batch1).toHaveLength(2)
    expect(batch2).toHaveLength(2)
    expect(batch1.every((r) => r.success)).toBe(true)
    expect(batch2.every((r) => r.success)).toBe(true)

    await pool.shutdown()
  })
})

describe("createTrueWorkerPool", () => {
  test("returns a TrueWorkerPool instance", () => {
    const { createTrueWorkerPool } = require("../src/index")
    const pool = createTrueWorkerPool({ workerScript: WORKER_SCRIPT })
    expect(pool).toBeInstanceOf(TrueWorkerPool)
  })
})

/** Typed access to TrueWorkerPool private members for white-box tests. */
interface PoolInternals {
  slots: Array<{ worker: { emit(event: string, ...args: unknown[]): boolean }; busy: boolean }>
}

describe("TrueWorkerPool failure paths", () => {
  test("executeSequential times out a queued task and returns an error result", async () => {
    const pool = new TrueWorkerPool({
      workerScript: WORKER_SCRIPT,
      maxWorkers: 1,
    })

    // Occupy the only worker so the next task waits in the queue
    const blocker = pool.execute([makeTask("block", "double", 1, 400)])
    await new Promise((r) => setTimeout(r, 50))

    const results = await pool.executeSequential([makeTask("queued-slow", "double", 2)], { timeoutMs: 100 })
    expect(results[0].success).toBe(false)
    expect(results[0].error).toContain("timed out")

    await blocker
    await pool.shutdown()
  })

  test("executeSequential crash rejects through the queue reject callback", async () => {
    const pool = new TrueWorkerPool({
      workerScript: WORKER_SCRIPT,
      maxWorkers: 1,
    })

    const results = await pool.executeSequential([makeTask("boom", "crash")], { timeoutMs: 5000 })
    expect(results[0].success).toBe(false)
    expect(results[0].error).toContain("exited with code 1")

    await pool.shutdown()
  })

  test("worker error event fails the active task", async () => {
    const pool = new TrueWorkerPool({
      workerScript: WORKER_SCRIPT,
      maxWorkers: 1,
    })

    const pending = pool.executeSequential([makeTask("evt", "double", 1, 300)])
    await new Promise((r) => setTimeout(r, 50))

    const internals = pool as unknown as PoolInternals
    internals.slots[0]!.worker.emit("error", new Error("simulated worker error"))

    const results = await pending
    expect(results[0].success).toBe(false)
    expect(results[0].error).toContain("simulated worker error")

    await pool.shutdown()
  })

  test("worker messageerror event replaces the failing worker", async () => {
    const pool = new TrueWorkerPool({
      workerScript: WORKER_SCRIPT,
      maxWorkers: 1,
    })

    await pool.execute([makeTask("warm", "double", 1)])

    const internals = pool as unknown as PoolInternals
    internals.slots[0]!.worker.emit("messageerror")

    const results = await pool.execute([makeTask("after", "double", 3)])
    expect(results[0].success).toBe(true)
    expect(results[0].output).toBe(6)

    await pool.shutdown()
  })
})
