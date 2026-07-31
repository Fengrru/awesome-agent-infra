import { type WorkerTask, createStatelessWorkerPool } from "../packages/worker/src/index.ts"
/**
 * worker — stateless worker pool task scheduling throughput.
 *
 * Run: bun bench worker.bench.ts
 */
import { bench, run } from "./bench-utils.ts"

const pool = createStatelessWorkerPool(4, 5000)
pool.registerHandler("compute", async (task) => {
  const n = task.inputs.n as number
  let sum = 0
  for (let i = 0; i < n; i++) sum += i
  return {
    taskId: task.taskId,
    nodeId: task.nodeId,
    success: true,
    output: { sum },
    durationMs: 0,
    tokenCost: 10,
  }
})

const snapshot = {
  sessionId: "bench",
  cycleIndex: 0,
  checkpointId: "ckpt-bench",
  createdAt: Date.now(),
  memory: { l2Working: [], l3LongTerm: [] },
  state: {},
}

const singleTask: WorkerTask = {
  taskId: "t",
  nodeId: "n",
  capabilityId: "compute",
  inputs: { n: 1000 },
  contextSnapshot: snapshot,
}

function makeTasks(count: number): WorkerTask[] {
  return Array.from({ length: count }, (_, i) => ({
    taskId: `t${i}`,
    nodeId: `n${i}`,
    capabilityId: "compute",
    inputs: { n: 200 },
    contextSnapshot: snapshot,
  }))
}

// timeoutMs: 0 skips the per-task timer (setTimeout is heavy on Windows),
// isolating the pool's scheduling/dispatch overhead.
// Cap iterations: rare GC pauses inflate the mean, the median is the signal.
bench(
  "execute single task",
  async () => {
    await pool.executeTask(singleTask, 0)
  },
  { maxIterations: 20000 },
)

bench("execute 20 tasks in parallel (concurrency 4)", async () => {
  await pool.executeTasksInParallel(makeTasks(20), { concurrency: 4, timeoutMs: 0 })
})

bench("execute 20 tasks sequential", async () => {
  await pool.executeTasksSequential(makeTasks(20), { timeoutMs: 0 })
})

await run()
