import type { H3Event } from 'h3'
import { getRequestURL } from 'h3'
import { useRuntimeConfig } from '#imports'
import type { AgentContentSource, NegotiationConfig } from '../../shared/types'
import { absolutizeHref, encodeAgentRoute, hasFileExtension, matchRoute, normalizeAgentRoute, rawDestination } from '../../shared/negotiation'

export function useAgentDiscoveryConfig(event?: H3Event): NegotiationConfig {
  // Through `unknown`: a site's generated `runtimeConfig` type narrows the
  // records this config carries to that site's own literal keys, which no
  // longer overlap with the module's declaration.
  return useRuntimeConfig(event).agentDiscovery as unknown as NegotiationConfig
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

  // Decoded like the raw handler decodes its slug, then re-encoded on the way
  // out, so a non-ASCII route is spelled here exactly as the `Link` header
  // and `canonical_url` frontmatter spell it.
  pathname = normalizeAgentRoute(pathname)
  const route = pathname === '/' || !hasFileExtension(pathname) ? matchRoute(config.routes, pathname) : undefined

  return `${siteUrl}${encodeAgentRoute(route ? rawDestination(config, route, pathname) : pathname)}${suffix}`
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
    .map(link => `- [${link.title}](${absolutizeHref(link.href, siteUrl)})`)

  return lines.length ? [`## ${heading}`, '', ...lines, ''].join('\n') : ''
}

export { agentDiscoveryOpenApi } from './openapi'
export type { AgentOpenApiOptions } from './openapi'

// The pieces an agent-facing tool is built from, so a site's MCP `list-pages`
// and `get-page` stay one call each and cannot drift from what the raw route
// and the CDN rewrites do. See the "Agent tooling" section of the README.
export { listAgentPages } from './pages'
export type { AgentPageListing, AgentPageListOptions } from './pages'
export { getAgentDocument } from './document'
export type { AgentDocument, AgentDocumentOptions } from './document'
export { extractSections } from '../../shared/sections'

// The absolutization passes are deliberately not exported: the module runs one
// over whatever `get()` returns, so an adapter that forgets cannot emit
// relative links, and one that does it anyway is unaffected because the pass is
// idempotent.

/** Identity helper for typed custom content sources. */
export function defineAgentContentSource(source: AgentContentSource): AgentContentSource {
  return source
}
