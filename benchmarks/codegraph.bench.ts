import { fileURLToPath } from "node:url"
import { createCodeGraphBuilder } from "../packages/codegraph/src/index.ts"
/**
 * codegraph — repo graph build + symbol search throughput.
 *
 * Builds the graph over a real package source directory
 * (packages/fuzzy-patch, ~500 lines of TS).
 *
 * Run: bun bench codegraph.bench.ts
 */
import { bench, run } from "./bench-utils.ts"

const ROOT = fileURLToPath(new URL("../packages/fuzzy-patch", import.meta.url))

const builder = createCodeGraphBuilder({
  rootDir: ROOT,
  include: ["**/*.ts"],
  exclude: ["node_modules", "dist", ".git"],
})
await builder.build()
const graph = builder.graph
console.log(`graph: ${graph.nodeCount} nodes, ${graph.edgeCount} edges, ${graph.fileCount} files`)

bench("search symbol by name", () => {
  graph.searchSymbols("fuzzyFindAndReplace")
})

bench("find nodes by predicate (all symbols)", () => {
  graph.findNodes((n) => n.type === "symbol")
})

bench("find nodes by predicate (all files)", () => {
  graph.findNodes((n) => n.type === "file")
})

await run()
