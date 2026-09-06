import { describe, expect, test } from "bun:test"
import { McpHttpClient } from "../src/index.js"

interface JsonRpc {
  jsonrpc: string
  id?: number
  method?: string
  params?: unknown
}

const encoder = new TextEncoder()

function jsonRpcServer(
  handler: (body: JsonRpc, req: Request) => Response | Promise<Response>,
  onRequest?: (req: Request) => void,
) {
  return Bun.serve({
    port: 0,
    async fetch(req) {
      onRequest?.(req)
      if (req.method === "DELETE") {
        return new Response(null, { status: 200 })
      }
      const body = (await req.json()) as JsonRpc
      return await handler(body, req)
    },
  })
}

function basicHandler(body: JsonRpc, id: number | undefined): Response {
  const reply = (result: unknown, init: ResponseInit = {}) => Response.json({ jsonrpc: "2.0", id, result }, init)
  if (body.method === "initialize") {
    return reply(
      { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "fake", version: "1" } },
      { headers: { "mcp-session-id": "sess-1" } },
    )
  }
  if (body.method === "notifications/initialized") return new Response(null, { status: 202 })
  if (body.method === "tools/list") {
    return reply({
      tools: [
        {
          name: "echo",
          description: "echo",
          inputSchema: { type: "object", properties: { text: { type: "string" } } },
        },
      ],
    })
  }
  if (body.method === "tools/call") {
    const p = body.params as { name: string; arguments?: { text?: string } }
    return reply({ content: [{ type: "text", text: `http-echo: ${p.arguments?.text ?? ""}` }] })
  }
  return reply({})
}

describe("McpHttpClient (JSON transport)", () => {
  test("connects, discovers tools, and calls them over HTTP", async () => {
    const server = jsonRpcServer(basicHandler)
    const client = new McpHttpClient({ url: `http://127.0.0.1:${server.port}/mcp` })
    try {
      await client.connect()
      expect(client.getTools().map((t) => t.name)).toEqual(["echo"])
      const r = await client.callTool("echo", { text: "hi" })
      expect(r).toEqual({ content: "http-echo: hi", isError: false })
    } finally {
      server.stop(true)
    }
  })

  test("a JSON-RPC error reply rejects with its message", async () => {
    const server = jsonRpcServer((body) => {
      if (body.method === "tools/call") {
        return Response.json({ jsonrpc: "2.0", id: body.id, error: { code: -32000, message: "boom" } })
      }
      return basicHandler(body, body.id)
    })
    const client = new McpHttpClient({ url: `http://127.0.0.1:${server.port}/mcp` })
    try {
      await client.connect()
      await expect(client.callTool("echo", {})).rejects.toThrow("boom")
    } finally {
      server.stop(true)
    }
  })

  test("a non-2xx response raises a status error", async () => {
    const server = jsonRpcServer((body) => {
      if (body.method === "tools/call") return new Response("nope", { status: 500 })
      return basicHandler(body, body.id)
    })
    const client = new McpHttpClient({ url: `http://127.0.0.1:${server.port}/mcp` })
    try {
      await client.connect()
      await expect(client.callTool("echo", {})).rejects.toThrow("mcp http error: 500")
    } finally {
      server.stop(true)
    }
  })

  test("isError results are surfaced and non-text content is ignored", async () => {
    const server = jsonRpcServer((body) => {
      if (body.method === "tools/call") {
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            content: [
              { type: "image", data: "abc" },
              { type: "text", text: "ok" },
            ],
            isError: true,
          },
        })
      }
      return basicHandler(body, body.id)
    })
    const client = new McpHttpClient({ url: `http://127.0.0.1:${server.port}/mcp` })
    try {
      await client.connect()
      const r = await client.callTool("echo", {})
      expect(r).toEqual({ content: "ok", isError: true })
    } finally {
      server.stop(true)
    }
  })

  test("an empty tools/call result raises a clear error instead of a TypeError", async () => {
    const server = jsonRpcServer((body) => {
      if (body.method === "initialize") {
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "s", version: "1" } },
        })
      }
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 })
      if (body.method === "tools/list") {
        return Response.json({ jsonrpc: "2.0", id: body.id, result: { tools: [] } })
      }
      return Response.json({ jsonrpc: "2.0", id: body.id }) // no result field at all
    })
    const client = new McpHttpClient({ url: `http://127.0.0.1:${server.port}/mcp` })
    try {
      await client.connect()
      await expect(client.callTool("echo", {})).rejects.toThrow("empty tool result")
    } finally {
      server.stop(true)
    }
  })

  test("connect to a dead server rejects instead of timing out", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response() })
    const url = `http://127.0.0.1:${server.port}/mcp`
    server.stop(true)
    const client = new McpHttpClient({ url, requestTimeoutMs: 5_000 })
    await expect(client.connect()).rejects.toThrow()
  })

  test("DELETE on close is best-effort when the server is already gone", async () => {
    const server = jsonRpcServer(basicHandler)
    const client = new McpHttpClient({ url: `http://127.0.0.1:${server.port}/mcp` })
    await client.connect()
    server.stop(true)
    client.close() // sendDelete fails silently
    await new Promise((r) => setTimeout(r, 100))
  })

  test("requests time out when the server never responds", async () => {
    const server = Bun.serve({
      port: 0,
      async fetch() {
        return await new Promise<Response>(() => {})
      },
    })
    try {
      const client = new McpHttpClient({ url: `http://127.0.0.1:${server.port}/mcp`, requestTimeoutMs: 300 })
      await expect(client.connect()).rejects.toThrow("timed out")
    } finally {
      server.stop(true)
    }
  })
})

