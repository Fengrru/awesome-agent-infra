export interface L1Snapshot {
  sessionId: string
  cycleIndex: number
  checkpointId: string
  createdAt: number
  memory: {
    l2Working: Array<{ key: string; value: unknown }>
    l3LongTerm: Array<{ key: string; value: unknown }>
  }
  state: Record<string, unknown>
}

export interface WorkerTask {
  taskId: string
  nodeId: string
  capabilityId: string
  inputs: Record<string, unknown>
  contextSnapshot: L1Snapshot
  signal?: AbortSignal
}

export interface WorkerResult {
  taskId: string
  nodeId: string
  success: boolean
  output?: unknown
  error?: string
  durationMs: number
  tokenCost: number
}

export type WorkerHandler = (task: WorkerTask) => Promise<WorkerResult>

export interface WorkerPoolMetrics {
  totalTasks: number
  completedTasks: number
  failedTasks: number
  timedOutTasks: number
  avgDurationMs: number
  peakConcurrency: number
  currentConcurrency: number
}

export interface ExecuteTaskOptions {
  timeoutMs?: number
}

export interface ExecuteParallelOptions {
  concurrency?: number
  stopOnFailure?: boolean
  timeoutMs?: number
}

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Operation timed out after ${ms}ms`)
    this.name = "TimeoutError"
  }
}

class ConcurrencySemaphore {
  private permits: number
  private waiters: Array<() => void> = []
  private cancelled = false

  constructor(maxConcurrent: number) {
    this.permits = maxConcurrent
  }

  async acquire(): Promise<boolean> {
    if (this.cancelled) return false
    if (this.permits > 0) {
      this.permits--
      return true
    }
    return new Promise<boolean>((resolve) => {
      this.waiters.push(() => {
        if (this.cancelled) {
          resolve(false)
        } else {
          this.permits--
          resolve(true)
        }
      })
    })
  }

  release(): void {
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter()
    } else {
      this.permits++
    }
  }

  cancelAll(): void {
    this.cancelled = true
    for (const waiter of this.waiters) {
      waiter()
    }
    this.waiters = []
  }
}

export {
  TrueWorkerPool,
  createTrueWorkerPool,
  type TrueWorkerTask,
  type TrueWorkerResult,
  type TrueWorkerPoolMetrics,
  type TrueWorkerPoolOptions,
} from "./pool.js"

export class StatelessWorkerPool {
  private handlers = new Map<string, WorkerHandler>()
  private maxParallel: number
  private defaultTimeoutMs: number
  private activeCount = 0
  private peakActive = 0
  private totalTasks = 0
  private completedTasks = 0
  private failedTasks = 0
  private timedOutTasks = 0
  private totalDurationMs = 0
  private shutdownFlag = false
  private activeControllers = new Set<AbortController>()

  constructor(maxParallel = 3, defaultTimeoutMs = 60000) {
    this.maxParallel = maxParallel
    this.defaultTimeoutMs = defaultTimeoutMs
  }

  registerHandler(capabilityId: string, handler: WorkerHandler): void {
    this.handlers.set(capabilityId, handler)
  }

  unregisterHandler(capabilityId: string): boolean {
    return this.handlers.delete(capabilityId)
  }

  getHandlerCount(): number {
    return this.handlers.size
  }

  async executeTask(task: WorkerTask, timeoutMs?: number): Promise<WorkerResult> {
    if (this.shutdownFlag) {
      return {
        taskId: task.taskId,
        nodeId: task.nodeId,
        success: false,
        error: "Worker pool is shutting down",
        durationMs: 0,
        tokenCost: 0,
      }
    }

    const handler = this.handlers.get(task.capabilityId)
    if (!handler) {
      return {
        taskId: task.taskId,
        nodeId: task.nodeId,
        success: false,
        error: `No handler registered for capability: ${task.capabilityId}`,
        durationMs: 0,
        tokenCost: 0,
      }
    }

    this.activeCount++
    this.peakActive = Math.max(this.peakActive, this.activeCount)
    this.totalTasks++

    const startTime = Date.now()
    const effectiveTimeout = timeoutMs ?? this.defaultTimeoutMs
    const abortController = new AbortController()
    this.activeControllers.add(abortController)
    const externalSignal = task.signal

    if (externalSignal) {
      if (externalSignal.aborted) {
        this.activeControllers.delete(abortController)
        return {
          taskId: task.taskId,
          nodeId: task.nodeId,
          success: false,
          error: "Task was aborted by external signal",
          durationMs: 0,
          tokenCost: 0,
        }
      }
      externalSignal.addEventListener("abort", () => abortController.abort(externalSignal.reason), { once: true })
    }

    task.signal = abortController.signal

    try {
      const result = await this.executeWithTimeout(handler, task, effectiveTimeout, abortController)
      const duration = Date.now() - startTime
      result.durationMs = duration

      this.totalDurationMs += duration
      if (result.success) {
        this.completedTasks++
      } else {
        this.failedTasks++
      }

      return result
    } catch (err) {
      const duration = Date.now() - startTime
      const isTimeout = err instanceof TimeoutError
      if (isTimeout) this.timedOutTasks++
      else this.failedTasks++

      return {
        taskId: task.taskId,
        nodeId: task.nodeId,
        success: false,
        error: isTimeout
          ? `Task timed out after ${effectiveTimeout}ms`
          : err instanceof Error
            ? err.message
            : String(err),
        durationMs: duration,
        tokenCost: 0,
      }
    } finally {
      this.activeCount--
      this.activeControllers.delete(abortController)
    }
  }

  private async executeWithTimeout(
    handler: WorkerHandler,
    task: WorkerTask,
    timeoutMs: number,
    controller: AbortController,
  ): Promise<WorkerResult> {
    if (timeoutMs <= 0) return handler(task)

    const timer = setTimeout(() => controller.abort(new TimeoutError(timeoutMs)), timeoutMs)

    try {
      const signal = controller.signal
      const result = await Promise.race([
        handler(task),
        new Promise<never>((_, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              reject(signal.reason ?? new TimeoutError(timeoutMs))
            },
            { once: true },
          )
        }),
      ])

      return result
    } catch (err) {
      if (err instanceof TimeoutError) throw err
      throw err
    } finally {
      clearTimeout(timer)
    }
  }

  async executeTasksInParallel(tasks: WorkerTask[], options?: ExecuteParallelOptions): Promise<WorkerResult[]> {
    const timeoutMs = options?.timeoutMs
    const results: WorkerResult[] = new Array(tasks.length)

    const semaphore = new ConcurrencySemaphore(this.maxParallel)
    const promises = tasks.map(async (task, index) => {
      const acquired = await semaphore.acquire()
      if (!acquired) return
      try {
        results[index] = await this.executeTask(task, timeoutMs)
        if (options?.stopOnFailure && !results[index].success) {
          semaphore.cancelAll()
        }
      } finally {
        semaphore.release()
      }
    })

    await Promise.allSettled(promises)
    return results.filter((r): r is WorkerResult => r !== undefined)
  }

  async executeTasksSequential(
    tasks: WorkerTask[],
    options?: { timeoutMs?: number; stopOnFailure?: boolean },
  ): Promise<WorkerResult[]> {
    const results: WorkerResult[] = []
    const stopOnFailure = options?.stopOnFailure ?? true

    for (const task of tasks) {
      const result = await this.executeTask(task, options?.timeoutMs)
      results.push(result)
      if (stopOnFailure && !result.success) break
    }
    return results
  }

  getMetrics(): WorkerPoolMetrics {
    return {
      totalTasks: this.totalTasks,
      completedTasks: this.completedTasks,
      failedTasks: this.failedTasks,
      timedOutTasks: this.timedOutTasks,
      avgDurationMs: this.completedTasks > 0 ? Math.round(this.totalDurationMs / this.completedTasks) : 0,
      peakConcurrency: this.peakActive,
      currentConcurrency: this.activeCount,
    }
  }

  reset(): void {
    this.activeCount = 0
    this.peakActive = 0
    this.totalTasks = 0
    this.completedTasks = 0
    this.failedTasks = 0
    this.timedOutTasks = 0
    this.totalDurationMs = 0
    this.shutdownFlag = false
  }

  async shutdown(gracePeriodMs = 5000): Promise<void> {
    this.shutdownFlag = true

    const start = Date.now()
    while (this.activeCount > 0 && Date.now() - start < gracePeriodMs) {
      await new Promise((r) => setTimeout(r, 100))
    }

    for (const controller of this.activeControllers) {
      controller.abort(new TimeoutError(gracePeriodMs))
    }
    this.activeControllers.clear()
  }
}

/**
 * Create a {@link StatelessWorkerPool} instance.
 *
 * @param args - Constructor arguments forwarded to {@link StatelessWorkerPool}.
 * @returns A new {@link StatelessWorkerPool}.
 */
export function createStatelessWorkerPool(
  ...args: ConstructorParameters<typeof StatelessWorkerPool>
): StatelessWorkerPool {
  return new StatelessWorkerPool(...args)
}
