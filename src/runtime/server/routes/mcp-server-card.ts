import { defineEventHandler, setResponseHeader } from 'h3'
import { useNitroApp } from 'nitropack/runtime'
import { useRuntimeConfig } from '#imports'
import { listMcpDefinitions } from '#agent-discovery/mcp'
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
  excludeGroups?: string[]
}

/** What the toolkit's listing API returns per definition, of what we use. */
interface McpDefinition {
  name: string
  description?: string
  uri?: string
  group?: string
}

/**
 * MCP server card.
 *
 * The static half comes from `discovery.mcpServerCard`. The live half, what
 * the server actually exposes, is read from `@nuxtjs/mcp-toolkit` when the
 * site runs it: every adopter was otherwise writing the same plugin to copy
 * `listMcpDefinitions()` onto the card, and a card listing tools the server
 * no longer has is worse than no card.
 *
 * Detected, never depended on. Without the toolkit the import resolves to a
 * stub and the card is exactly what config declares. Either way
 * `agent-discovery:mcp-server-card` runs last, so a site can add or correct
 * anything.
 */
export default defineEventHandler(async (event) => {
  const card = useRuntimeConfig(event).agentDiscoveryMcp as McpServerCardConfig
  const siteUrl = getAgentSiteUrl(event)
  const absolute = (href: string) => href.startsWith('/') ? `${siteUrl}${href}` : href

  // No `$schema`: the URL this used to carry 404s, and so does the one the
  // draft that would define it (SEP-2127) proposes, because that draft is
  // unmerged. The released MCP spec has no server card, so the shape below is
  // pre-standard by nature and advertising a schema it cannot be checked
  // against is worse than advertising none.
  const serverCard: Record<string, unknown> = {
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

  if (listMcpDefinitions) {
    const { tools, resources, prompts } = await listMcpDefinitions({ event }) as {
      tools: McpDefinition[]
      resources: McpDefinition[]
      prompts: McpDefinition[]
    }
    // Groups come from the subdirectory a definition sits in, which is how a
    // site separates its admin tools from the ones anybody may call.
    // Extends the default rather than replacing it: a site naming its own
    // private group should not silently start publishing its admin tools.
    const excluded = new Set(['admin', ...(card.excludeGroups ?? [])])
    const isPublic = (definition: McpDefinition) => !definition.group || !excluded.has(definition.group)

    serverCard.capabilities = {
      tools: { listChanged: false },
      resources: { listChanged: false, subscribe: false },
      prompts: { listChanged: false },
      logging: {}
    }
    serverCard.tools = tools.filter(isPublic).map(tool => ({ name: tool.name, description: tool.description }))
    serverCard.resources = resources.filter(isPublic).map(resource => ({ name: resource.name, uri: resource.uri, description: resource.description }))
    serverCard.prompts = prompts.filter(isPublic).map(prompt => ({ name: prompt.name, description: prompt.description }))
  }

  await useNitroApp().hooks.callHook('agent-discovery:mcp-server-card', event, serverCard)

  setResponseHeader(event, 'Content-Type', 'application/json; charset=utf-8')
  // The other discovery documents are build-time output and cache for an hour.
  // This one is not: the definitions are listed per request and the hook runs
  // after them, so a shared cache would keep advertising a tool the server has
  // since dropped, which is worse than serving no card at all.
  setResponseHeader(event, 'Cache-Control', 'no-cache')
  return serverCard
})
