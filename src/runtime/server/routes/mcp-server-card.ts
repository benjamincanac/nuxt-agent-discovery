import { defineEventHandler, setResponseHeader } from 'h3'
import { useNitroApp } from 'nitropack/runtime'
import { useRuntimeConfig } from '#imports'
import { getAgentSiteUrl } from '../utils/agent-discovery'

interface McpServerCardConfig {
  endpoint: string
  name: string
  title?: string
  description?: string
  documentation?: string
  repository?: string
  license?: string
  version?: string
}

/**
 * MCP server card. The static half comes from `discovery.mcpServerCard`; a
 * site that knows its live tools, resources and prompts fills the rest in
 * through the `agent-discovery:mcp-server-card` hook:
 *
 * ```ts
 * nitroApp.hooks.hook('agent-discovery:mcp-server-card', async (event, card) => {
 *   const { tools } = await listMcpDefinitions({ event })
 *   card.tools = tools.map(tool => ({ name: tool.name, description: tool.description }))
 * })
 * ```
 *
 * Detecting an MCP module directly would make this module depend on one, which
 * is exactly the coupling it exists to avoid.
 */
export default defineEventHandler(async (event) => {
  const card = useRuntimeConfig(event).agentDiscoveryMcp as McpServerCardConfig
  const siteUrl = getAgentSiteUrl(event)
  const absolute = (href: string) => href.startsWith('/') ? `${siteUrl}${href}` : href

  const serverCard: Record<string, unknown> = {
    $schema: 'https://modelcontextprotocol.io/schema/server-card/v1',
    serverInfo: {
      name: card.name,
      ...(card.version ? { version: card.version } : {}),
      ...(card.title ? { title: card.title } : {}),
      ...(card.description ? { description: card.description } : {}),
      homepage: siteUrl,
      ...(card.documentation ? { documentation: absolute(card.documentation) } : {}),
      ...(card.license ? { license: card.license } : {}),
      ...(card.repository ? { repository: card.repository } : {})
    },
    endpoints: [
      {
        type: 'streamable-http',
        url: absolute(card.endpoint)
      }
    ],
    authentication: {
      required: false
    }
  }

  const hooks = useNitroApp().hooks as unknown as { callHook: (name: string, ...args: unknown[]) => Promise<void> }
  await hooks.callHook('agent-discovery:mcp-server-card', event, serverCard)

  setResponseHeader(event, 'Content-Type', 'application/json; charset=utf-8')
  return serverCard
})
