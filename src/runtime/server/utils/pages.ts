import type { H3Event } from 'h3'
import source from '#agent-discovery/source'
import { getAgentSiteUrl, rawUrl, useAgentDiscoveryConfig } from './agent-discovery'
import { encodeAgentRoute, isExcluded, normalizeAgentRoute } from '../../shared/negotiation'

/** One page in a listing. */
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
   * Keeps pages matching every whitespace-separated term, across the title, the
   * path and the description.
   */
  search?: string
  /** Keeps pages under this path prefix. */
  prefix?: string
  /**
   * List pages under excluded prefixes too. The same opt-in
   * `getAgentDocument()` has.
   */
  includeExcluded?: boolean
}

/**
 * Every markdown-representable page, from whichever adapter is installed. Both
 * URLs come from the same `rawUrl()` the negotiation and the `llms.txt` bridge
 * resolve.
 *
 * An adapter that cannot enumerate its pages leaves `list()` off and the listing
 * comes back empty. There is no fallback: rebuilding it out of `get()` would
 * cost a full render per page.
 */
export async function listAgentPages(event: H3Event, options: AgentPageListOptions = {}): Promise<AgentPageListing[]> {
  if (!source) {
    return []
  }

  const entries = (await source.list?.(undefined, event)) ?? []

  const config = useAgentDiscoveryConfig(event)
  const siteUrl = getAgentSiteUrl(event)
  const terms = options.search?.toLowerCase().split(/\s+/).filter(Boolean) || []

  return entries
    // To the spelling `getAgentDocument` resolves and the exclusion list is
    // written in. An encoded route would otherwise slip past the filters below.
    .map(entry => ({ ...entry, route: normalizeAgentRoute(entry.route) }))
    // A path the module refuses to negotiate has no markdown twin, so listing it
    // would advertise one that does not exist.
    .filter(entry => options.includeExcluded || !isExcluded(entry.route, config))
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
      // Encoded like `canonical_url`, so the two spellings of a non-ASCII page
      // cannot diverge between the listing and the document itself.
      url: `${siteUrl}${entry.route === '/' ? '' : encodeAgentRoute(entry.route)}`,
      rawUrl: rawUrl(event, entry.route)
    }))
}
