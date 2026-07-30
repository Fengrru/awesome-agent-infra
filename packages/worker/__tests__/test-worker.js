import { parentPort } from "node:worker_threads"

parentPort.on("message", (msg) => {
  const { taskId, data } = msg
  const { action, value, delay } = data || {}
  const start = Date.now()

  const finish = (overrides) => {
    parentPort.postMessage({
      taskId,
      durationMs: Date.now() - start,
      ...overrides,
    })
  }

  const run = () => {
    try {
      switch (action) {
        case "double":
          finish({ success: true, output: value * 2 })
          break
        case "square":
          finish({ success: true, output: value * value })
          break
        case "uppercase":
          finish({ success: true, output: String(value).toUpperCase() })
          break
        case "identity":
          finish({ success: true, output: value })
          break
        case "fail":
          throw new Error("intentional failure")
        case "crash":
          process.exit(1)
          break
        default:
          finish({ success: true, output: value })
      }
    } catch (err) {
      finish({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  if (delay) {
    setTimeout(run, delay)
  } else {
    run()
  }
})
