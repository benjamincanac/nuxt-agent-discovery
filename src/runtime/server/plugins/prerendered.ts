import { decodePath } from 'ufo'
import { definePlugin } from 'nitro'
import prerendered from '#agent-discovery-virtual/prerendered'
import negotiate from '../middleware/negotiate'
import { getRequestPath } from '../utils/server'
import { normalizePathname } from '../../shared/negotiation'
import type { AgentWebRequestEvent } from '../../shared/types'

/** An h3 v2 middleware, spelled out since `h3` resolves to v1 for the type-check. */
type Middleware = ((event: AgentWebRequestEvent) => unknown) & { __traced__?: boolean }

/** What Nitro 3 puts on the request on a Cloudflare Worker. */
interface CloudflareRequest extends Request {
  runtime?: { cloudflare?: { env?: { ASSETS?: { fetch: (request: Request) => Promise<Response> } } } }
}

/**
 * The middleware's answer, or on a Cloudflare Worker, which has no static
 * handler to fall through to, the HTML half from the assets binding: Nitro
 * would render the page again otherwise. h3 merges the `Vary` the middleware
 * set into that response.
 */
async function negotiateOrServe(event: AgentWebRequestEvent): Promise<unknown> {
  const negotiated = await (negotiate as unknown as Middleware)(event)
  const request = event.req as CloudflareRequest
  const assets = request.runtime?.cloudflare?.env?.ASSETS
  if (negotiated !== undefined || !assets || (request.method !== 'GET' && request.method !== 'HEAD')) {
    return negotiated
  }
  const response = await assets.fetch(request)
  return response.status === 404 ? undefined : response
}

/**
 * Negotiates the prerendered pages on Nitro 3. `prerendered.legacy.ts` is the
 * Nitro 2 twin. Nitro puts its static handler first among the global
 * middleware, so the middleware never sees a page Nitro serves from disk and
 * the page stays HTML for an agent.
 */
export default definePlugin((nitroApp) => {
  if (import.meta.dev || import.meta.prerender || !prerendered.size || !nitroApp.h3) {
    return
  }

  const middleware: Middleware = (event) => {
    if (prerendered.has(normalizePathname(decodePath(getRequestPath(event))))) {
      return negotiateOrServe(event)
    }
  }

  // Nitro's own route rules middleware is marked `__traced__` and comes first,
  // the static handler right after it. Landing between them keeps redirects
  // and the `/` `Link` header. Nitro drops the composed chain once the plugins
  // have run, so the change takes.
  const stack = nitroApp.h3['~middleware'] as unknown as Middleware[]
  const index = stack.findIndex(entry => !entry.__traced__)
  stack.splice(index === -1 ? stack.length : index, 0, middleware)
})
