import { Worker } from "node:worker_threads"
import { cpus } from "node:os"

export interface TrueWorkerTask {
  taskId: string
  data: unknown
}

export interface TrueWorkerResult {
  taskId: string
  success: boolean
  output?: unknown
  error?: string
  durationMs: number
}

export interface TrueWorkerPoolMetrics {
  totalTasks: number
  completed: number
  failed: number
  avgDuration: number
  peakWorkers: number
}

export interface TrueWorkerPoolOptions {
  workerScript: string
  maxWorkers?: number
}

interface WorkerSlot {
  worker: Worker
  busy: boolean
}

interface QueuedTask {
  task: TrueWorkerTask
  resolve: (r: TrueWorkerResult) => void
  reject: (e: Error) => void
}

interface ActiveResolver {
  taskId: string
  resolve: (r: TrueWorkerResult) => void
  reject: (e: Error) => void
}

export class TrueWorkerPool {
  private script: string
  private maxWorkers: number
  private slots: WorkerSlot[] = []
  private queue: QueuedTask[] = []
  private shuttingDown = false
  private activeResolvers = new Map<WorkerSlot, ActiveResolver>()

  private totalTasks = 0
  private completed = 0
  private failed = 0
  private totalDuration = 0
  private peakWorkers = 0

  constructor(options: TrueWorkerPoolOptions) {
    this.script = options.workerScript
    this.maxWorkers = options.maxWorkers ?? Math.max(1, cpus().length)
  }

