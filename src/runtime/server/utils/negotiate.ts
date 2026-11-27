import { getAgentBase, useAgentDiscoveryConfig } from './agent-discovery'
import { isNegotiablePath, negotiatedRawPath, normalizePathname, notAcceptable, pageVary, prerenderTwin, ruleMatchesPath, MARKDOWN_VARY } from '../../shared/negotiation'
import type { AgentRequestEvent } from '../../shared/types'

/**
 * The request and response API the negotiation reaches through.
 * `middleware/negotiate.legacy.ts` builds it on h3 v1, `middleware/negotiate.ts`
 * on `nuxt/server`.
 */
export interface NegotiationAdapter {
  event: AgentRequestEvent
  /** Path and query below `app.baseURL`, escapes kept. */
  path: string
  method: string
  header: (name: string) => string | undefined
  setHeader: (name: string, value: string) => void
  appendHeader: (name: string, value: string) => void
  setStatus: (status: number) => void
  redirect: (location: string, status: number) => unknown
  /** Fetches a path below `app.baseURL` from this server, sending only `headers`. */
  fetch: (path: string, headers: Record<string, string>) => Promise<Response>
  createError: (status: number, statusText: string) => Error
  /** Queues a route for the prerender crawler. */
  prerender: (route: string) => void
}

/**
 * Serves markdown through content negotiation on the Nitro server. On Vercel
 * the same negotiation happens at the edge, so this covers dev and the other
 * presets, where those rewrites don't exist.
 *
 * Returns the response body, or nothing to hand the request to the next handler.
 */
export async function negotiate(adapter: NegotiationAdapter): Promise<unknown> {
  const { event, path, method, header, setHeader } = adapter
  const config = useAgentDiscoveryConfig(event)

  if (import.meta.prerender) {
    // The crawler cannot find a page's twin on its own: `.md` links are not
    // followed.
    const twin = prerenderTwin(config, path)
    if (twin) {
      adapter.prerender(twin)
    }
    return
  }

  if (method !== 'GET' && method !== 'HEAD') {
    return
  }

  const accept = header('accept')
  const userAgent = header('user-agent')

  const rawPath = negotiatedRawPath(config, path, { accept, userAgent })

  if (!rawPath) {
    // A shared cache storing the HTML half without `Vary` would replay it to an
    // agent asking for markdown. Not a `routeRules` header, since a route rule
    // has no negative pattern and a catch-all would label every asset too.
    if (isNegotiablePath(config, path)) {
      setHeader('Vary', pageVary(config, path))
    }

    // Nothing to serve when neither representation is acceptable. The error
    // handler renders the body.
    if (notAcceptable(config, { method, path, accept, userAgent, secFetchMode: header('sec-fetch-mode') })) {
      throw adapter.createError(406, 'Not Acceptable')
    }

    return
  }

  // The query rides along, since a source's pages can depend on it.
  const queryIndex = path.indexOf('?')
  const query = queryIndex === -1 ? '' : path.slice(queryIndex)

  // A cached response cannot vary on Accept/User-Agent, so in production a
  // negotiated page is redirected to its raw twin the way the CDN routes do.
  // An explicit `.md` URL has one variant, so its cache entry is safe.
  const pathname = normalizePathname(path)
  if (!import.meta.dev && !pathname.endsWith('.md')
    && config.cachedRoutes.some(rule => ruleMatchesPath(rule, pathname))) {
    setHeader('Vary', MARKDOWN_VARY)
    // Reaching here means no CDN route answered, so this redirect is about to
    // enter the very cache it exists to avoid, stored under the path alone and
    // replayed to browsers. The label is for the caches that read it: a shared
    // cache in front of another preset, and the client. It is not a guard on
    // Vercel, where a route backed by a prerender function stores on its own
    // expiration and hands this same response back on a `HIT` (measured on a
    // preview, 2026-09-09). The Build Output routes are what keep a cached page
    // off this branch, see `vercelMarkdownRoutes`.
    setHeader('Cache-Control', 'private, no-store')
    return adapter.redirect(`${getAgentBase(event)}${rawPath}${query}`, 307)
  }

  // Host headers forwarded so the raw handler resolves the same site URL.
  const headers: Record<string, string> = { accept: 'text/markdown' }
  for (const name of ['host', 'x-forwarded-host', 'x-forwarded-proto']) {
    const value = header(name)
    if (value) {
      headers[name] = value
    }
  }

  const response = await adapter.fetch(`${rawPath}${query}`, headers)

  // Rethrown so the status lands on the path the client asked for, keeping the
  // `Cache-Control: no-cache` that goes with it.
  if (response.status >= 500) {
    throw adapter.createError(response.status, response.statusText)
  }

  // The raw route redirects a section path to its first document, so the status
  // alone would hand the client a 3xx with no `Location` to follow.
  const location = response.headers.get('location')
  if (response.status >= 300 && response.status < 400 && location) {
    setHeader('Vary', MARKDOWN_VARY)
    return adapter.redirect(location, response.status)
  }

  adapter.setStatus(response.status)
  setHeader('Content-Type', response.headers.get('content-type') || 'text/markdown; charset=utf-8')
  // Also on the explicit `.md` twin, which the raw route labels the same way.
  setHeader('Vary', MARKDOWN_VARY)

  for (const name of ['cache-control', 'x-content-type-options', 'x-frame-options', 'referrer-policy']) {
    const value = response.headers.get(name)
    if (value) {
      setHeader(name, value)
    }
  }

  // Keep the canonical/alternate links the raw handler set on this response.
  const link = response.headers.get('link')
  if (link) {
    adapter.appendHeader('Link', link)
  }

  return await response.text()
}
