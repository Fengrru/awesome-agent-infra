import { CodeRefactorScenario } from "./scenario"

async function main() {
  console.log("agent-kit Code Refactor Agent Demo")
  console.log("==================================\n")

  const scenario = new CodeRefactorScenario()

  try {
    const result = await scenario.run()

    console.log("\n==================================")
    console.log(`Result: ${result.overall.toUpperCase()}`)
    console.log(`Steps: ${result.steps.length} total, ${result.steps.filter((s) => s.status === "pass").length} passed, ${result.steps.filter((s) => s.status === "fail").length} failed`)
    console.log(`State transitions: ${result.snapshot.transitionCount}`)

    if (result.overall === "failure") {
      process.exit(1)
    }
  } catch (err) {
    console.error("Demo failed with error:", err)
    process.exit(1)
  }
}

main()
