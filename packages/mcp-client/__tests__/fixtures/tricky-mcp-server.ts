// Modes:
// - "noise"  writes a flood of stderr before serving (proves the client drains stderr)
// - "crash"  exits without replying to tools/call (proves pending requests reject on EOF)
// - "hang"   never replies to tools/call (used with a short client timeout)
// - "error"  replies to tools/call with a JSON-RPC error
// - "extras" sends blank / notification / unknown-id lines before replying
// - "huge"   sends an 11MB single line before replying (exercises buffer trimming)
const mode = process.argv[2] ?? "normal"

if (mode === "noise") {
  for (let i = 0; i < 8000; i++) {
    process.stderr.write(`noise ${i} lorem ipsum dolor sit amet consectetur adipiscing elit\n`)
  }
}

process.stdin.setEncoding("utf8")

let buffer = ""

function send(msg: unknown): void {
  process.stdout.write(`${JSON.stringify(msg)}\n`)
}

function handle(msg: { jsonrpc: string; id?: number; method?: string }): void {
  if (msg.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "tricky-mcp", version: "1.0.0" },
      },
    })
    return
  }
  if (msg.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        tools: [
          {
            name: "echo",
            description: "echo the input text",
            inputSchema: {
              type: "object",
              properties: { text: { type: "string" } },
              required: ["text"],
            },
          },
        ],
      },
    })
    return
  }
  if (msg.method === "tools/call") {
    if (mode === "crash") {
      process.exit(1)
    }
    if (mode === "hang") {
      return // never reply
    }
    if (mode === "error") {
      send({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: "boom" } })
      return
    }
    if (mode === "extras") {
      process.stdout.write("\n")
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/something" })}\n`)
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: 999_999, result: { nope: true } })}\n`)
    }
    if (mode === "huge") {
      process.stdout.write(`${"a".repeat(11 * 1024 * 1024)}\n`)
    }
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: { content: [{ type: "text", text: "ok" }] },
    })
  }
}

process.stdin.on("data", (chunk: string) => {
  buffer += chunk
  while (true) {
    const idx = buffer.indexOf("\n")
    if (idx === -1) break
    const line = buffer.slice(0, idx).trim()
    buffer = buffer.slice(idx + 1)
    if (line) {
      try {
        handle(JSON.parse(line))
      } catch {
        // ignore malformed lines
      }
    }
  }
})
