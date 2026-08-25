import { appendResponseHeader, createError, defineEventHandler, getRequestHeader, setResponseHeader, setResponseStatus } from 'h3'
import { useNitroApp } from 'nitropack/runtime'
import { useAgentDiscoveryConfig } from '../utils/agent-discovery'
import { matchRoute, negotiatedRawPath, MARKDOWN_VARY } from '../../shared/negotiation'

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

  // A cached response cannot vary on Accept/User-Agent: leave those routes to
  // the CDN-level rewrites, which run before the cache.
  if (config.cachedRoutes.length && matchRoute(config.cachedRoutes.map(path => ({ path })), event.path.split('?')[0]!)) {
    return
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
