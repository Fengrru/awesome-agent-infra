/**
 * state-machine — typed 15-state FSM for agent sessions.
 *
 * Run: bun run state-machine.ts
 */
import { AgentState, createAgentStateMachine } from "../packages/state-machine/src/index.ts"

const sm = createAgentStateMachine()

sm.onEnter(AgentState.EXECUTING, async (from, to) => {
  console.log(`entering ${to} (from ${from})`)
})

await sm.transition(AgentState.INITIALIZING, "agent starting")
await sm.transition(AgentState.READY, "agent initialized")
await sm.transition(AgentState.PLANNING, "new user goal")
await sm.transition(AgentState.EXECUTING, "plan ready")
await sm.transition(AgentState.VERIFYING, "tools returned")
await sm.transition(AgentState.COMPLETED, "goal verified")

console.log("state:", sm.state)
console.log("snapshot:", JSON.stringify(sm.getSnapshot()).slice(0, 140))
console.log("metrics:", JSON.stringify(sm.getStateMetrics()).slice(0, 200))
