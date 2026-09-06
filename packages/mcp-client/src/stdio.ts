import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import type { McpCallResult, McpClient, McpServerConfig, McpTool } from "./types.js"

const DEFAULT_TIMEOUT_MS = 30_000
// A single line larger than this means a broken or hostile server; dropping
// the head of the buffer beats letting memory grow without bound.
const MAX_BUFFER_CHARS = 10 * 1024 * 1024

interface JsonRpcResponse {
  jsonrpc: "2.0"
  id: number
  result?: unknown
  error?: { code: number; message: string }
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout> | null
}

const noop = (): void => {}

/**
 * Model Context Protocol client speaking JSON-RPC 2.0 over the server's
 * stdio. The server is spawned as a child process; stdout is framed into
 * newline-delimited messages, stderr is drained so a chatty server cannot
 * deadlock itself, and pending requests are rejected when the process exits
 * or the client is closed.
 */
export class McpStdioClient implements McpClient {
  private readonly config: McpServerConfig
  private proc: ChildProcessWithoutNullStreams | null = null
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private tools: McpTool[] = []
  private buffer = ""
  private closed = false

  constructor(config: McpServerConfig) {
    this.config = config
  }

  async connect(): Promise<void> {
    try {
      const proc = spawn(this.config.command, this.config.args, {
        stdio: ["pipe", "pipe", "pipe"],
        ...(this.config.env === undefined ? {} : { env: this.config.env }),
      })
      this.proc = proc
      proc.stdin.on("error", noop)
      void this.consume(proc.stdout)
      void this.consume(proc.stderr)
      proc.once("exit", () => {
        this.rejectPending("mcp server closed connection")
      })
      await this.request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "mcp-client", version: "0.1.0" },
      })
      this.notify("notifications/initialized")
      const result = (await this.request("tools/list", {})) as { tools?: McpTool[] }
      this.tools = result.tools ?? []
    } catch (e) {
      this.close()
      throw e
    }
  }

  getTools(): McpTool[] {
    return this.tools
  }

  async callTool(name: string, args: unknown): Promise<McpCallResult> {
    const result = (await this.request("tools/call", { name, arguments: args })) as {
      content?: Array<{ type: string; text?: string }>
      isError?: boolean
    }
    const text = (result.content ?? [])
      .map((block) => block.text ?? JSON.stringify(block))
      .filter(Boolean)
      .join("\n")
    return { content: text, isError: result.isError === true }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    try {
      this.proc?.stdin.end()
    } catch {
      // stdin already gone
    }
    this.proc?.kill()
    this.proc = null
    this.rejectPending("mcp client closed")
  }

  private async request(method: string, params: unknown): Promise<unknown> {
    if (this.closed) {
      throw new Error("mcp client closed")
    }
    const id = this.nextId
    this.nextId += 1
    return await new Promise<unknown>((resolve, reject) => {
      const entry: Pending = { resolve, reject, timer: null }
      this.pending.set(id, entry)
      const timeoutMs = this.config.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS
      if (timeoutMs > 0) {
        entry.timer = setTimeout(() => {
          if (this.pending.delete(id)) {
            reject(new Error(`mcp request timed out after ${timeoutMs}ms: ${method}`))
          }
        }, timeoutMs)
      }
      try {
        this.send({ jsonrpc: "2.0", id, method, params })
      } catch (e) {
        this.pending.delete(id)
        if (entry.timer !== null) clearTimeout(entry.timer)
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
  }

  private notify(method: string): void {
    this.send({ jsonrpc: "2.0", method })
  }

  private send(msg: { jsonrpc: "2.0"; method: string; id?: number; params?: unknown }): void {
    this.proc!.stdin.write(`${JSON.stringify(msg)}\n`)
  }

  private drain(): void {
    while (true) {
      const idx = this.buffer.indexOf("\n")
      if (idx === -1) break
      const line = this.buffer.slice(0, idx).trim()
      this.buffer = this.buffer.slice(idx + 1)
      if (line) this.handleLine(line)
    }
  }

  private handleLine(line: string): void {
    let msg: JsonRpcResponse
    try {
      msg = JSON.parse(line) as JsonRpcResponse
    } catch {
      return // not valid JSON; ignore
    }
    if (msg.id === undefined) return
    const entry = this.pending.get(msg.id)
    if (!entry) return
    this.pending.delete(msg.id)
    if (entry.timer !== null) clearTimeout(entry.timer)
    if (msg.error !== undefined) {
      entry.reject(new Error(msg.error.message ?? "unknown mcp error"))
    } else {
      entry.resolve(msg.result)
    }
  }

  private rejectPending(reason: string): void {
    for (const [, entry] of this.pending) {
      if (entry.timer !== null) clearTimeout(entry.timer)
      entry.reject(new Error(reason))
    }
    this.pending.clear()
  }

  private async consume(stream: AsyncIterable<Buffer>): Promise<void> {
    const decoder = new TextDecoder()
    try {
      for await (const chunk of stream) {
        this.buffer += decoder.decode(chunk, { stream: true })
        if (this.buffer.length > MAX_BUFFER_CHARS) {
          this.buffer = this.buffer.slice(this.buffer.length - MAX_BUFFER_CHARS)
        }
        this.drain()
      }
      this.buffer += decoder.decode()
      this.drain()
    } catch {
      // stream interrupted by close()
    } finally {
      this.rejectPending("mcp server closed connection")
    }
  }
}
