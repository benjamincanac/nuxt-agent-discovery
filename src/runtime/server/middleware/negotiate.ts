import { appendResponseHeader, createError, defineEventHandler, getRequestHeader, sendRedirect, setResponseHeader, setResponseStatus } from 'h3'
import { useNitroApp } from 'nitropack/runtime'
import { useAgentDiscoveryConfig } from '../utils/agent-discovery'
import { matchRoute, negotiatedRawPath, normalizePathname, MARKDOWN_VARY } from '../../shared/negotiation'

/**
 * Serves markdown through content negotiation on the Nitro server.
 *
 * In production on Vercel the same negotiation happens at the edge, before
 * the filesystem is consulted. Those rewrites don't exist in dev or on other
 * presets, so this covers `.md` twin URLs, `Accept: text/markdown` and known
 * AI agents there, and answers unknown pages with the markdown 404 from the
 * raw route.
 *
 * Caveat: Nitro serves prerendered files ahead of user handlers, so on a
 * built Node server a prerendered page stays HTML while `.md` URLs and
 * never-prerendered pages come through here. In dev nothing is prerendered,
 * so every path is negotiated.
 */
export default defineEventHandler(async (event) => {
  if (import.meta.prerender) {
    return
  }

  if (event.method !== 'GET' && event.method !== 'HEAD') {
    return
  }

  const config = useAgentDiscoveryConfig(event)

  const rawPath = negotiatedRawPath(config, event.path, {
    accept: getRequestHeader(event, 'accept'),
    userAgent: getRequestHeader(event, 'user-agent')
  })

  if (!rawPath) {
    return
  }

  // A cached response cannot vary on Accept/User-Agent, so in production a
  // negotiated page is redirected to its raw twin rather than answered in
  // place, the same thing the CDN routes do. An explicit `.md` URL is not
  // negotiated (it has one variant, so its cache entry is safe) and is served
  // normally. Dev has no response cache, and a site that caches every page
  // (ISR on Vercel) would otherwise never negotiate locally.
  //
  // The query has to be re-attached by hand here. The CDN 307 gets it for
  // free, because Vercel matches a route's `src` against the pathname alone
  // and passes the incoming query on to the destination, so both paths land on
  // the same URL for a page whose content is its query.
  const pathname = normalizePathname(event.path)
  if (!import.meta.dev && !pathname.endsWith('.md') && config.cachedRoutes.length
    && matchRoute(config.cachedRoutes.map(path => ({ path })), pathname)) {
    const query = event.path.slice(event.path.indexOf('?') + 1)
    setResponseHeader(event, 'Vary', MARKDOWN_VARY)
    return sendRedirect(event, event.path.includes('?') ? `${rawPath}?${query}` : rawPath, 307)
  }

  // Forward the host headers so the raw handler resolves the same site URL
  // as the outer request.
  const headers: Record<string, string> = { accept: 'text/markdown' }
  for (const name of ['host', 'x-forwarded-host', 'x-forwarded-proto']) {
    const value = getRequestHeader(event, name)
    if (value) {
      headers[name] = value
    }
  }

  const response = await useNitroApp().localFetch(rawPath, { headers })

  // The inner request has already handled and logged the original failure
  // against the raw path; rethrowing reports the status on the path the
  // client asked for and keeps its `Cache-Control: no-cache`.
  if (response.status >= 500) {
    throw createError({ statusCode: response.status, statusMessage: response.statusText })
  }

  // The raw route redirects a section path to its first document. Replaying the
  // status alone would hand the client a 3xx with no `Location` to follow.
  const location = response.headers.get('location')
  if (response.status >= 300 && response.status < 400 && location) {
    setResponseHeader(event, 'Vary', MARKDOWN_VARY)
    return sendRedirect(event, location, response.status)
  }

  setResponseStatus(event, response.status)
  setResponseHeader(event, 'Content-Type', response.headers.get('content-type') || 'text/markdown; charset=utf-8')
  setResponseHeader(event, 'Vary', MARKDOWN_VARY)

  for (const name of ['cache-control', 'x-content-type-options', 'x-frame-options', 'referrer-policy']) {
    const value = response.headers.get(name)
    if (value) {
      setResponseHeader(event, name, value)
    }
  }

  // Keep the canonical/alternate links the raw handler set on this response.
  const link = response.headers.get('link')
  if (link) {
    appendResponseHeader(event, 'Link', link)
  }

  return await response.text()
})
