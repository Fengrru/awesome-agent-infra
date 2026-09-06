import { describe, expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { McpStdioClient } from "../src/index.js"

function fixture(mode: "fake" | string = "fake"): { command: string; args: string[] } {
  const file = fileURLToPath(
    new URL(`./fixtures/${mode === "fake" ? "fake-mcp-server.ts" : "tricky-mcp-server.ts"}`, import.meta.url),
  )
  return { command: process.execPath, args: mode === "fake" ? [file] : [file, mode] }
}

describe("McpStdioClient", () => {
  test("connects, discovers tools, and calls them", async () => {
    const client = new McpStdioClient(fixture())
    await client.connect()
    try {
      expect(client.getTools().map((t) => t.name)).toEqual(["echo", "add"])
      const echo = await client.callTool("echo", { text: "hi" })
      expect(echo).toEqual({ content: "echo: hi", isError: false })
      const add = await client.callTool("add", { a: 2, b: 3 })
      expect(add.content).toBe("5")
    } finally {
      client.close()
      client.close() // idempotent
    }
  })

  test("a server flooding stderr does not deadlock the client", async () => {
    const client = new McpStdioClient(fixture("noise"))
    await client.connect()
    try {
      const r = await client.callTool("echo", { text: "hi" })
      expect(r.content).toBe("ok")
    } finally {
      client.close()
    }
  })

  test("a server that crashes mid-request rejects pending calls immediately", async () => {
    const client = new McpStdioClient(fixture("crash"))
    await client.connect()
    try {
      await expect(client.callTool("echo", { text: "hi" })).rejects.toThrow("mcp server closed connection")
    } finally {
      client.close()
    }
  })

  test("requests time out after the configured window", async () => {
    const client = new McpStdioClient({ ...fixture("hang"), requestTimeoutMs: 300 })
    await client.connect()
    try {
      await expect(client.callTool("echo", { text: "hi" })).rejects.toThrow("timed out")
    } finally {
      client.close()
    }
  })

  test("close rejects in-flight requests", async () => {
    const client = new McpStdioClient(fixture("hang"))
    await client.connect()
    const pending = client.callTool("echo", { text: "hi" })
    await new Promise((r) => setTimeout(r, 100)) // let the request reach the server
    client.close()
    await expect(pending).rejects.toThrow("mcp client closed")
  })

  test("a failed connect closes the client instead of leaking the subprocess", async () => {
    const client = new McpStdioClient({ command: process.execPath, args: ["-e", "process.exit(1)"] })
    await expect(client.connect()).rejects.toThrow("mcp server closed connection")
    // close() ran during the failed connect: further calls fail closed
    // instead of talking to a zombie process.
    await expect(client.callTool("echo", { text: "hi" })).rejects.toThrow("mcp client closed")
  })

  test("a JSON-RPC error reply rejects the call with its message", async () => {
    const client = new McpStdioClient(fixture("error"))
    await client.connect()
    try {
      // Capture the rejection explicitly: bun:test's `rejects.toThrow`
      // matcher hangs on this stdio subprocess path, so assert on the error
      // message we actually receive instead.
      let message: string | undefined
      try {
        await client.callTool("echo", { text: "hi" })
      } catch (e) {
        message = (e as Error).message
      }
      expect(message).toContain("boom")
    } finally {
      client.close()
    }
  })

  test("blank, notification, and unknown-id frames are ignored safely", async () => {
    const client = new McpStdioClient(fixture("extras"))
    await client.connect()
    try {
      const r = await client.callTool("echo", { text: "hi" })
      expect(r.content).toBe("ok")
    } finally {
      client.close()
    }
  })

  test("a single oversized line is trimmed instead of exhausting memory", async () => {
    const client = new McpStdioClient(fixture("huge"))
    await client.connect()
    try {
      const r = await client.callTool("echo", { text: "hi" })
      expect(r.content).toBe("ok")
    } finally {
      client.close()
    }
  })
})