function sseHoldingServer(noiseBeforeReal: boolean) {
  const sessionHeaders: Array<string | null> = []
  let deleteReceived = false
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      sessionHeaders.push(req.headers.get("mcp-session-id"))
      if (req.method === "DELETE") {
        deleteReceived = true
        return new Response(null, { status: 200 })
      }
      const body = (await req.json()) as JsonRpc
      if (body.method === "initialize") {
        return Response.json(
          {
            jsonrpc: "2.0",
            id: body.id,
            result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "sse", version: "1" } },
          },
          { headers: { "mcp-session-id": "sess-1" } },
        )
      }
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 })
      if (body.method === "tools/list") {
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: { tools: [{ name: "echo", description: "echo", inputSchema: { type: "object" } }] },
        })
      }
      if (body.method === "tools/call") {
        const payload = JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: { content: [{ type: "text", text: "sse-result" }] },
        })
        // Split across two data: lines at a token boundary (the spec joins
        // them with "\n"), then hold the stream open, as streamable HTTP
        // servers do after delivering the response.
        const cut = payload.indexOf(",") + 1
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            if (noiseBeforeReal) {
              controller.enqueue(encoder.encode("event: message\ndata: not-json\n\n"))
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id: body.id! + 1_000 })}\n\n`))
            }
            controller.enqueue(encoder.encode(`event: message\ndata: ${payload.slice(0, cut)}\n`))
            controller.enqueue(encoder.encode(`data: ${payload.slice(cut)}\n\n`))
          },
          cancel() {
            // client stopped reading once it found its id — expected
          },
        })
        return new Response(stream, { headers: { "content-type": "text/event-stream" } })
      }
      return Response.json({ jsonrpc: "2.0", id: body.id, result: {} })
    },
  })
  return { server, sessionHeaders, isDeleteReceived: () => deleteReceived }
}

describe("McpHttpClient (SSE transport)", () => {
  test("returns the result without waiting for the held-open stream to end", async () => {
    const { server } = sseHoldingServer(false)
    const client = new McpHttpClient({ url: `http://127.0.0.1:${server.port}/mcp` })
    try {
      await client.connect()
      const started = Date.now()
      const r = await client.callTool("echo", { text: "hi" })
      expect(r.content).toBe("sse-result")
      expect(Date.now() - started).toBeLessThan(5_000)
    } finally {
      server.stop(true)
    }
  })

  test("ignores non-JSON and mismatched-id SSE events before the real one", async () => {
    const { server } = sseHoldingServer(true)
    const client = new McpHttpClient({ url: `http://127.0.0.1:${server.port}/mcp` })
    try {
      await client.connect()
      const r = await client.callTool("echo", { text: "hi" })
      expect(r.content).toBe("sse-result")
    } finally {
      server.stop(true)
    }
  })

  test("echoes the captured session id on subsequent requests and sends DELETE on close", async () => {
    const { server, sessionHeaders, isDeleteReceived } = sseHoldingServer(false)
    const client = new McpHttpClient({ url: `http://127.0.0.1:${server.port}/mcp` })
    try {
      await client.connect()
      const r = await client.callTool("echo", { text: "hi" })
      expect(r.content).toBe("sse-result")
      expect(sessionHeaders.slice(2).some((h) => h === "sess-1")).toBe(true)
      client.close()
      await new Promise((res) => setTimeout(res, 200))
      expect(isDeleteReceived()).toBe(true)
    } finally {
      server.stop(true)
    }
  })

  test("an SSE response with a null body raises the empty-result error", async () => {
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = (await req.json()) as JsonRpc
        if (body.method === "tools/call") {
          return new Response(null, { headers: { "content-type": "text/event-stream" } })
        }
        return basicHandler(body, body.id)
      },
    })
    const client = new McpHttpClient({ url: `http://127.0.0.1:${server.port}/mcp` })
    try {
      await client.connect()
      await expect(client.callTool("echo", {})).rejects.toThrow("empty tool result")
    } finally {
      server.stop(true)
    }
  })

  test("an SSE stream that ends without the matching id resolves to an empty result", async () => {
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = (await req.json()) as JsonRpc
        if (body.method === "tools/call") {
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ jsonrpc: "2.0", id: body.id! + 1_000, result: {} })}\n\n`),
              )
              controller.close()
            },
          })
          return new Response(stream, { headers: { "content-type": "text/event-stream" } })
        }
        return basicHandler(body, body.id)
      },
    })
    const client = new McpHttpClient({ url: `http://127.0.0.1:${server.port}/mcp` })
    try {
      await client.connect()
      await expect(client.callTool("echo", {})).rejects.toThrow("empty tool result")
    } finally {
      server.stop(true)
    }
  })
})
