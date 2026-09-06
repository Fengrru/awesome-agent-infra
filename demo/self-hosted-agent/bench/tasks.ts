import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import type { Task, TaskInstance } from "./types.js"

// Deterministic per-seed material. mulberry32 keeps task generation
// reproducible across machines and reruns.
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

function token(rand: () => number, length: number): string {
  let out = ""
  for (let i = 0; i < length; i++) out += ALPHABET[Math.floor(rand() * ALPHABET.length)]
  return out
}

function read(workspace: string, rel: string): string | null {
  try {
    return readFileSync(join(workspace, rel), "utf8")
  } catch {
    return null
  }
}

function files(workspace: string): string[] {
  try {
    return readdirSync(workspace).filter((f) => existsSync(join(workspace, f)))
  } catch {
    return []
  }
}

const REMEMBER = " Remember this for all future sessions; do not write it into any file."

export const TASKS: Task[] = [
  {
    id: "facts/codeword",
    category: "facts",
    description: "Recall a random release codeword taught once, write it to a file later.",
    generate(seed) {
      const rand = rng(seed * 7919 + 1)
      const codeword = token(rand, 8)
      const instance: TaskInstance = {
        teach: `Project setup: the release codeword for this project is ${codeword}.${REMEMBER}`,
        test: "Create a file named CODEWORD.txt whose content is exactly the project release codeword.",
        vars: { codeword },
      }
      return instance
    },
    verify({ workspace, instance }) {
      const content = read(workspace, "CODEWORD.txt")
      return content !== null && content.trim() === (instance.vars.codeword ?? "")
    },
  },
  {
    id: "rules/prefix",
    category: "rules",
    description: "Follow a file-naming convention taught once when creating a new module.",
    generate(seed) {
      const rand = rng(seed * 104729 + 2)
      const prefix = `${token(rand, 3).toLowerCase()}_`
      return {
        teach: `Project convention: every Python module file in this repository must have a filename that starts with "${prefix}".${REMEMBER}`,
        test: "Create a Python module that implements a function double(x) returning twice its input.",
        vars: { prefix },
      }
    },
    verify({ workspace, instance }) {
      const prefix = instance.vars.prefix
      if (prefix === undefined) return false
      return files(workspace).some((f) => {
        if (!f.endsWith(".py") || !f.startsWith(prefix)) return false
        const content = read(workspace, f) ?? ""
        return content.includes("def double")
      })
    },
  },
  {
    id: "facts/port",
    category: "facts",
    description: "Recall a random service port taught once and put it into a config file.",
    generate(seed) {
      const rand = rng(seed * 15485863 + 3)
      const port = String(10000 + Math.floor(rand() * 50000))
      return {
        teach: `This project's dev server must always run on port ${port}.${REMEMBER}`,
        test: "Create a config.json for the project's dev server. It must include the port the server runs on.",
        vars: { port },
      }
    },
    verify({ workspace, instance }) {
      const content = read(workspace, "config.json")
      if (content === null) return false
      try {
        const parsed = JSON.parse(content) as { port?: unknown; server?: { port?: unknown } }
        const want = Number(instance.vars.port ?? 0)
        return Number(parsed.port) === want || Number(parsed.server?.port) === want
      } catch {
        return false
      }
    },
  },
  {
    id: "rules/report-header",
    category: "rules",
    description: "Apply a report header format with a random marker taught once.",
    generate(seed) {
      const rand = rng(seed * 2246822519 + 4)
      const marker = token(rand, 6)
      return {
        teach: `Project convention: every report written in this project must start with the exact first line "REPORT: ${marker}".${REMEMBER}`,
        test: "Write a short status report about the current project state into a markdown file named REPORT.md.",
        vars: { marker },
      }
    },
    verify({ workspace, instance }) {
      const content = read(workspace, "REPORT.md")
      if (content === null) return false
      return content.split(/\r?\n/)[0]?.trim() === `REPORT: ${instance.vars.marker ?? ""}`
    },
  },
  {
    id: "facts/format-preference",
    category: "facts",
    description: "Honor a TOML-over-JSON/YAML preference taught once when asked for structured data.",
    generate(_seed) {
      return {
        teach: `User preference: always save structured data as TOML, never as JSON or YAML.${REMEMBER}`,
        test: "Create a sample configuration file for this service with a database host and port.",
        vars: {},
      }
    },
    verify({ workspace }) {
      const all = files(workspace)
      const hasToml = all.some((f) => f.endsWith(".toml"))
      const hasJson = all.some((f) => f.endsWith(".json"))
      const hasYaml = all.some((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
      return hasToml && !hasJson && !hasYaml
    },
  },
  {
    id: "skills/footer",
    category: "skills",
    description: "Apply a file-footer procedure with a random token taught once.",
    generate(seed) {
      const rand = rng(seed * 32452843 + 5)
      const footerToken = token(rand, 6)
      return {
        teach: `Project procedure: every text file you generate must end with a final line "# seed:${footerToken}".${REMEMBER}`,
        test: "Create a file named hello.txt containing a friendly hello message.",
        vars: { footerToken },
      }
    },
    verify({ workspace, instance }) {
      const content = read(workspace, "hello.txt")
      if (content === null) return false
      return content.trim().endsWith(`# seed:${instance.vars.footerToken ?? ""}`)
    },
  },
  // -------------------------------------------------------------------------
  // Multi-session tasks. Their timelines exercise what single teach+test
  // cannot: knowledge supersession (version chains), contamination from
  // failed sessions, composition across memories, and repeated use.
  // -------------------------------------------------------------------------
  {
    id: "update/port",
    category: "facts",
    description: "Port taught, then officially rotated; only the current value is correct.",
    generate(seed) {
      const rand = rng(seed * 7907 + 11)
      const oldPort = String(10000 + Math.floor(rand() * 20000))
      const newPort = String(30000 + Math.floor(rand() * 20000))
      return {
        sessions: [
          { goal: `This project's dev server must always run on port ${oldPort}.${REMEMBER}`, phase: "teach" },
          {
            goal: `Update: the dev server port has changed. Port ${oldPort} is retired and must no longer be used; the dev server now runs on port ${newPort}.${REMEMBER}`,
            phase: "teach",
          },
          {
            goal: "Create a config.json for the project's dev server. It must include the port the server runs on.",
            phase: "test",
          },
        ],
        vars: { oldPort, newPort },
      }
    },
    verify({ workspace, instance }) {
      const content = read(workspace, "config.json")
      if (content === null) return false
      try {
        const parsed = JSON.parse(content) as { port?: unknown; server?: { port?: unknown } }
        const want = Number(instance.vars.newPort ?? 0)
        return Number(parsed.port) === want || Number(parsed.server?.port) === want
      } catch {
        return false
      }
    },
  },
  {
    id: "update/codeword",
    category: "facts",
    description: "Release codeword taught, then rotated; recall only the current one.",
    generate(seed) {
      const rand = rng(seed * 104729 + 13)
      const oldCodeword = token(rand, 8)
      const newCodeword = token(rand, 8)
      return {
        sessions: [
          {
            goal: `Project setup: the release codeword for this project is ${oldCodeword}.${REMEMBER}`,
            phase: "teach",
          },
          {
            goal: `Update: the release codeword has been rotated. ${oldCodeword} is retired; the release codeword is now ${newCodeword}.${REMEMBER}`,
            phase: "teach",
          },
          {
            goal: "Create a file named CODEWORD.txt whose content is exactly the current project release codeword.",
            phase: "test",
          },
        ],
        vars: { oldCodeword, newCodeword },
      }
    },
    verify({ workspace, instance }) {
      const content = read(workspace, "CODEWORD.txt")
      return content !== null && content.trim() === (instance.vars.newCodeword ?? "")
    },
  },
  {
    id: "update/naming",
    category: "rules",
    description: "Filename convention taught, then replaced by a new one; follow the new one.",
    generate(seed) {
      const rand = rng(seed * 15485867 + 17)
      const oldPrefix = `${token(rand, 3).toLowerCase()}_`
      const newPrefix = `${token(rand, 3).toLowerCase()}_`
      return {
        sessions: [
          {
            goal: `Project convention: every Python module file in this repository must have a filename that starts with "${oldPrefix}".${REMEMBER}`,
            phase: "teach",
          },
          {
            goal: `Update: the naming convention has changed. Filenames starting with "${oldPrefix}" are deprecated; every Python module file must now start with "${newPrefix}".${REMEMBER}`,
            phase: "teach",
          },
          {
            goal: "Create a Python module that implements a function double(x) returning twice its input.",
            phase: "test",
          },
        ],
        vars: { oldPrefix, newPrefix },
      }
    },
    verify({ workspace, instance }) {
      const prefix = instance.vars.newPrefix
      if (prefix === undefined) return false
      return files(workspace).some((f) => {
        if (!f.endsWith(".py") || !f.startsWith(prefix)) return false
        const content = read(workspace, f) ?? ""
        return content.includes("def double")
      })
    },
  },
  {
    id: "interference/port-override",
    category: "facts",
    description: "Correct port taught; a wrong port is planted in a session whose tool call fails.",
    generate(seed) {
      const rand = rng(seed * 21767 + 19)
      const port = String(10000 + Math.floor(rand() * 20000))
      const wrongPort = String(40000 + Math.floor(rand() * 20000))
      return {
        sessions: [
          { goal: `This project's dev server must always run on port ${port}.${REMEMBER}`, phase: "teach" },
          {
            goal: `Note: the dev server port is actually ${wrongPort}. First run the command \`bash verify-port.sh\` in the workspace to confirm the change, then report its output.`,
            phase: "teach",
          },
          {
            goal: "Create a config.json for the project's dev server. It must include the port the server runs on.",
            phase: "test",
          },
        ],
        vars: { port, wrongPort },
      }
    },
    verify({ workspace, instance }) {
      const content = read(workspace, "config.json")
      if (content === null) return false
      try {
        const parsed = JSON.parse(content) as { port?: unknown; server?: { port?: unknown } }
        const want = Number(instance.vars.port ?? 0)
        return Number(parsed.port) === want || Number(parsed.server?.port) === want
      } catch {
        return false
      }
    },
  },
  {
    id: "compose/endpoint",
    category: "facts",
    description: "Host, port and base path taught in separate sessions; compose the full endpoint.",
    generate(seed) {
      const rand = rng(seed * 27487 + 23)
      const host = `svc-${token(rand, 5).toLowerCase()}.internal`
      const port = String(10000 + Math.floor(rand() * 50000))
      const path = `/${token(rand, 4).toLowerCase()}`
      return {
        sessions: [
          { goal: `This service's host is ${host}.${REMEMBER}`, phase: "teach" },
          { goal: `This service listens on port ${port}.${REMEMBER}`, phase: "teach" },
          { goal: `This service's API base path is ${path}.${REMEMBER}`, phase: "teach" },
          {
            goal: 'Create a config.json that contains the service\'s full endpoint URL under the key "endpoint", built from the host, port and base path you know.',
            phase: "test",
          },
        ],
        vars: { host, port, path },
      }
    },
    verify({ workspace, instance }) {
      const content = read(workspace, "config.json")
      if (content === null) return false
      try {
        const parsed = JSON.parse(content) as { endpoint?: unknown }
        const { host, port, path } = instance.vars
        return typeof parsed.endpoint === "string" && parsed.endpoint.includes(`${host}:${port}${path}`)
      } catch {
        return false
      }
    },
  },
  {
    id: "compose/dual-rule",
    category: "rules",
    description: "Two independent conventions taught separately; one artifact must satisfy both.",
    generate(seed) {
      const rand = rng(seed * 35771 + 29)
      const prefix = `${token(rand, 3).toLowerCase()}_`
      const footerToken = token(rand, 6)
      return {
        sessions: [
          {
            goal: `Project convention: every text file you generate must end with a final line "# seed:${footerToken}".${REMEMBER}`,
            phase: "teach",
          },
          {
            goal: `Project convention: every generated text file's name must start with "${prefix}".${REMEMBER}`,
            phase: "teach",
          },
          { goal: "Create a text file containing a friendly hello message.", phase: "test" },
        ],
        vars: { prefix, footerToken },
      }
    },
    verify({ workspace, instance }) {
      const prefix = instance.vars.prefix
      const footerToken = instance.vars.footerToken
      return files(workspace).some((f) => {
        if (!f.startsWith(prefix ?? "")) return false
        const content = read(workspace, f) ?? ""
        return content.trim().endsWith(`# seed:${footerToken ?? ""}`)
      })
    },
  },
  {
    id: "repeat/codeword",
    category: "facts",
    description: "Codeword taught once, then demanded in three separate scored sessions.",
    generate(seed) {
      const rand = rng(seed * 42589 + 31)
      const codeword = token(rand, 8)
      return {
        sessions: [
          { goal: `Project setup: the release codeword for this project is ${codeword}.${REMEMBER}`, phase: "teach" },
          {
            goal: "Create a file named CODEWORD_A.txt whose content is exactly the project release codeword.",
            phase: "test",
          },
          {
            goal: "Create a file named CODEWORD_B.txt whose content is exactly the project release codeword.",
            phase: "test",
          },
          {
            goal: "Create a file named CODEWORD_C.txt whose content is exactly the project release codeword.",
            phase: "test",
          },
        ],
        vars: { codeword },
      }
    },
    verify({ workspace, events, instance }) {
      const want = instance.vars.codeword ?? ""
      // Each scored session asks for exactly one file, named in its goal;
      // judge that one so the per-session pass signal stays honest.
      let target: string | null = null
      for (const e of events) {
        const m = /(CODEWORD_[ABC]\.txt)/.exec(((e as { goal?: unknown }).goal as string) ?? "")
        if (m) target = m[1]!
      }
      if (target === null) return false
      const content = read(workspace, target)
      return content !== null && content.trim() === want
    },
  },
  {
    id: "distract/needle-file",
    category: "facts",
    description: "Codeword taught, then two filler sessions grow the store; recall the needle.",
    generate(seed) {
      const rand = rng(seed * 51437 + 37)
      const codeword = token(rand, 8)
      return {
        sessions: [
          { goal: `Project setup: the release codeword for this project is ${codeword}.${REMEMBER}`, phase: "teach" },
          {
            goal: "Create a NOTES.md file documenting that this team uses trunk-based development and merges to main daily.",
            phase: "teach",
          },
          {
            goal: "Create a STYLE.md file documenting that all identifiers in this project are camelCase and files use two-space indentation.",
            phase: "teach",
          },
          {
            goal: "Create a file named CODEWORD.txt whose content is exactly the project release codeword.",
            phase: "test",
          },
        ],
        vars: { codeword },
      }
    },
    verify({ workspace, instance }) {
      const content = read(workspace, "CODEWORD.txt")
      return content !== null && content.trim() === (instance.vars.codeword ?? "")
    },
  },
  {
    id: "distract/needle-rule",
    category: "rules",
    description: "Naming rule taught, then two filler sessions grow the store; apply the needle rule.",
    generate(seed) {
      const rand = rng(seed * 61091 + 41)
      const prefix = `${token(rand, 3).toLowerCase()}_`
      return {
        sessions: [
          {
            goal: `Project convention: every Python module file in this repository must have a filename that starts with "${prefix}".${REMEMBER}`,
            phase: "teach",
          },
          {
            goal: "Create a TODO.md file listing three open items: write unit tests, set up CI, and draft the changelog.",
            phase: "teach",
          },
          {
            goal: "Create an ARCHITECTURE.md file describing that this project is a CLI tool with a core module and adapters.",
            phase: "teach",
          },
          {
            goal: "Create a Python module that implements a function triple(x) returning three times its input.",
            phase: "test",
          },
        ],
        vars: { prefix },
      }
    },
    verify({ workspace, instance }) {
      const prefix = instance.vars.prefix
      if (prefix === undefined) return false
      return files(workspace).some((f) => {
        if (!f.endsWith(".py") || !f.startsWith(prefix)) return false
        const content = read(workspace, f) ?? ""
        return content.includes("def triple")
      })
    },
  },
  {
    // Offline pipeline check: a scripted fake model can satisfy this without
    // any real network. Not part of the scored E1 suite (excluded by default).
    id: "smoke/codeword",
    category: "facts",
    description: "Smoke task for the fake model: pipeline validation only.",
    generate(_seed) {
      return {
        teach:
          "Project setup: the release codeword for this project is SMOKECODE. Remember it for all future sessions.",
        test: "Create a file named CODEWORD.txt whose content is exactly the project release codeword.",
        vars: { codeword: "SMOKECODE" },
      }
    },
    verify({ workspace, instance }) {
      const content = read(workspace, "CODEWORD.txt")
      return content !== null && content.trim() === (instance.vars.codeword ?? "")
    },
  },
  {
    // Offline check of the version chain: the codeword is superseded in a
    // second teach session. Only a store that serves the latest version of a
    // key (Seed's latest()) keeps the stale value out of context; the fake
    // model refuses to write while a superseded codeword is still injected.
    id: "smoke/update",
    category: "facts",
    description: "Smoke task for the fake model: superseded knowledge must not be served.",
    generate(_seed) {
      return {
        sessions: [
          {
            goal: "Project setup: the release codeword for this project is SMOKEOLD. Remember it for all future sessions.",
            phase: "teach",
          },
          {
            goal: "Update: the release codeword has been rotated. SMOKEOLD is retired; the codeword is now SMOKEBNEW. Remember it for all future sessions.",
            phase: "teach",
          },
          {
            goal: "Create a file named CODEWORD.txt whose content is exactly the current project release codeword.",
            phase: "test",
          },
        ],
        vars: { codeword: "SMOKEBNEW" },
      }
    },
    verify({ workspace, instance }) {
      const content = read(workspace, "CODEWORD.txt")
      return content !== null && content.trim() === (instance.vars.codeword ?? "")
    },
  },
]

export function tasksByIds(ids: string[]): Task[] {
  const found = TASKS.filter((t) => ids.includes(t.id))
  const missing = ids.filter((id) => !TASKS.some((t) => t.id === id))
  if (missing.length > 0) throw new Error(`unknown task ids: ${missing.join(", ")}`)
  return found
}
