import { defineEventHandler, setResponseHeader } from 'h3'
import { useNitroApp } from 'nitropack/runtime'
import { useRuntimeConfig } from '#imports'
import { listMcpDefinitions } from '#agent-discovery/mcp'
import { getAgentSiteUrl } from '../utils/agent-discovery'
import { absolutizeHref } from '../../shared/negotiation'
import { mcpExcludedGroups } from '../../shared/defaults'

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
 * MCP server card: the static half from `discovery.mcpServerCard`, the live
 * half from `@nuxtjs/mcp-toolkit` when the site runs it. Without the toolkit
 * the import resolves to a stub and the card is what config declares.
 * `agent-discovery:mcp-server-card` runs last, so a site can correct anything.
 */
export default defineEventHandler(async (event) => {
  const card = useRuntimeConfig(event).agentDiscoveryMcp as McpServerCardConfig
  const siteUrl = getAgentSiteUrl(event)

  // No `$schema`: the released MCP spec has no server card, and the draft that
  // would define one is unmerged, so the URL it proposes 404s.
  const serverCard: Record<string, unknown> = {
    serverInfo: {
      name: card.name,
      ...(card.version ? { version: card.version } : {}),
      ...(card.title ? { title: card.title } : {}),
      ...(card.description ? { description: card.description } : {}),
      homepage: siteUrl,
      ...(card.documentation ? { documentation: absolutizeHref(card.documentation, siteUrl) } : {}),
      ...(card.license ? { license: card.license } : {}),
      ...(card.repository ? { repository: card.repository } : {})
    },
    endpoints: [
      {
        type: 'streamable-http',
        url: absolutizeHref(card.endpoint, siteUrl)
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
    const excluded = mcpExcludedGroups(card.excludeGroups)
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
  // Listed per request, so a shared cache would keep advertising a tool the
  // server has since dropped.
  setResponseHeader(event, 'Cache-Control', 'no-cache')
  return serverCard
})
