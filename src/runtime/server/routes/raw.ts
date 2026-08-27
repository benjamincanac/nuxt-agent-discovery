import { createError, defineEventHandler, sendRedirect, setResponseHeader } from 'h3'
import source from '#agent-discovery/source'
import { useAgentDiscoveryConfig } from '../utils/agent-discovery'
import { getAgentDocument } from '../utils/document'
import { normalizePathname } from '../../shared/negotiation'

/**
 * Serves the raw markdown representation of a page from the content adapter.
 *
 * The document itself is built by `getAgentDocument()`, which anything running
 * in-process can call for the same bytes. What is left here is the HTTP part:
 * the status codes, the headers and the redirect.
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

  // Left unnormalized: `getAgentDocument` owns that, and decoding here as well
  // would decode a doubly-encoded path twice, resolving it to a different page.
  const path = slug.slice(0, -3)
  const document = await getAgentDocument(event, path)

  if (!document) {
    throw createError({ statusCode: 404, statusMessage: 'Page Not Found', data: { path } })
  }
  if ('redirect' in document) {
    return sendRedirect(event, `${config.rawPrefix}${document.redirect}.md`, 302)
  }

  setResponseHeader(event, 'Content-Type', 'text/markdown; charset=utf-8')
  setResponseHeader(event, 'Link', `<${document.canonicalUrl}>; rel="canonical", <${document.canonicalUrl}>; rel="alternate"; type="text/html"`)

  return document.markdown
})
