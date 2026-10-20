import { getAgentSiteUrl, useAgentDiscoveryConfig } from './agent-discovery'
import { absolutizeHref } from '../../shared/negotiation'
import type { AgentRequestEvent } from '../../shared/types'

/**
 * RFC 9727 api-catalog: the discovery links carrying an anchor, grouped into
 * an `application/linkset+json` document.
 */
export function apiCatalog(event: AgentRequestEvent): { body: { linkset: Record<string, unknown>[] }, headers: Record<string, string> } {
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

  return {
    body: { linkset: [...groups.values()] },
    headers: {
      'Content-Type': 'application/linkset+json; charset=utf-8',
      // Without a configured site URL the body carries the request origin, so it
      // must never be cached and handed to the next host that asks.
      'Cache-Control': config.siteUrl ? 'public, max-age=3600' : 'no-cache'
    }
  }
}
