/**
 * MCP (Model Context Protocol) client
 *
 * Connects to MCP servers via stdio/sse and registers their tools
 * into asistenku's tool registry.
 *
 * Config format:
 *   "mcpServers": {
 *     "filesystem": {
 *       "command": "npx",
 *       "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
 *       "env": { ... }
 *     },
 *     "github": {
 *       "url": "https://api.mcp.dev/github/sse",
 *       "type": "sse"
 *     }
 *   }
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { McpServerConfig, ToolDefinition } from '../types'
import { z } from 'zod'
import { registerTool } from '../tools'

export interface McpServerStatus {
  name: string
  connected: boolean
  toolCount: number
  error?: string
  client?: Client
}

const clients: Map<string, Client> = new Map()
const statuses: Map<string, McpServerStatus> = new Map()

/**
 * Connect to all configured MCP servers
 */
export async function connectAllServers(
  servers: Record<string, McpServerConfig>
): Promise<McpServerStatus[]> {
  const results: McpServerStatus[] = []
  for (const [name, config] of Object.entries(servers)) {
    if (config.disabled) {
      results.push({ name, connected: false, toolCount: 0, error: 'disabled' })
      continue
    }
    try {
      const status = await connectServer(name, config)
      results.push(status)
    } catch (err: any) {
      results.push({ name, connected: false, toolCount: 0, error: err.message })
    }
  }
  return results
}

/**
 * Connect to a single MCP server
 */
export async function connectServer(
  name: string,
  config: McpServerConfig
): Promise<McpServerStatus> {
  // Disconnect existing
  if (clients.has(name)) {
    await disconnectServer(name)
  }

  const client = new Client(
    { name: `asistenku-${name}`, version: '0.1.0' },
    { capabilities: {} }
  )

  if (config.type === 'stdio' || !config.type) {
    if (!config.command) throw new Error('stdio MCP requires command')
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: { ...process.env, ...config.env } as Record<string, string>,
    })
    await client.connect(transport)
  } else if (config.type === 'sse') {
    const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js')
    if (!config.url) throw new Error('SSE MCP requires url')
    const transport = new SSEClientTransport(new URL(config.url))
    await client.connect(transport)
  } else if (config.type === 'http') {
    const { StreamableHTTPClientTransport } = await import(
      '@modelcontextprotocol/sdk/client/streamableHttp.js'
    )
    if (!config.url) throw new Error('HTTP MCP requires url')
    const transport = new StreamableHTTPClientTransport(new URL(config.url))
    await client.connect(transport)
  } else {
    throw new Error(`Unsupported MCP transport: ${config.type}`)
  }

  clients.set(name, client)

  // Register tools from this server
  const { tools } = await client.listTools()
  for (const tool of tools) {
    const prefixedName = `mcp__${name}__${tool.name}`
    registerTool({
      name: prefixedName,
      description: `[MCP:${name}] ${tool.description || tool.name}`,
      category: 'custom',
      parameters: mcpSchemaToZod(tool.inputSchema),
      execute: async (args, ctx) => {
        try {
          const result = await client.callTool({
            name: tool.name,
            arguments: args,
          })
          const contentParts = (result.content || []).map((c: any) => {
            if (c.type === 'text') return c.text
            if (c.type === 'image') return `[image ${c.mimeType}]`
            return JSON.stringify(c)
          })
          return {
            ok: !result.isError,
            content: contentParts.join('\n'),
            error: result.isError ? 'MCP tool error' : undefined,
          }
        } catch (err: any) {
          return { ok: false, content: '', error: err.message }
        }
      },
    })
  }

  const status: McpServerStatus = {
    name,
    connected: true,
    toolCount: tools.length,
    client,
  }
  statuses.set(name, status)
  return status
}

/**
 * Disconnect from a specific server
 */
export async function disconnectServer(name: string) {
  const client = clients.get(name)
  if (!client) return
  try {
    await client.close()
  } catch {
    // Already closed
  }
  clients.delete(name)
  statuses.delete(name)
}

/**
 * Disconnect all
 */
export async function disconnectAll() {
  const names = Array.from(clients.keys())
  await Promise.all(names.map(disconnectServer))
}

/**
 * List MCP server statuses
 */
export function listServerStatuses(): McpServerStatus[] {
  return Array.from(statuses.values())
}

/**
 * Convert MCP JSON Schema to Zod schema (basic support)
 */
function mcpSchemaToZod(schema: any): any {
  if (!schema || !schema.properties) return z.object({}).passthrough()

  const shape: Record<string, any> = {}
  for (const [key, prop] of Object.entries(schema.properties as any)) {
    const p = prop as any
    let field: any

    switch (p.type) {
      case 'string':
        field = z.string()
        if (p.enum) field = z.enum(p.enum)
        break
      case 'number':
      case 'integer':
        field = z.number()
        break
      case 'boolean':
        field = z.boolean()
        break
      case 'array':
        field = z.array(z.any())
        break
      case 'object':
        field = z.record(z.any())
        break
      default:
        field = z.any()
    }

    if (p.description) field = field.describe(p.description)
    if (!schema.required?.includes(key)) field = field.optional()

    shape[key] = field
  }

  return z.object(shape).passthrough()
}
