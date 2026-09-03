import type { H3Event } from 'h3'
import { useNitroApp } from 'nitropack/runtime'
import source from '#agent-discovery/source'
import { getAgentSiteUrl, renderAgentResources, useAgentDiscoveryConfig } from './agent-discovery'
import { AGENT_RESOURCES_HEADING } from '../../shared/defaults'
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
  /** `##` headings to narrow the body to. Ignored when none match, since a document minus everything is useless. */
  sections?: string[]
  /**
   * Resolve a route under an excluded prefix anyway. It comes back `null` by
   * default, the answer every listing gives. The opt-in is for MCP tools, where a
   * site serves what it does not advertise, a nightly docs version for instance.
   */
  includeExcluded?: boolean
}

/**
 * The landing page as markdown, for a site whose `/` is a Vue page rather than a
 * content document. The hook gets the whole document, not just its body: there is
 * no page to read a title and description off, and `siteName` is only a fallback.
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
 * `source.get()` plus link absolutization, since a markdown document is read
 * detached from the site it came from. Idempotent over the built-in adapters,
 * which rewrite their document tree already: this only matches a destination
 * starting with a single slash. Here rather than per adapter, so a custom source
 * cannot silently emit relative links.
 */
export async function getSourcePage(route: string, event: H3Event): Promise<AgentPage | null> {
  const page = await source?.get(route, event)
  if (!page) {
    return null
  }
  return { ...page, markdown: absolutizeMarkdownLinks(page.markdown, getAgentSiteUrl(event)) }
}

/** The generated landing page in the shape `getSourcePage` returns, for an adapter with no `/` entry. */
export async function generatedIndexPage(event: H3Event): Promise<AgentPage> {
  const index = await generatedIndex(event, getAgentSiteUrl(event))
  return { title: index.title, description: index.description, markdown: index.markdown }
}

/**
 * The `/` body with the discovery resources appended, shared by `getAgentDocument`
 * and the `llms-full.txt` builder so the homepage reads identically wherever it is
 * served. An empty body stays empty, and a body already carrying the heading is
 * left alone: a homepage rendering the registry by hand is not listed twice.
 */
export function appendAgentResources(event: H3Event, markdown: string): string {
  if (!markdown.trim() || hasAgentResourcesHeading(markdown)) {
    return markdown
  }
  const resources = renderAgentResources(event)
  return resources ? `${markdown.replace(/\n*$/, '\n\n')}${resources}` : markdown
}

// CommonMark: up to three spaces of indentation on a heading or a fence, four make
// an indented code block. A closing `#` run needs a space before it.
const AGENT_RESOURCES_HEADING_LINE = new RegExp(`^ {0,3}#{1,6}[ \\t]+${AGENT_RESOURCES_HEADING}(?:[ \\t]+#+)?[ \\t]*$`)
const CODE_FENCE = /^ {0,3}(`{3,}|~{3,})/
// A closing fence carries no info string, so a line opening a fence of the same
// kind inside a block is content, not its end.
const CLOSING_CODE_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/

/** Whether the body carries the heading outside a fenced code block: a page quoting it has not rendered it. */
function hasAgentResourcesHeading(markdown: string): boolean {
  let fence: string | undefined
  for (const line of markdown.split(/\r?\n/)) {
    if (fence) {
      const closing = CLOSING_CODE_FENCE.exec(line)?.[1]
      if (closing && closing[0] === fence[0] && closing.length >= fence.length) {
        fence = undefined
      }
      continue
    }
    const opening = CODE_FENCE.exec(line)
    // A backtick fence's info string may not contain a backtick, a tilde fence's may.
    if (opening && !(opening[1]!.startsWith('`') && line.slice(opening[0].length).includes('`'))) {
      fence = opening[1]
      continue
    }
    if (AGENT_RESOURCES_HEADING_LINE.test(line)) {
      return true
    }
  }
  return false
}

/**
 * Resolves a page route to the exact document `/raw/<path>.md` serves. The HTTP
 * route is a thin shell over this, so an MCP `get-page` tool returns the same
 * bytes as the URL without `$fetch`ing the site from inside its own function.
 *
 * Returns `null` for a route with no markdown representation. `redirect` names a
 * section rather than a page, where the section's first document is the answer.
 */
export async function getAgentDocument(event: H3Event, route: string, options: AgentDocumentOptions = {}): Promise<AgentDocument | { redirect: string } | null> {
  const config = useAgentDiscoveryConfig(event)

  const path = normalizeAgentRoute(route)

  // Exclusion is the module-wide definition of "not a page", not an indexing hint,
  // so the raw route 404s wherever the listings say the page does not exist.
  if (!options.includeExcluded && isExcluded(path, config)) {
    return null
  }

  const siteUrl = getAgentSiteUrl(event)
  // Re-encoded because `normalizeAgentRoute` decoded the path above, and a `Link`
  // header rejects anything above U+00FF. Per segment, since `encodeURI` leaves a
  // `#` or `?` in a slug alone and either one cuts the URL short.
  const canonicalUrl = `${siteUrl}${path === '/' ? '' : encodeAgentRoute(path)}`

  const page = await getSourcePage(path, event)
  if (!page) {
    // A path naming a section rather than a page resolves to its first document,
    // the same as the HTML page does. `/` falls through to the generated index.
    const leaf = path === '/' ? null : await source?.firstLeaf?.(path, event)
    if (leaf && leaf !== path) {
      return { redirect: leaf }
    }
    if (path !== '/') {
      return null
    }
  }

  const index = page ? undefined : await generatedIndex(event, siteUrl)

  // An empty title or description is left out rather than emitted as `""`.
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

  const sitemap = config.links.some(link => link.href === '/sitemap.md')
    ? `\n\n## Sitemap\n\nSee the full [sitemap](${siteUrl}/sitemap.md) for all pages.\n`
    : '\n'

  const body = path === '/' ? appendAgentResources(event, page!.markdown) : page!.markdown
  const markdown = frontmatter + body + sitemap

  return {
    markdown: options.sections?.length ? extractSections(markdown, options.sections) : markdown,
    title,
    description,
    canonicalUrl
  }
}
