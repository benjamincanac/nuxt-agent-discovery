import { createError, defineEventHandler, setResponseHeader } from 'h3'
import source from '#agent-discovery/source'
import { getAgentSiteUrl, useAgentDiscoveryConfig } from '../utils/agent-discovery'
import { normalizePathname } from '../../shared/negotiation'

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

  const page = await source.get(path, event)
  if (!page) {
    throw createError({ statusCode: 404, statusMessage: 'Page Not Found', data: { path } })
  }

  const siteUrl = getAgentSiteUrl(event)
  const canonicalUrl = `${siteUrl}${path === '/' ? '' : path}` || siteUrl
  const frontmatter = [
    '---',
    `title: ${JSON.stringify(page.title || '')}`,
    `description: ${JSON.stringify(page.description || '')}`,
    `canonical_url: ${JSON.stringify(canonicalUrl)}`,
    '---',
    ''
  ].join('\n')

  setResponseHeader(event, 'Content-Type', 'text/markdown; charset=utf-8')
  setResponseHeader(event, 'Link', `<${canonicalUrl}>; rel="canonical", <${canonicalUrl}>; rel="alternate"; type="text/html"`)

  const sitemap = config.links.some(link => link.href === '/sitemap.md')
    ? '\n\n## Sitemap\n\nSee the full [sitemap](/sitemap.md) for all pages.\n'
    : '\n'
  return frontmatter + page.markdown + sitemap
})
