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
  // Built from `discovery.links`, which is settled at build time, so the
  // document is host-independent only when a site URL is configured. Without
  // one the body carries the request origin, which must never be cached and
  // handed to the next host that asks.
  setResponseHeader(event, 'Cache-Control', config.siteUrl ? 'public, max-age=3600' : 'no-cache')
  return { linkset: [...groups.values()] }
})
