// MCP client for the stavebak server.
// Requires @modelcontextprotocol/sdk — install when implementing Phase 3 (ADR-0002).

interface McpToolResult {
  content: Array<{ type: string; text: string }>
}

let _client: unknown = null

export async function getStavebakClient(): Promise<unknown> {
  if (_client) return _client

  // Phase 3: replace with real MCP SDK client
  // import { Client } from '@modelcontextprotocol/sdk/client/index.js'
  // import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
  // _client = new Client({ name: 'stavebak-desktop', version: '1.0.0' })
  // const transport = new StreamableHTTPClientTransport(new URL('https://stavebak.cz/mcp'))
  // await _client.connect(transport)
  throw new Error('MCP SDK not installed — add @modelcontextprotocol/sdk to enable')
}

export async function getProjectStatus(projectId: string): Promise<McpToolResult> {
  const c = await getStavebakClient() as any
  return c.callTool({ name: 'guide', arguments: { projectId } })
}

export async function listProjects(): Promise<McpToolResult> {
  const c = await getStavebakClient() as any
  return c.callTool({ name: 'list_projects', arguments: {} })
}
