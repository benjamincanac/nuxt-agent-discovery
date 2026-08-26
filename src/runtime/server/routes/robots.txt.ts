import { defineEventHandler, setResponseHeader } from 'h3'
import { useRuntimeConfig } from '#imports'
import { getAgentSiteUrl, useAgentDiscoveryConfig } from '../utils/agent-discovery'

/**
 * Generated `robots.txt` allowing the same agent list the negotiation
 * matches, so the two can never drift apart. Only registered when the site
 * has neither a static `public/robots.txt` nor `@nuxtjs/robots`.
 */
export default defineEventHandler((event) => {
  const config = useAgentDiscoveryConfig(event)
  const { contentSignal } = useRuntimeConfig(event).agentDiscoveryRobots as { contentSignal: string }
  const siteUrl = getAgentSiteUrl(event)

  const lines: string[] = ['User-agent: *']
  if (contentSignal) {
    lines.push(`Content-Signal: ${contentSignal}`)
  }
  lines.push('Allow: /', '')

  for (const userAgent of config.userAgents) {
    lines.push(`User-agent: ${userAgent}`, 'Allow: /', '')
  }

  if (config.links.some(link => link.href === '/sitemap.xml')) {
    lines.push(`Sitemap: ${siteUrl}/sitemap.xml`, '')
  }

  setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  // Same as the api-catalog: the agent list and the content signal are both
  // build-time configuration.
  setResponseHeader(event, 'Cache-Control', 'public, max-age=3600')
  return lines.join('\n')
})
