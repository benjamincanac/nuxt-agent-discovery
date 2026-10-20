import { defineErrorHandler } from 'nitro'
import { getRequestHeader } from 'nuxt/server'
import { getAgentSiteUrl, useAgentDiscoveryConfig } from './utils/agent-discovery'
import { errorMarkdown, prefersMarkdownError, MARKDOWN_VARY } from '../shared/negotiation'

/**
 * Answers errors with a short markdown body when the client is asking for
 * markdown, on Nitro 3. `error.legacy.ts` is the Nitro 2 twin.
 *
 * Registered ahead of Nuxt's HTML error handler through the `nitro:config`
 * hook. Returning nothing hands the error to the next handler in the chain.
 * Nitro 2 also skipped a response already sent and Nuxt's error page request.
 * Nitro 3 has no sent state, and Nuxt only renders its error page for an error
 * this handler passed on.
 */
export default defineErrorHandler(async (error, event, { defaultHandler }) => {
  const config = useAgentDiscoveryConfig(event)
  const path = event.url.pathname + event.url.search

  if (!prefersMarkdownError(config, {
    method: event.req.method,
    path,
    accept: getRequestHeader(event, 'accept'),
    userAgent: getRequestHeader(event, 'user-agent'),
    secFetchMode: getRequestHeader(event, 'sec-fetch-mode')
  })) {
    return
  }

  // The default handler logs the error, sets the status and computes the
  // hardening headers. Nuxt's HTML handler goes through it too.
  const res = await defaultHandler(error, event, { json: true })
  const status = res.status || error.status || 500

  // The headers set before the error, then the default handler's own, minus
  // its JSON content type. Nitro 2 kept both on the response it wrote.
  const headers = new Headers(event.res.headers)
  for (const [name, value] of new Headers(res.headers)) {
    if (name !== 'content-type') {
      headers.set(name, value)
    }
  }
  headers.set('Content-Type', 'text/markdown; charset=utf-8')
  headers.set('Vary', MARKDOWN_VARY)
  headers.set('Cache-Control', 'no-cache')

  // A route can report the path the client asked for through `data.path`.
  const data = error.data as { path?: unknown } | undefined

  return new Response(errorMarkdown(config, {
    path: typeof data?.path === 'string' ? data.path : path,
    status,
    // Nitro returns the status message verbatim, so `errorMarkdown` strips it.
    statusMessage: res.statusText,
    siteUrl: getAgentSiteUrl(event)
  }), { status, statusText: res.statusText, headers })
})
