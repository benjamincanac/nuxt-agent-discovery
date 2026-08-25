import { defineEventHandler, setResponseHeader } from 'h3'
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
 * Minimal MCP server card. Sites running `@nuxtjs/mcp-toolkit` usually serve
 * a richer card themselves (live tool listings) and keep this disabled,
 * registering only the discovery link.
 */
export default defineEventHandler((event) => {
  const card = useRuntimeConfig(event).agentDiscoveryMcp as McpServerCardConfig
  const siteUrl = getAgentSiteUrl(event)
  const absolute = (href: string) => href.startsWith('/') ? `${siteUrl}${href}` : href

  setResponseHeader(event, 'Content-Type', 'application/json; charset=utf-8')
  return {
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
})
