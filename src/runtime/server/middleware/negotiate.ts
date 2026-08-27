import { appendResponseHeader, createError, defineEventHandler, getRequestHeader, sendRedirect, setResponseHeader, setResponseStatus } from 'h3'
import { useNitroApp } from 'nitropack/runtime'
import { useAgentDiscoveryConfig } from '../utils/agent-discovery'
import { isNegotiablePath, negotiatedRawPath, normalizePathname, notAcceptable, ruleMatchesPath, MARKDOWN_VARY } from '../../shared/negotiation'

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

  const accept = getRequestHeader(event, 'accept')
  const userAgent = getRequestHeader(event, 'user-agent')

  const rawPath = negotiatedRawPath(config, event.path, { accept, userAgent })

  if (!rawPath) {
    // The HTML half of a page that has both representations. Its markdown half
    // is labelled further down, and a shared cache that stored this one without
    // `Vary` would replay the HTML to an agent asking for markdown.
    //
    // Set here rather than through a `routeRules` header: a route rule cannot
    // express a negative pattern, so a catch-all pattern labelled every asset,
    // every discovery document and the whole API surface as varying.
    if (isNegotiablePath(config, event.path)) {
      setResponseHeader(event, 'Vary', MARKDOWN_VARY)
    }

    // Those two representations are all there is, so an `Accept` allowing
    // neither has nothing to be served. Opt-in through `notAcceptable`, and
    // guarded there against everything that sends a narrow `Accept` without
    // meaning it. The error handler renders the body, listing what the page
    // does have.
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
  if (!import.meta.dev && !pathname.endsWith('.md')
    && config.cachedRoutes.some(rule => ruleMatchesPath(rule, pathname))) {
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

  // The query rides along: the CDN re-attaches it to a rewrite destination for
  // free, and the redirect branch above does it by hand, so a source whose
  // pages depend on the query has to see it here too.
  const queryIndex = event.path.indexOf('?')
  const response = await useNitroApp().localFetch(
    queryIndex === -1 ? rawPath : `${rawPath}${event.path.slice(queryIndex)}`,
    { headers }
  )

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
  // The markdown half of a page that also has an HTML one, and the explicit
  // `.md` twin that reaches here too. That URL serves markdown to every client,
  // so nothing about it depends on the request, but it is where a negotiated
  // page sends one, and the raw route it proxies labels its own responses the
  // same way. Leaving it off here made the twin the one URL in the chain whose
  // answer differed by preset.
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
