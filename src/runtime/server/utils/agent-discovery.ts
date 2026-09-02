import type { H3Event } from 'h3'
import { getRequestURL } from 'h3'
import { useRuntimeConfig } from '#imports'
import { AGENT_RESOURCES_HEADING } from '../../shared/defaults'
import type { AgentContentSource, NegotiationConfig } from '../../shared/types'
import { absolutizeHref, encodeAgentRoute, hasFileExtension, matchRoute, normalizeAgentRoute, rawDestination } from '../../shared/negotiation'

export function useAgentDiscoveryConfig(event?: H3Event): NegotiationConfig {
  // Through `unknown`: a site's generated `runtimeConfig` type narrows these
  // records to that site's own literal keys.
  return useRuntimeConfig(event).agentDiscovery as unknown as NegotiationConfig
}

/** Configured canonical site URL, falling back to the request origin. */
export function getAgentSiteUrl(event: H3Event): string {
  const config = useAgentDiscoveryConfig(event)
  return config.siteUrl || getRequestURL(event).origin
}

/**
 * Absolute URL of a page's raw markdown twin, from the same route config the
 * negotiation and the CDN rewrites use. Paths that don't negotiate, and
 * anything already pointing at a file, come back absolute and untouched.
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

  // Decoded then re-encoded, so a non-ASCII route is spelled exactly as the
  // `Link` header and the `canonical_url` frontmatter spell it.
  pathname = normalizeAgentRoute(pathname)
  const route = pathname === '/' || !hasFileExtension(pathname) ? matchRoute(config.routes, pathname) : undefined

  return `${siteUrl}${encodeAgentRoute(route ? rawDestination(config, route, pathname) : pathname)}${suffix}`
}

/**
 * The discovery registry as a markdown block, from the same list the `Link`
 * header and the api-catalog are built from. The module already appends it to
 * the `/` document, so a site only calls this for a page it renders by hand.
 */
export function renderAgentResources(event: H3Event, options: { heading?: string } = {}): string {
  const config = useAgentDiscoveryConfig(event)
  const siteUrl = getAgentSiteUrl(event)
  const heading = options.heading ?? AGENT_RESOURCES_HEADING

  const lines = config.links
    .filter(link => link.title)
    .map(link => `- [${link.title}](${absolutizeHref(link.href, siteUrl)})`)

  return lines.length ? [`## ${heading}`, '', ...lines, ''].join('\n') : ''
}

export { agentDiscoveryOpenApi } from './openapi'
export type { AgentOpenApiOptions } from './openapi'

// The pieces an agent-facing tool is built from. See "Agent tooling" in the README.
export { listAgentPages } from './pages'
export type { AgentPageListing, AgentPageListOptions } from './pages'
export { getAgentDocument } from './document'
export type { AgentDocument, AgentDocumentOptions } from './document'
export { extractSections } from '../../shared/sections'

// The absolutization passes are not exported: the module runs one over whatever
// `get()` returns, and the pass is idempotent.

/** Identity helper for typed custom content sources. */
export function defineAgentContentSource(source: AgentContentSource): AgentContentSource {
  return source
}
