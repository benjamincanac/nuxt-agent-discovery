import type { H3Event } from 'h3'
import { createError, defineEventHandler, sendRedirect, setResponseHeader } from 'h3'
import { useNitroApp } from 'nitropack/runtime'
import source from '#agent-discovery/source'
import { getAgentSiteUrl, renderAgentResources, useAgentDiscoveryConfig } from '../utils/agent-discovery'
import { normalizePathname } from '../../shared/negotiation'
import type { AgentIndex } from '../../shared/types'

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
 * Serves the raw markdown representation of a page from the content adapter.
 *
 * A missing page has to answer a real 404 so agents can tell an unknown URL
 * from an empty one. The error handler renders it as markdown for the raw
 * prefix, reporting the documentation path the client asked for through
 * `data.path`.
 */
export default defineEventHandler(async (event) => {
  const config = useAgentDiscoveryConfig(event)
  const pathname = normalizePathname(event.path)
  const slug = pathname.slice(config.rawPrefix.length)

  if (!source || !slug.endsWith('.md')) {
    throw createError({ statusCode: 404, statusMessage: 'Page Not Found', data: { path: event.path } })
  }

  let path = slug.slice(0, -3)
  if (path.endsWith('/index')) {
    path = path.slice(0, -6) || '/'
  }
  if (path === '/index' || path === '') {
    path = '/'
  }

  const siteUrl = getAgentSiteUrl(event)
  const canonicalUrl = `${siteUrl}${path === '/' ? '' : path}` || siteUrl

  const page = await source.get(path, event)
  if (!page) {
    // A path that names a section rather than a page (`/getting-started` with
    // no index) redirects to the section's first document, the same as the
    // HTML page does. Anything else is a genuine 404.
    const leaf = path === '/' ? null : await source.firstLeaf?.(path, event)
    if (leaf && leaf !== path) {
      return sendRedirect(event, `${config.rawPrefix}${leaf}.md`, 302)
    }
    if (path !== '/') {
      throw createError({ statusCode: 404, statusMessage: 'Page Not Found', data: { path } })
    }
  }

  setResponseHeader(event, 'Content-Type', 'text/markdown; charset=utf-8')
  setResponseHeader(event, 'Link', `<${canonicalUrl}>; rel="canonical", <${canonicalUrl}>; rel="alternate"; type="text/html"`)

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
    return frontmatter + index.markdown
  }

  // Absolute, like the links inside the body: this file is read detached from
  // the site.
  const sitemap = config.links.some(link => link.href === '/sitemap.md')
    ? `\n\n## Sitemap\n\nSee the full [sitemap](${siteUrl}/sitemap.md) for all pages.\n`
    : '\n'
  return frontmatter + page!.markdown + sitemap
})
