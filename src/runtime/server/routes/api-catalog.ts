import { defineEventHandler, setResponseHeader } from 'h3'
import { getAgentSiteUrl, useAgentDiscoveryConfig } from '../utils/agent-discovery'
import { absolutizeHref } from '../../shared/negotiation'

/**
 * RFC 9727 api-catalog: the discovery links carrying an anchor, grouped into
 * an `application/linkset+json` document.
 */
export default defineEventHandler((event) => {
  const config = useAgentDiscoveryConfig(event)
  const siteUrl = getAgentSiteUrl(event)

  const groups = new Map<string, Record<string, unknown>>()
  for (const link of config.links) {
    if (!link.anchor || (link.rel !== 'service-desc' && link.rel !== 'service-doc')) {
      continue
    }
    const anchor = absolutizeHref(link.anchor, siteUrl).replace(/\/$/, '') || `${siteUrl}/`
    let group = groups.get(anchor)
    if (!group) {
      group = { anchor: absolutizeHref(link.anchor, siteUrl) }
      groups.set(anchor, group)
    }
    const entries = (group[link.rel] ||= []) as { href: string, type?: string }[]
    entries.push({ href: absolutizeHref(link.href, siteUrl), ...(link.type ? { type: link.type } : {}) })
  }

  setResponseHeader(event, 'Content-Type', 'application/linkset+json; charset=utf-8')
  // Without a configured site URL the body carries the request origin, so it
  // must never be cached and handed to the next host that asks.
  setResponseHeader(event, 'Cache-Control', config.siteUrl ? 'public, max-age=3600' : 'no-cache')
  return { linkset: [...groups.values()] }
})
