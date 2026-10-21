import { getRequestOrigin, useServerConfig } from '#agent-discovery/server'
import { AGENT_RESOURCES_HEADING } from '../../shared/defaults'
import { appBase } from '../../shared/paths'
import type { AgentContentSource, AgentMarkdownFormat, AgentRequestEvent, NegotiationConfig } from '../../shared/types'
import { absolutizeHref, encodeAgentRoute, hasFileExtension, matchRoute, normalizeAgentRoute, rawDestination } from '../../shared/negotiation'

export function useAgentDiscoveryConfig(event?: AgentRequestEvent): NegotiationConfig {
  // Through `unknown`: a site's generated `runtimeConfig` type narrows these
  // records to that site's own literal keys.
  return useServerConfig(event).agentDiscovery as unknown as NegotiationConfig
}

/** Component syntax the content adapters serialize with, `markdown/comark` unless configured. */
export function getAgentMarkdownFormat(event: AgentRequestEvent): AgentMarkdownFormat {
  return useAgentDiscoveryConfig(event).markdownFormat || 'markdown/comark'
}

/** `app.baseURL` as a prefix, empty at the root. Redirects and `Link` hrefs leave from it. */
export function getAgentBase(event?: AgentRequestEvent): string {
  return appBase((useServerConfig(event).app as { baseURL?: string } | undefined)?.baseURL)
}

/**
 * Configured canonical site URL, falling back to the request origin. Either way
 * it is the URL of the app root, `app.baseURL` included, so a route appends to it.
 */
export function getAgentSiteUrl(event: AgentRequestEvent): string {
  const config = useAgentDiscoveryConfig(event)
  return config.siteUrl || `${getRequestOrigin(event)}${getAgentBase(event)}`
}

/**
 * Absolute URL of a page's raw markdown twin, from the same route config the
 * negotiation and the CDN rewrites use. Paths that don't negotiate, and
 * anything already pointing at a file, come back absolute and untouched.
 */
export function rawUrl(event: AgentRequestEvent, path: string): string {
  const config = useAgentDiscoveryConfig(event)
  const siteUrl = getAgentSiteUrl(event)

  let pathname = path
  let suffix = ''
  if (/^https?:\/\//.test(path)) {
    const url = new URL(path)
    const site = new URL(siteUrl)
    // Under a base path an absolute URL carries it and a route does not.
    const root = site.pathname.replace(/\/+$/, '')
    if (url.origin !== site.origin || (root && url.pathname !== root && !url.pathname.startsWith(`${root}/`))) {
      return path
    }
    pathname = url.pathname.slice(root.length) || '/'
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
export function renderAgentResources(event: AgentRequestEvent, options: { heading?: string } = {}): string {
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
