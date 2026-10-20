import { createError, defineEventHandler, getRequestHeader, sendRedirect, serverFetch, setResponseStatus } from 'nuxt/server'
import { useAgentDiscoveryConfig } from '../utils/agent-discovery'
import { isNegotiablePath, negotiatedRawPath, normalizePathname, notAcceptable, prerenderTwin, ruleMatchesPath, MARKDOWN_VARY } from '../../shared/negotiation'

/**
 * Serves markdown through content negotiation on the Nitro server, through
 * `nuxt/server`. `negotiate.legacy.ts` is the Nitro 2 twin. On Vercel the same
 * negotiation happens at the edge, so this covers dev and the other presets,
 * where those rewrites don't exist.
 *
 * Nitro serves prerendered files ahead of user handlers, so on a built Node
 * server only `.md` URLs and never-prerendered pages reach here.
 */
export default defineEventHandler(async (event) => {
  const path = event.url.pathname + event.url.search

  if (import.meta.prerender) {
    // The crawler cannot find a page's twin on its own: `.md` links are not
    // followed. Queued the way Nuxt's `prerenderRoutes()` does, on the context
    // the renderer turns into its `x-nitro-prerender` header. A header set
    // here would replace the renderer's own hints, `_payload.json` among them.
    const twin = prerenderTwin(useAgentDiscoveryConfig(event), path)
    if (twin) {
      const context = event.context as { nuxt?: { prerenderRoutes?: string[] } }
      const nuxt = context.nuxt ||= {}
      nuxt.prerenderRoutes ||= []
      nuxt.prerenderRoutes.push(twin)
    }
    return
  }

  const method = event.req.method
  if (method !== 'GET' && method !== 'HEAD') {
    return
  }

  const config = useAgentDiscoveryConfig(event)

  const accept = getRequestHeader(event, 'accept')
  const userAgent = getRequestHeader(event, 'user-agent')

  const rawPath = negotiatedRawPath(config, path, { accept, userAgent })

  if (!rawPath) {
    // A shared cache storing the HTML half without `Vary` would replay it to an
    // agent asking for markdown. Not a `routeRules` header, since a route rule
    // has no negative pattern and a catch-all would label every asset too.
    if (isNegotiablePath(config, path)) {
      event.res.headers.set('Vary', MARKDOWN_VARY)
    }

    // Nothing to serve when neither representation is acceptable. The error
    // handler renders the body.
    if (notAcceptable(config, {
      method,
      path,
      accept,
      userAgent,
      secFetchMode: getRequestHeader(event, 'sec-fetch-mode')
    })) {
      throw createError({ status: 406, statusText: 'Not Acceptable' })
    }

    return
  }

  // A cached response cannot vary on Accept/User-Agent, so in production a
  // negotiated page is redirected to its raw twin the way the CDN routes do.
  // An explicit `.md` URL has one variant, so its cache entry is safe.
  const pathname = normalizePathname(path)
  if (!import.meta.dev && !pathname.endsWith('.md')
    && config.cachedRoutes.some(rule => ruleMatchesPath(rule, pathname))) {
    event.res.headers.set('Vary', MARKDOWN_VARY)
    // Reaching here means no CDN route answered, so this redirect is about to
    // enter the very cache it exists to avoid, stored under the path alone and
    // replayed to browsers. The label is for the caches that read it: a shared
    // cache in front of another preset, and the client. It is not a guard on
    // Vercel, where a route backed by a prerender function stores on its own
    // expiration and hands this same response back on a `HIT` (measured on a
    // preview, 2026-09-09). The Build Output routes are what keep a cached page
    // off this branch, see `vercelMarkdownRoutes`.
    event.res.headers.set('Cache-Control', 'private, no-store')
    return sendRedirect(event, `${rawPath}${event.url.search}`, 307)
  }

  // Host headers forwarded so the raw handler resolves the same site URL.
  const headers: Record<string, string> = { accept: 'text/markdown' }
  for (const name of ['host', 'x-forwarded-host', 'x-forwarded-proto']) {
    const value = getRequestHeader(event, name)
    if (value) {
      headers[name] = value
    }
  }

  // The query rides along, since a source's pages can depend on it. Nothing
  // else is forwarded, as with Nitro 2's `localFetch`.
  const response: Response = await serverFetch(event, `${rawPath}${event.url.search}` as never, { headers, forwardHeaders: false })

  // Rethrown so the status lands on the path the client asked for, keeping the
  // `Cache-Control: no-cache` that goes with it.
  if (response.status >= 500) {
    throw createError({ status: response.status, statusText: response.statusText })
  }

  // The raw route redirects a section path to its first document, so the status
  // alone would hand the client a 3xx with no `Location` to follow.
  const location = response.headers.get('location')
  if (response.status >= 300 && response.status < 400 && location) {
    event.res.headers.set('Vary', MARKDOWN_VARY)
    return sendRedirect(event, location, response.status)
  }

  setResponseStatus(event, response.status)
  event.res.headers.set('Content-Type', response.headers.get('content-type') || 'text/markdown; charset=utf-8')
  // Also on the explicit `.md` twin, which the raw route labels the same way.
  event.res.headers.set('Vary', MARKDOWN_VARY)

  for (const name of ['cache-control', 'x-content-type-options', 'x-frame-options', 'referrer-policy']) {
    const value = response.headers.get(name)
    if (value) {
      event.res.headers.set(name, value)
    }
  }

  // Keep the canonical/alternate links the raw handler set on this response.
  const link = response.headers.get('link')
  if (link) {
    event.res.headers.append('Link', link)
  }

  return await response.text()
})
