# @fengrru/mcp-client

> Zero-dependency [Model Context Protocol](https://modelcontextprotocol.io) clients with a uniform
> tool interface. Speaks JSON-RPC 2.0 over **stdio** (spawned child process) or **streamable HTTP**
> (plain JSON or SSE), discovers tools on connect, and enforces per-request timeouts.
>
> Extracted from the `seed` self-hosted-agent project as its first reusable building block.

## Features

- `McpStdioClient` â€?spawns a server process, frames stdout into newline-delimited messages,
  drains stderr so a chatty server cannot deadlock, rejects pending requests on process exit.
- `McpHttpClient` â€?POSTs JSON-RPC to a single endpoint, captures `mcp-session-id`, sends
  `DELETE` on close (best-effort), parses held-open SSE streams incrementally and stops as soon
  as the matching id arrives.
- Request timeouts via `AbortController` on every call.
- Buffer trimming protects against a broken or hostile server that emits one gigantic line.

## Install

```bash
bun add @fengrru/mcp-client
```

Works on Bun and Node (only `node:` built-ins + global `fetch`).

## Usage

### stdio server

```ts
import { McpStdioClient } from "@fengrru/mcp-client"

const client = new McpStdioClient({
  command: "bun",
  args: ["/path/to/my-mcp-server.ts"],
  requestTimeoutMs: 15_000,
})

await client.connect()
const tools = client.getTools() // [{ name, description, inputSchema }, ...]
const result = await client.callTool("my_tool", { text: "hi" })
// result = { content: "...", isError: false }
client.close()
```

### streamable HTTP server

```ts
import { McpHttpClient } from "@fengrru/mcp-client"

const client = new McpHttpClient({
  url: "https://example.com/mcp",
  headers: { authorization: "Bearer ..." },
})
await client.connect()
const result = await client.callTool("my_tool", { q: "hello" })
client.close() // best-effort DELETE of the server session
```

## API

- `McpStdioClient(config: McpServerConfig)`
- `McpHttpClient(config: McpHttpConfig)`
- Both implement `McpClient`:
  - `connect(): Promise<void>` â€?initialize + notifications/initialized + tools/list
  - `getTools(): McpTool[]`
  - `callTool(name, args): Promise<McpCallResult>`
  - `close(): void`

See [typedoc](https://fengrru.github.io/awesome-agent-infra/modules/mcp_client.html) for the
full reference.

## Stability

**experimental** â€?API may change as the MCP protocol and this package evolve together.
