import { createError, defineEventHandler, sendRedirect, setResponseHeader } from 'h3'
import source from '#agent-discovery/source'
import { useAgentDiscoveryConfig } from '../utils/agent-discovery'
import { getAgentDocument } from '../utils/document'
import { encodeAgentRoute, formatLinkHeader, hasCdnLinkPair, normalizePathname, MARKDOWN_VARY } from '../../shared/negotiation'

/**
 * Serves the raw markdown representation of a page. `getAgentDocument()` builds
 * the document, this handler is the HTTP part.
 *
 * `Vary` is on every response, redirects included: a negotiated page redirects
 * here, so this is the response the client keeps and a shared cache stores.
 */
export default defineEventHandler(async (event) => {
  const config = useAgentDiscoveryConfig(event)
  const pathname = normalizePathname(event.path)
  const slug = pathname.slice(config.rawPrefix.length)

  if (!source || !slug.endsWith('.md')) {
    throw createError({ statusCode: 404, statusMessage: 'Page Not Found', data: { path: event.path } })
  }

  // Left unnormalized: `getAgentDocument` owns that, and decoding here as well
  // would decode a doubly-encoded path twice.
  const path = slug.slice(0, -3)
  const document = await getAgentDocument(event, path)

  if (!document) {
    throw createError({ statusCode: 404, statusMessage: 'Page Not Found', data: { path } })
  }

  setResponseHeader(event, 'Vary', MARKDOWN_VARY)

  // Without a configured site URL the body embeds the request origin, so it
  // must not enter a shared cache.
  if (!config.siteUrl) {
    setResponseHeader(event, 'Cache-Control', 'no-cache')
  }

  if ('redirect' in document) {
    return sendRedirect(event, `${config.rawPrefix}${encodeAgentRoute(document.redirect)}.md`, 302)
  }

  setResponseHeader(event, 'Content-Type', 'text/markdown; charset=utf-8')

  // On Vercel the CDN header table already injects this pair on the twins it
  // covers, origin-rendered responses included, so setting it here would ship
  // it twice. Everywhere else this handler is the only source.
  if (!(config.cdnLinkPairs && hasCdnLinkPair(config, pathname))) {
    setResponseHeader(event, 'Link', formatLinkHeader([
      { href: document.canonicalUrl, rel: 'canonical' },
      { href: document.canonicalUrl, rel: 'alternate', type: 'text/html' }
    ]))
  }

  return document.markdown
})
