import type { H3Event } from 'h3'
import { getRequestURL } from 'h3'
import { useRuntimeConfig } from '#imports'
import type { AgentContentSource, NegotiationConfig } from '../../shared/types'
import { hasFileExtension, matchRoute, normalizePathname, rawDestination } from '../../shared/negotiation'

export function useAgentDiscoveryConfig(event?: H3Event): NegotiationConfig {
  return useRuntimeConfig(event).agentDiscovery as NegotiationConfig
}

/** Configured canonical site URL, falling back to the request origin. */
export function getAgentSiteUrl(event: H3Event): string {
  const config = useAgentDiscoveryConfig(event)
  return config.siteUrl || getRequestURL(event).origin
}

/**
 * Absolute URL of a page's raw markdown twin, from the same route config the
 * negotiation and the CDN rewrites use. Pages that don't negotiate (and
 * anything already pointing at a file) come back untouched, absolute.
 *
 * Sites hand-rolling this drift the moment `routes` changes: a hardcoded
 * `/docs/` prefix keeps rewriting after the config has moved on.
 */
export function rawUrl(event: H3Event, path: string): string {
  const config = useAgentDiscoveryConfig(event)
  const siteUrl = getAgentSiteUrl(event)

  let pathname = path
  let suffix = ''
  if (/^https?:\/\//.test(path)) {
    const url = new URL(path)
    if (url.origin !== new URL(siteUrl).origin) {
      return path
    }
    pathname = url.pathname
    suffix = url.search + url.hash
  } else {
    const separator = path.search(/[?#]/)
    if (separator !== -1) {
      pathname = path.slice(0, separator)
      suffix = path.slice(separator)
    }
  }

  pathname = normalizePathname(pathname)
  const route = pathname === '/' || !hasFileExtension(pathname) ? matchRoute(config.routes, pathname) : undefined

  return `${siteUrl}${route ? rawDestination(config, route, pathname) : pathname}${suffix}`
}

/**
 * The discovery registry as a markdown block, for sites that hand-write an
 * agent-facing homepage. Same list the `Link` header and the api-catalog are
 * built from, so a resource can never be advertised in one place and missed
 * in another.
 */
export function renderAgentResources(event: H3Event, options: { heading?: string } = {}): string {
  const config = useAgentDiscoveryConfig(event)
  const siteUrl = getAgentSiteUrl(event)
  const heading = options.heading ?? 'Resources for Agents'

  const lines = config.links
    .filter(link => link.title)
    .map(link => `- [${link.title}](${link.href.startsWith('/') ? `${siteUrl}${link.href}` : link.href})`)

  return lines.length ? [`## ${heading}`, '', ...lines, ''].join('\n') : ''
}

export { agentDiscoveryOpenApi } from './openapi'

// For adapters that render straight to markdown: `@nuxt/content` rewrites its
// tree instead, but every backend has to end up with absolute links.
export { absolutizeMarkdownLinks } from '../../shared/negotiation'

/** Identity helper for typed custom content sources. */
export function defineAgentContentSource(source: AgentContentSource): AgentContentSource {
  return source
}
