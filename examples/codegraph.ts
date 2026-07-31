/**
 * codegraph — in-memory code graph built from a real directory.
 *
 * Run: bun run codegraph.ts
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createCodeGraphBuilder } from "../packages/codegraph/src/index.ts"

const root = await mkdtemp(join(tmpdir(), "codegraph-ex-"))
try {
  await mkdir(join(root, "src"))
  await writeFile(
    join(root, "src", "app.ts"),
    `import { greet } from "./greet.ts"\nexport function main() {\n  console.log(greet("world"))\n}\nmain()\n`,
  )
  await writeFile(
    join(root, "src", "greet.ts"),
    `export function greet(name: string): string {\n  return "hello " + name\n}\n`,
  )

  const builder = createCodeGraphBuilder({ rootDir: root, maxFiles: 100 })
  const graph = await builder.build()
  console.log(`nodes: ${graph.nodeCount}, edges: ${graph.edgeCount}, files: ${graph.fileCount}`)

  for (const node of graph.searchSymbols("greet")) {
    console.log(`found: ${node.name} (${node.type}) at ${node.filePath}`)
  }

  const mains = graph.findNodes((n) => n.name === "main")
  console.log("main node:", mains.length > 0 ? mains[0].id : "not found")
} finally {
  await rm(root, { recursive: true, force: true })
}