  async execute(
    tasks: TrueWorkerTask[],
    options?: { timeoutMs?: number },
  ): Promise<TrueWorkerResult[]> {
    if (this.shuttingDown) {
      return tasks.map((t) => ({
        taskId: t.taskId,
        success: false,
        error: "Worker pool is shutting down",
        durationMs: 0,
      }))
    }

    if (tasks.length === 0) return []

    const results = new Array<TrueWorkerResult>(tasks.length)
    let resolved = 0

    return new Promise<TrueWorkerResult[]>((resolveAll) => {
      for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i]
        let timer: ReturnType<typeof setTimeout> | undefined

        if (options?.timeoutMs && options.timeoutMs > 0) {
          timer = setTimeout(() => {
            const qIdx = this.queue.findIndex(
              (q) => q.task.taskId === task.taskId,
            )
            if (qIdx >= 0) {
              const [removed] = this.queue.splice(qIdx, 1)
              results[i] = {
                taskId: task.taskId,
                success: false,
                error: `Task timed out after ${options.timeoutMs}ms`,
                durationMs: 0,
              }
              this.totalTasks++
              this.failed++
              resolved++
              if (resolved === tasks.length) resolveAll(results)
            }
          }, options.timeoutMs)
        }

        this.queue.push({
          task,
          resolve: (r) => {
            if (timer) clearTimeout(timer)
            if (results[i] === undefined) {
              results[i] = r
              this.totalTasks++
              if (r.success) this.completed++
              else this.failed++
              this.totalDuration += r.durationMs
              resolved++
              if (resolved === tasks.length) resolveAll(results)
            }
          },
          reject: (e) => {
            if (timer) clearTimeout(timer)
            if (results[i] === undefined) {
              results[i] = {
                taskId: task.taskId,
                success: false,
                error: e.message,
                durationMs: 0,
              }
              this.totalTasks++
              this.failed++
              resolved++
              if (resolved === tasks.length) resolveAll(results)
            }
          },
        })
      }

      this.flushQueue()
    })
  }

  async executeSequential(
    tasks: TrueWorkerTask[],
    options?: { timeoutMs?: number },
  ): Promise<TrueWorkerResult[]> {
    const results: TrueWorkerResult[] = []

    for (const task of tasks) {
      if (this.shuttingDown) {
        results.push({
          taskId: task.taskId,
          success: false,
          error: "Worker pool is shutting down",
          durationMs: 0,
        })
        continue
      }

      let timer: ReturnType<typeof setTimeout> | undefined

      const result = await new Promise<TrueWorkerResult>((resolve, reject) => {
        if (options?.timeoutMs && options.timeoutMs > 0) {
          timer = setTimeout(() => {
            const qIdx = this.queue.findIndex(
              (q) => q.task.taskId === task.taskId,
            )
            if (qIdx >= 0) {
              this.queue.splice(qIdx, 1)
            }
            reject(
              new Error(
                `Task ${task.taskId} timed out after ${options.timeoutMs}ms`,
              ),
            )
          }, options.timeoutMs)
        }

        this.queue.push({
          task,
          resolve: (r) => {
            if (timer) clearTimeout(timer)
            resolve(r)
          },
          reject: (e) => {
            if (timer) clearTimeout(timer)
            reject(e)
          },
        })

        this.flushQueue()
      }).catch((e) => ({
        taskId: task.taskId,
        success: false,
        error: e instanceof Error ? e.message : String(e),
        durationMs: 0,
      }))

      this.totalTasks++
      if (result.success) this.completed++
      else this.failed++
      this.totalDuration += result.durationMs
      results.push(result)
    }

    return results
  }

  getMetrics(): TrueWorkerPoolMetrics {
    return {
      totalTasks: this.totalTasks,
      completed: this.completed,
      failed: this.failed,
      avgDuration:
        this.totalTasks > 0
          ? Math.round(this.totalDuration / this.totalTasks)
          : 0,
      peakWorkers: this.peakWorkers,
    }
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true

    for (const queued of this.queue) {
      queued.reject(new Error("Worker pool is shutting down"))
    }
    this.queue = []

    const terminations = this.slots.map(async (slot) => {
      this.activeResolvers.delete(slot)
      try {
        await slot.worker.terminate()
      } catch {
        // worker may already be terminated
      }
    })

    await Promise.allSettled(terminations)
    this.slots = []
  }

  private ensureWorkers(): void {
    while (this.slots.length < this.maxWorkers) {
      try {
        this.slots.push(this.createSlot())
      } catch {
        break
      }
    }
  }

  private createSlot(): WorkerSlot {
    const worker = new Worker(this.script)
    const slot: WorkerSlot = { worker, busy: false }

    const failActiveTask = (error: Error) => {
      const resolver = this.activeResolvers.get(slot)
      if (resolver) {
        this.activeResolvers.delete(slot)
        slot.busy = false
        resolver.reject(error)
      }
      this.replaceSlot(slot)
      this.flushQueue()
    }

    worker.on("message", (msg: unknown) => {
      this.finishSlotTask(slot, msg as TrueWorkerResult)
    })

    worker.on("error", (err: Error) => {
      failActiveTask(err)
    })

    worker.on("exit", (code: number) => {
      if (code !== 0 && !this.shuttingDown) {
        failActiveTask(new Error(`Worker exited with code ${code}`))
      }
    })

    worker.on("messageerror", () => {
      failActiveTask(new Error("Worker message deserialization error"))
    })

    return slot
  }

  private finishSlotTask(
    slot: WorkerSlot,
    result: TrueWorkerResult,
  ): void {
    const resolver = this.activeResolvers.get(slot)
    if (!resolver) return
    if (resolver.taskId !== result.taskId) return

    this.activeResolvers.delete(slot)
    slot.busy = false

    resolver.resolve(result)
    this.flushQueue()
  }

  private replaceSlot(slot: WorkerSlot): void {
    const idx = this.slots.indexOf(slot)
    if (idx < 0) return
    this.activeResolvers.delete(slot)
    try {
      slot.worker.terminate()
    } catch {
      // ignore
    }
    try {
      this.slots[idx] = this.createSlot()
    } catch {
      this.slots.splice(idx, 1)
    }
  }

  private flushQueue(): void {
    this.ensureWorkers()

    while (this.queue.length > 0) {
      const freeSlot = this.slots.find((s) => !s.busy)
      if (!freeSlot) break

      const queued = this.queue.shift()!
      this.assignTask(freeSlot, queued)
    }
  }

  private assignTask(slot: WorkerSlot, queued: QueuedTask): void {
    slot.busy = true
    this.activeResolvers.set(slot, {
      taskId: queued.task.taskId,
      resolve: queued.resolve,
      reject: queued.reject,
    })

    const busyCount = this.slots.filter((s) => s.busy).length
    if (busyCount > this.peakWorkers) {
      this.peakWorkers = busyCount
    }

    slot.worker.postMessage({
      taskId: queued.task.taskId,
      data: queued.task.data,
    })
  }
}
