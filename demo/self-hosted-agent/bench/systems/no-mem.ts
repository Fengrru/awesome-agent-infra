import type { Model } from "../../src/model/model.js"
import type { BenchmarkSystem, RunContext, SystemRunOutcome } from "../types.js"
import { runKernelSession } from "./base.js"

// Control arm: no memory at all. Every session starts cold; nothing is
// persisted, nothing is injected. learn() must be a no-op.
export function createNoMemSystem(model: Model): BenchmarkSystem {
  return {
    name: "no-mem",
    async reset() {},
    async run(goal: string, ctx: RunContext): Promise<SystemRunOutcome> {
      return runKernelSession({ model, goal, context: "", workspace: ctx.workspace, sessionSeq: ctx.sessionSeq })
    },
    async learn(_success: boolean) {},
    async dispose() {},
  }
}
