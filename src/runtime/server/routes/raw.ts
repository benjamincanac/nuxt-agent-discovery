import { createError, defineEventHandler, sendRedirect } from 'nuxt/server'
import source from '#agent-discovery/source'
import { getAgentBase, useAgentDiscoveryConfig } from '../utils/agent-discovery'
import { getAgentDocument } from '../utils/document'
import { getRequestPath } from '../utils/server'
import { encodeAgentRoute, formatLinkHeader, normalizePathname, MARKDOWN_VARY } from '../../shared/negotiation'

/**
 * Serves the raw markdown representation of a page, on `nuxt/server`.
 * `raw.legacy.ts` is the Nitro 2 twin, `getAgentDocument()` builds the document
 * for both.
 *
 * `Vary` is on the document and redirect responses: a negotiated page redirects
 * here, so this is the response the client keeps and a shared cache stores.
 */
export default defineEventHandler(async (event) => {
  const config = useAgentDiscoveryConfig(event)
  const path = getRequestPath(event)
  const pathname = normalizePathname(path)
  const slug = pathname.slice(config.rawPrefix.length)

  if (!source || !slug.endsWith('.md')) {
    throw createError({ status: 404, statusText: 'Page Not Found', data: { path } })
  }

  // Left unnormalized: `getAgentDocument` owns that, and decoding here as well
  // would decode a doubly-encoded path twice.
  const route = slug.slice(0, -3)
  const document = await getAgentDocument(event, route)

  if (!document) {
    throw createError({ status: 404, statusText: 'Page Not Found', data: { path: route } })
  }

  event.res.headers.set('Vary', MARKDOWN_VARY)

  // Without a configured site URL the body embeds the request origin, so it
  // must not enter a shared cache.
  if (!config.siteUrl) {
    event.res.headers.set('Cache-Control', 'no-cache')
  }

  if ('redirect' in document) {
    return sendRedirect(event, `${getAgentBase(event)}${config.rawPrefix}${encodeAgentRoute(document.redirect)}.md`, 302)
  }

  event.res.headers.set('Content-Type', 'text/markdown; charset=utf-8')

  // The Vercel table stamps the same pair on prerendered twins, in its `hit`
  // phase, so a response this handler renders never carries it twice.
  event.res.headers.set('Link', formatLinkHeader([
    { href: document.canonicalUrl, rel: 'canonical' },
    { href: document.canonicalUrl, rel: 'alternate', type: 'text/html' }
  ]))

  return document.markdown
})
