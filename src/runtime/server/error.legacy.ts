import type { NitroErrorHandler } from 'nitropack/types'
import { getRequestHeader, send, setResponseHeader, setResponseStatus } from 'h3'
import { getAgentSiteUrl, useAgentDiscoveryConfig } from './utils/agent-discovery'
import { errorMarkdown, prefersMarkdownError, MARKDOWN_VARY } from '../shared/negotiation'

/**
 * Answers errors with a short markdown body when the client is asking for
 * markdown.
 *
 * Registered ahead of Nuxt's HTML error handler through the `nitro:config`
 * hook. Returning without writing a response hands the error back to the chain.
 */
const errorHandler: NitroErrorHandler = async (error, event, { defaultHandler }) => {
  if (event.handled || getRequestHeader(event, 'x-nuxt-error')) {
    return
  }

  const config = useAgentDiscoveryConfig(event)

  if (!prefersMarkdownError(config, {
    method: event.method,
    path: event.path,
    accept: getRequestHeader(event, 'accept'),
    userAgent: getRequestHeader(event, 'user-agent'),
    secFetchMode: getRequestHeader(event, 'sec-fetch-mode')
  })) {
    return
  }

  // The default handler logs the error, sets the status and computes the
  // hardening headers. Nuxt's HTML handler goes through it too.
  const res = await defaultHandler(error, event, { json: true })
  const status = res.status || error.statusCode || 500

  for (const [name, value] of Object.entries(res.headers)) {
    if (name.toLowerCase() !== 'content-type') {
      setResponseHeader(event, name, value)
    }
  }

  setResponseStatus(event, status, res.statusText)
  setResponseHeader(event, 'Content-Type', 'text/markdown; charset=utf-8')
  setResponseHeader(event, 'Vary', MARKDOWN_VARY)
  setResponseHeader(event, 'Cache-Control', 'no-cache')

  // A route can report the path the client asked for through `data.path`.
  const data = error.data as { path?: unknown } | undefined

  return send(event, errorMarkdown(config, {
    path: typeof data?.path === 'string' ? data.path : event.path,
    status,
    // Nitro returns the status message verbatim, so `errorMarkdown` strips it.
    statusMessage: res.statusText,
    siteUrl: getAgentSiteUrl(event)
  }))
}

export default errorHandler
