import source from '#agent-discovery/source'
import { getAgentSiteUrl, rawUrl, useAgentDiscoveryConfig } from './agent-discovery'
import { encodeAgentRoute, isExcluded, normalizeAgentRoute } from '../../shared/negotiation'
import type { AgentListEntry, AgentRequestEvent } from '../../shared/types'

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
 * An adapter's entries with every route normalized and listed once. comark
 * emits a directory `index.md` both as the section node and as its first
 * child, and `/index` normalizes onto `/`, so one page can arrive twice. The
 * first one keeps its place and takes the fields it lacks from the others.
 */
export function normalizeAgentEntries(entries: AgentListEntry[]): AgentListEntry[] {
  const byRoute = new Map<string, AgentListEntry>()
  for (const entry of entries) {
    const route = normalizeAgentRoute(entry.route)
    const seen = byRoute.get(route)
    if (seen) {
      seen.title ??= entry.title
      seen.description ??= entry.description
      seen.section ??= entry.section
    } else {
      byRoute.set(route, { ...entry, route })
    }
  }
  return [...byRoute.values()]
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
export async function listAgentPages(event: AgentRequestEvent, options: AgentPageListOptions = {}): Promise<AgentPageListing[]> {
  if (!source) {
    return []
  }

  // Normalized to the spelling `getAgentDocument` resolves and the exclusion
  // list is written in. An encoded route would otherwise slip past the filters.
  const entries = normalizeAgentEntries((await source.list?.(undefined, event)) ?? [])

  const config = useAgentDiscoveryConfig(event)
  const siteUrl = getAgentSiteUrl(event)
  const terms = options.search?.toLowerCase().split(/\s+/).filter(Boolean) || []

  return entries
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
