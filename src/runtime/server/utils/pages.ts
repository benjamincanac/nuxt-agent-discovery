import type { H3Event } from 'h3'
import source from '#agent-discovery/source'
import { getAgentSiteUrl, rawUrl, useAgentDiscoveryConfig } from './agent-discovery'

/** One page in a listing, with both URLs an agent might want. */
export interface AgentPageListing {
  route: string
  title?: string
  description?: string
  /** Group the adapter puts this page in, where it has one. */
  section?: string
  /** Absolute URL of the HTML page. */
  url: string
  /** Absolute URL of its markdown twin. */
  rawUrl: string
}

export interface AgentPageListOptions {
  /**
   * Keeps pages matching every whitespace-separated term, across the title,
   * the path and the description. Every term rather than any, because a
   * two-word query means both words on a docs site.
   */
  search?: string
  /** Keeps pages under this path prefix. */
  prefix?: string
}

/**
 * Every markdown-representable page, from whichever adapter is installed.
 *
 * The listing an MCP `list-pages` tool wants, and the one `sitemap.md`
 * already builds. Sites write this by hand today against `queryCollection()`
 * or a navigation tree, which ties the tool to one backend and re-derives the
 * raw URL, so it drifts from the CDN rewrites the first time `rawPrefix` or
 * `routes` changes. Both URLs here come from the same `rawUrl()` the
 * negotiation and the `llms.txt` bridge resolve.
 *
 * Without `list()` on the adapter this falls back to bare `routes()`, with no
 * metadata: filling each entry in would cost a full render per page, and
 * neither caller is worth that.
 */
export async function listAgentPages(event: H3Event, options: AgentPageListOptions = {}): Promise<AgentPageListing[]> {
  if (!source) {
    return []
  }

  const entries = source.list
    ? (await source.list(event)) || []
    : (await source.routes(event)).map(route => ({ route, title: undefined, description: undefined, section: undefined }))

  const config = useAgentDiscoveryConfig(event)
  const siteUrl = getAgentSiteUrl(event)
  const terms = options.search?.toLowerCase().split(/\s+/).filter(Boolean) || []

  return entries
    // A path the module refuses to negotiate is not a page as far as the rest
    // of the module is concerned, so listing it in `sitemap.md` or handing it
    // to an MCP tool would advertise a markdown twin that does not exist. This
    // is also how a site keeps a legacy docs version out of both.
    .filter(entry => !config.excludePrefixes.some(prefix => entry.route.startsWith(prefix)))
    .filter(entry => !options.prefix || entry.route.startsWith(options.prefix))
    .filter((entry) => {
      if (!terms.length) {
        return true
      }
      const haystack = `${entry.title || ''} ${entry.route} ${entry.description || ''}`.toLowerCase()
      return terms.every(term => haystack.includes(term))
    })
    .map(entry => ({
      route: entry.route,
      title: entry.title,
      description: entry.description,
      section: entry.section,
      url: `${siteUrl}${entry.route === '/' ? '' : entry.route}` || siteUrl,
      rawUrl: rawUrl(event, entry.route)
    }))
}
