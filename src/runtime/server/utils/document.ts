import type { H3Event } from 'h3'
import { useNitroApp } from 'nitropack/runtime'
import source from '#agent-discovery/source'
import { getAgentSiteUrl, renderAgentResources, useAgentDiscoveryConfig } from './agent-discovery'
import { extractSections } from '../../shared/sections'
import { absolutizeMarkdownLinks, encodeAgentRoute, isExcluded, normalizeAgentRoute } from '../../shared/negotiation'
import type { AgentIndex, AgentPage } from '../../shared/types'

/** A resolved markdown document, or where to go instead. */
export interface AgentDocument {
  /** The full document: frontmatter, body, and the sitemap footer. */
  markdown: string
  title?: string
  description?: string
  /** Canonical URL of the HTML page this represents. */
  canonicalUrl: string
}

export interface AgentDocumentOptions {
  /**
   * `##` headings to narrow the body to, for a caller that wants one part of
   * a long page. Ignored when none of them match, since a document minus
   * everything is not a useful answer.
   */
  sections?: string[]
  /**
   * Resolve a route under an excluded prefix anyway. By default it comes back
   * `null`, the same answer every listing gives: an excluded path has no
   * markdown twin as far as the site advertises. The opt-in exists for MCP
   * tools, which are exactly where a site serves what it does not advertise
   * (a nightly docs version kept out of `sitemap.md` and `llms.txt`).
   */
  includeExcluded?: boolean
}

/**
 * The landing page as markdown, for a site whose `/` is a Vue page rather than
 * a content document. The bridge already links `/raw/index.md` from `llms.txt`,
 * and both `nuxt/ui` docs and `nuxt.com` hand-wrote this route to stop it
 * 404ing. Everything structural comes from the registry; `agent-discovery:index`
 * is where the site fills in what only it knows.
 *
 * The hook gets the whole document, not just its body: the title and
 * description of a landing page like this live wherever the site keeps them,
 * and `siteName` is a fallback rather than the answer. There is no page to read
 * them off, which is the reason this branch exists at all.
 */
async function generatedIndex(event: H3Event, siteUrl: string): Promise<AgentIndex & { markdown: string }> {
  const config = useAgentDiscoveryConfig(event)

  const index: AgentIndex = {
    title: config.siteName || siteUrl.replace(/^https?:\/\//, ''),
    body: []
  }
  await useNitroApp().hooks.callHook('agent-discovery:index', event, index)

  const resources = renderAgentResources(event)
  return {
    ...index,
    markdown: [
      `# ${index.title}`,
      '',
      // Same shape a content document comes out in, so the two paths read
      // alike whichever one served the file.
      ...(index.description ? [`> ${index.description}`, ''] : []),
      ...(index.body.length ? [...index.body, ''] : []),
      ...(resources ? [resources] : []),
      'Every page on this site is available as raw markdown: append `.md` to its',
      'URL or send `Accept: text/markdown`.',
      ''
    ].join('\n')
  }
}

/**
 * `source.get()` plus the link absolutization every adapter would otherwise
 * have to remember.
 *
 * A markdown document is read detached from the site it came from, so a
 * site-relative link in it points nowhere. The built-in adapters already
 * rewrite their document tree, where they can also see the links in MDC
 * component props; this pass is idempotent over that, because it only matches a
 * destination starting with a single slash and those are already absolute.
 * Doing it here rather than in each adapter is what keeps a custom source from
 * silently emitting relative links.
 */
export async function getSourcePage(route: string, event: H3Event): Promise<AgentPage | null> {
  const page = await source?.get(route, event)
  if (!page) {
    return null
  }
  return { ...page, markdown: absolutizeMarkdownLinks(page.markdown, getAgentSiteUrl(event)) }
}

/**
 * The generated landing page, in the same shape `getSourcePage` returns, for
 * a consumer rendering `/` on an adapter with no `/` entry. The raw route
 * reaches the same document through `getAgentDocument`'s own fallback.
 */
export async function generatedIndexPage(event: H3Event): Promise<AgentPage> {
  const index = await generatedIndex(event, getAgentSiteUrl(event))
  return { title: index.title, description: index.description, markdown: index.markdown }
}

/**
 * Resolves a page route to the exact document `/raw/<path>.md` serves.
 *
 * The HTTP route is a thin shell over this so that anything else reaching for
 * a page's markdown, an MCP `get-page` tool most of all, returns the same
 * bytes as the URL. Sites currently do that by `$fetch`ing their own raw
 * route from inside a serverless function, which pays for a second request to
 * reach code already loaded in the same process, and drifts the moment the
 * two disagree.
 *
 * Returns `null` for a route with no markdown representation. `redirect` is a
 * path that names a section rather than a page, where the section's first
 * document is the answer.
 */
export async function getAgentDocument(event: H3Event, route: string, options: AgentDocumentOptions = {}): Promise<AgentDocument | { redirect: string } | null> {
  const config = useAgentDiscoveryConfig(event)

  const path = normalizeAgentRoute(route)

  // The same filter every listing applies, so the raw route (a thin shell
  // over this) answers 404 where `sitemap.md`, `llms.txt` and
  // `listAgentPages()` say the page does not exist. Serving it anyway made
  // the exclusion look like an indexing choice when it is the module-wide
  // definition of "not a page".
  if (!options.includeExcluded && isExcluded(path, config)) {
    return null
  }

  const siteUrl = getAgentSiteUrl(event)
  // Re-encoded because `normalizeAgentRoute` decoded the path above, and this
  // URL lands in a `Link` header, where Node rejects anything above U+00FF.
  // Per segment: `encodeURI` would leave a `#` or `?` in a slug alone, and
  // either one cuts the URL short right there.
  const canonicalUrl = `${siteUrl}${path === '/' ? '' : encodeAgentRoute(path)}` || siteUrl

  const page = await getSourcePage(path, event)
  if (!page) {
    // A path that names a section rather than a page (`/getting-started` with
    // no index) resolves to the section's first document, the same as the
    // HTML page does. Anything else is a genuine 404, except `/`, which falls
    // through to the generated index below.
    const leaf = path === '/' ? null : await source?.firstLeaf?.(path, event)
    if (leaf && leaf !== path) {
      return { redirect: leaf }
    }
    if (path !== '/') {
      return null
    }
  }

  const index = page ? undefined : await generatedIndex(event, siteUrl)

  // An empty key reads as a value the page deliberately set to nothing, so a
  // missing title or description is left out rather than emitted as `""`.
  const title = page?.title || index?.title
  const description = page?.description || index?.description
  const frontmatter = [
    '---',
    ...(title ? [`title: ${JSON.stringify(title)}`] : []),
    ...(description ? [`description: ${JSON.stringify(description)}`] : []),
    `canonical_url: ${JSON.stringify(canonicalUrl)}`,
    '---',
    ''
  ].join('\n')

  if (index) {
    return { markdown: frontmatter + index.markdown, title, description, canonicalUrl }
  }

  // Absolute, like the links inside the body: this file is read detached from
  // the site.
  const sitemap = config.links.some(link => link.href === '/sitemap.md')
    ? `\n\n## Sitemap\n\nSee the full [sitemap](${siteUrl}/sitemap.md) for all pages.\n`
    : '\n'

  const markdown = frontmatter + page!.markdown + sitemap

  return {
    markdown: options.sections?.length ? extractSections(markdown, options.sections) : markdown,
    title,
    description,
    canonicalUrl
  }
}
