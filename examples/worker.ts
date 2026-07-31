/**
 * worker — stateless worker pool with concurrency control.
 *
 * Run: bun run worker.ts
 */
import { createStatelessWorkerPool } from "../packages/worker/src/index.ts"

const pool = createStatelessWorkerPool(2) // max 2 concurrent tasks

const snapshot = {
  sessionId: "session-1",
  cycleIndex: 0,
  checkpointId: "ckpt-1",
  createdAt: Date.now(),
  memory: { l2Working: [], l3LongTerm: [] },
  state: {},
}

pool.registerHandler("file-edit", async (task) => {
  await new Promise((r) => setTimeout(r, 30))
  return {
    taskId: task.taskId,
    nodeId: task.nodeId,
    success: true,
    output: `edited ${String(task.inputs.path)}`,
    durationMs: 0,
    tokenCost: 0,
  }
})
pool.registerHandler("file-read", async (task) => {
  return {
    taskId: task.taskId,
    nodeId: task.nodeId,
    success: true,
    output: `content of ${String(task.inputs.path)}`,
    durationMs: 0,
    tokenCost: 0,
  }
})

const results = await pool.executeTasksInParallel([
  { taskId: "t1", nodeId: "n1", capabilityId: "file-edit", inputs: { path: "a.ts" }, contextSnapshot: snapshot },
  { taskId: "t2", nodeId: "n2", capabilityId: "file-read", inputs: { path: "b.ts" }, contextSnapshot: snapshot },
  { taskId: "t3", nodeId: "n3", capabilityId: "file-edit", inputs: { path: "c.ts" }, contextSnapshot: snapshot },
])

for (const r of results) {
  console.log(`${r.taskId} -> success=${r.success} output=${String(r.output).slice(0, 30)}`)
}
console.log("metrics:", JSON.stringify(pool.getMetrics()))
await pool.shutdown()
