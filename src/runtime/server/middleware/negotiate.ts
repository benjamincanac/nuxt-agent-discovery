import { appendResponseHeader, createError, defineEventHandler, getRequestHeader, sendRedirect, setResponseHeader, setResponseStatus } from 'h3'
import { useNitroApp } from 'nitropack/runtime'
import { useAgentDiscoveryConfig } from '../utils/agent-discovery'
import { isNegotiablePath, negotiatedRawPath, normalizePathname, notAcceptable, prerenderTwin, ruleMatchesPath, MARKDOWN_VARY } from '../../shared/negotiation'

/**
 * Serves markdown through content negotiation on the Nitro server. On Vercel
 * the same negotiation happens at the edge, so this covers dev and the other
 * presets, where those rewrites don't exist.
 *
 * Nitro serves prerendered files ahead of user handlers, so on a built Node
 * server only `.md` URLs and never-prerendered pages reach here.
 */
export default defineEventHandler(async (event) => {
  if (import.meta.prerender) {
    // The crawler cannot find a page's twin on its own: `.md` links are not
    // followed. Encoded the way `prerenderRoutes()` does, since Nitro splits
    // the header on commas and decodes each part.
    const twin = prerenderTwin(useAgentDiscoveryConfig(event), event.path)
    if (twin) {
      appendResponseHeader(event, 'x-nitro-prerender', encodeURIComponent(twin))
    }
    return
  }

  if (event.method !== 'GET' && event.method !== 'HEAD') {
    return
  }

  const config = useAgentDiscoveryConfig(event)

  const accept = getRequestHeader(event, 'accept')
  const userAgent = getRequestHeader(event, 'user-agent')

  const rawPath = negotiatedRawPath(config, event.path, { accept, userAgent })

  if (!rawPath) {
    // A shared cache storing the HTML half without `Vary` would replay it to an
    // agent asking for markdown. Not a `routeRules` header, since a route rule
    // has no negative pattern and a catch-all would label every asset too.
    if (isNegotiablePath(config, event.path)) {
      setResponseHeader(event, 'Vary', MARKDOWN_VARY)
    }

    // Nothing to serve when neither representation is acceptable. The error
    // handler renders the body.
    if (notAcceptable(config, {
      method: event.method,
      path: event.path,
      accept,
      userAgent,
      secFetchMode: getRequestHeader(event, 'sec-fetch-mode')
    })) {
      throw createError({ statusCode: 406, statusMessage: 'Not Acceptable' })
    }

    return
  }

  // A cached response cannot vary on Accept/User-Agent, so in production a
  // negotiated page is redirected to its raw twin the way the CDN routes do.
  // An explicit `.md` URL has one variant, so its cache entry is safe.
  const pathname = normalizePathname(event.path)
  if (!import.meta.dev && !pathname.endsWith('.md')
    && config.cachedRoutes.some(rule => ruleMatchesPath(rule, pathname))) {
    const index = event.path.indexOf('?')
    setResponseHeader(event, 'Vary', MARKDOWN_VARY)
    return sendRedirect(event, index === -1 ? rawPath : `${rawPath}${event.path.slice(index)}`, 307)
  }

  // Host headers forwarded so the raw handler resolves the same site URL.
  const headers: Record<string, string> = { accept: 'text/markdown' }
  for (const name of ['host', 'x-forwarded-host', 'x-forwarded-proto']) {
    const value = getRequestHeader(event, name)
    if (value) {
      headers[name] = value
    }
  }

  // The query rides along, since a source's pages can depend on it.
  const queryIndex = event.path.indexOf('?')
  const response = await useNitroApp().localFetch(
    queryIndex === -1 ? rawPath : `${rawPath}${event.path.slice(queryIndex)}`,
    { headers }
  )

  // Rethrown so the status lands on the path the client asked for, keeping the
  // `Cache-Control: no-cache` that goes with it.
  if (response.status >= 500) {
    throw createError({ statusCode: response.status, statusMessage: response.statusText })
  }

  // The raw route redirects a section path to its first document, so the status
  // alone would hand the client a 3xx with no `Location` to follow.
  const location = response.headers.get('location')
  if (response.status >= 300 && response.status < 400 && location) {
    setResponseHeader(event, 'Vary', MARKDOWN_VARY)
    return sendRedirect(event, location, response.status)
  }

  setResponseStatus(event, response.status)
  setResponseHeader(event, 'Content-Type', response.headers.get('content-type') || 'text/markdown; charset=utf-8')
  // Also on the explicit `.md` twin, which the raw route labels the same way.
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
