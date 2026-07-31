import { fuzzyFindAndReplace } from "../packages/fuzzy-patch/src/index.ts"
/**
 * fuzzy-patch — 8-strategy fuzzy patching throughput on a ~6KB source file.
 *
 * Run: bun bench fuzzy-patch.bench.ts
 */
import { bench, run } from "./bench-utils.ts"

const FILE = `import { createHash } from "node:crypto"

export interface FileTransaction {
  id: string
  sessionId: string
  baselineHash: Record<string, string>
  baselineGitHead: string
  affectedFiles: string[]
  status: "active" | "validated" | "committed" | "rolled_back" | "conflict"
}

export async function commit(tx: FileTransaction): Promise<CommitResult> {
  for (const file of tx.affectedFiles) {
    const currentContent = await readFile(file)
    const currentHash = createHash("sha256").update(currentContent).digest("hex")
    if (currentHash !== tx.baselineHash[file]) {
      return { status: "CONFLICT", file, reason: "TOCTOU_RACE_DETECTED" }
    }
  }
  this.staging.clear()
  tx.status = "committed"
  return { status: "SUCCESS" }
}
`.repeat(12)

const DRIFTED_WHITESPACE = FILE.replaceAll("\n", "\n  ")
const DRIFTED_TYPO = FILE.replaceAll("createHash", "createHsh")

bench("exact match replace", () => {
  fuzzyFindAndReplace(FILE, "TOCTOU_RACE_DETECTED", "WORKSPACE_MODIFIED")
})

bench("whitespace-normalized match", () => {
  fuzzyFindAndReplace(DRIFTED_WHITESPACE, "TOCTOU_RACE_DETECTED", "WORKSPACE_MODIFIED")
})

// Levenshtein fallback is O(n·m) over a sliding window on a 60KB input —
// the worst-case strategy. Keep it in the suite as a real-world signal,
// but cap iterations to keep the suite fast.
bench(
  "levenshtein fallback (content drifted)",
  () => {
    fuzzyFindAndReplace(
      DRIFTED_TYPO,
      'const currentHash = createHash("sha256").update(currentContent).digest("hex")',
      "const currentHash = sha256(currentContent)",
    )
  },
  { minIterations: 3, maxIterations: 3 },
)

await run()
