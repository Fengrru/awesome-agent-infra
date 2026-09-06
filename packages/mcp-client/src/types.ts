export interface McpServerConfig {
  command: string
  args: string[]
  env?: Record<string, string>
  requestTimeoutMs?: number
}

export interface McpHttpConfig {
  url: string
  headers?: Record<string, string>
  requestTimeoutMs?: number
}

export interface McpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface McpCallResult {
  content: string
  isError: boolean
}

export interface McpClient {
  getTools(): McpTool[]
  callTool(name: string, args: unknown): Promise<McpCallResult>
  close(): void
}
