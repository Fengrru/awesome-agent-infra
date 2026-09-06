import type { McpServerConfig } from "./connection/mcp-client.js"
import type { McpHttpConfig } from "./connection/mcp-http.js"
import type { HttpSearchConfig } from "./connection/search.js"

/**
 * Read a demo environment variable using the primary `AGENT_` prefix,
 * falling back to the legacy `SEED_` prefix for backward compatibility.
 */
export function agentEnv(name: string, env: Record<string, string | undefined> = process.env): string | undefined {
  return env[`AGENT_${name}`] ?? env[`SEED_${name}`]
}

export interface CliConfig {
  mcpServers: McpServerConfig[]
  mcpHttpServers: McpHttpConfig[]
  search?: HttpSearchConfig
  embeddingModel?: string
}

// Env-var config is best-effort: a malformed value warns and is ignored
// rather than taking the whole CLI down at startup.
function parseJsonArray<T>(name: string, value: string | undefined): T[] {
  if (value === undefined || value === "") return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) {
      console.warn(`(${name}: expected a JSON array, ignoring)`)
      return []
    }
    return parsed as T[]
  } catch {
    console.warn(`(${name}: invalid JSON, ignoring)`)
    return []
  }
}

function parseJsonObject(name: string, value: string | undefined): Record<string, string> {
  if (value === undefined || value === "") return {}
  try {
    const parsed: unknown = JSON.parse(value)
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      console.warn(`(${name}: expected a JSON object, ignoring)`)
      return {}
    }
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
  } catch {
    console.warn(`(${name}: invalid JSON, ignoring)`)
    return {}
  }
}

export function cliConfigFromEnv(env: Record<string, string | undefined>): CliConfig {
  const config: CliConfig = {
    mcpServers: parseJsonArray<McpServerConfig>("AGENT_MCP", agentEnv("MCP", env)),
    mcpHttpServers: parseJsonArray<McpHttpConfig>("AGENT_MCP_HTTP", agentEnv("MCP_HTTP", env)),
  }

  const searchUrl = agentEnv("SEARCH_URL", env)
  if (searchUrl) {
    const headers = parseJsonObject("AGENT_SEARCH_HEADERS", agentEnv("SEARCH_HEADERS", env))
    config.search = {
      url: searchUrl,
      ...(agentEnv("SEARCH_API_KEY", env) === undefined ? {} : { apiKey: agentEnv("SEARCH_API_KEY", env) }),
      ...(Object.keys(headers).length === 0 ? {} : { headers }),
    }
  }

  const embeddingModel = agentEnv("EMBEDDING_MODEL", env)
  if (embeddingModel) config.embeddingModel = embeddingModel
  return config
}
