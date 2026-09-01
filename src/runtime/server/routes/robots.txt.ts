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
  const { contentSignal, disallow } = useRuntimeConfig(event).agentDiscoveryRobots as { contentSignal: string, disallow?: string[] }
  const siteUrl = getAgentSiteUrl(event)

  const lines: string[] = ['User-agent: *']
  if (contentSignal) {
    lines.push(`Content-Signal: ${contentSignal}`)
  }
  // Wildcard group only: the agent groups below exempt their agents from
  // these rules, deliberately, so what search engines are kept out of stays
  // reachable for the agents the site names.
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

  setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  // Same as the api-catalog: the agent list and the content signal are both
  // build-time configuration, but the sitemap line is only host-independent
  // when a site URL is configured. Without one the body carries the request
  // origin, which must never be cached and handed to the next host that asks.
  setResponseHeader(event, 'Cache-Control', config.siteUrl ? 'public, max-age=3600' : 'no-cache')
  return lines.join('\n')
})
