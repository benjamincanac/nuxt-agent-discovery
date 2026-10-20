import { useServerConfig } from '#agent-discovery/server'
import { getAgentSiteUrl, useAgentDiscoveryConfig } from './agent-discovery'
import type { AgentRequestEvent } from '../../shared/types'

/**
 * Generated `robots.txt` allowing the same agent list the negotiation matches.
 * Only registered when the site has neither a static `public/robots.txt` nor
 * `@nuxtjs/robots`.
 */
export function robotsTxt(event: AgentRequestEvent): { body: string, headers: Record<string, string> } {
  const config = useAgentDiscoveryConfig(event)
  const { contentSignal, disallow } = useServerConfig(event).agentDiscoveryRobots as { contentSignal: string, disallow?: string[] }
  const siteUrl = getAgentSiteUrl(event)

  const lines: string[] = ['User-agent: *']
  if (contentSignal) {
    lines.push(`Content-Signal: ${contentSignal}`)
  }
  // Wildcard group only: the agent groups below exempt their agents from these
  // rules, so what search engines are kept out of stays reachable for agents.
  for (const path of disallow || []) {
    lines.push(`Disallow: ${path}`)
  }
  lines.push('Allow: /', '')

  for (const userAgent of config.userAgents) {
    lines.push(`User-agent: ${userAgent}`, 'Allow: /', '')
  }

  if (config.links.some(link => link.href === '/sitemap.xml')) {
    lines.push(`Sitemap: ${siteUrl}/sitemap.xml`, '')
  }

  return {
    body: lines.join('\n'),
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      // Without a configured site URL the sitemap line carries the request origin,
      // so it must not be cached. Same rule as the api-catalog.
      'Cache-Control': config.siteUrl ? 'public, max-age=3600' : 'no-cache'
    }
  }
}
