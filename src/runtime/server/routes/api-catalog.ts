import { defineEventHandler, setResponseHeader } from 'h3'
import { getAgentSiteUrl, useAgentDiscoveryConfig } from '../utils/agent-discovery'

/**
 * RFC 9727 api-catalog: the discovery links carrying an anchor, grouped into
 * an `application/linkset+json` document.
 */
export default defineEventHandler((event) => {
  const config = useAgentDiscoveryConfig(event)
  const siteUrl = getAgentSiteUrl(event)
  const absolute = (href: string) => href.startsWith('/') ? `${siteUrl}${href}` : href

  const groups = new Map<string, Record<string, unknown>>()
  for (const link of config.links) {
    if (!link.anchor || (link.rel !== 'service-desc' && link.rel !== 'service-doc')) {
      continue
    }
    const anchor = absolute(link.anchor === '/' ? '/' : link.anchor).replace(/\/$/, '') || `${siteUrl}/`
    let group = groups.get(anchor)
    if (!group) {
      group = { anchor: link.anchor === '/' ? `${siteUrl}/` : absolute(link.anchor) }
      groups.set(anchor, group)
    }
    const entries = (group[link.rel] ||= []) as { href: string, type?: string }[]
    entries.push({ href: absolute(link.href), ...(link.type ? { type: link.type } : {}) })
  }

  setResponseHeader(event, 'Content-Type', 'application/linkset+json; charset=utf-8')
  return { linkset: [...groups.values()] }
})
