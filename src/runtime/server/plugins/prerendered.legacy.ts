import { decodePath } from 'ufo'
import { defineEventHandler } from 'h3'
import type { H3Event } from 'h3'
import type { NitroApp } from 'nitropack/types'
import { defineNitroPlugin, useRuntimeConfig } from 'nitropack/runtime'
import prerendered from '#agent-discovery-virtual/prerendered'
import negotiate from '../middleware/negotiate.legacy'
import { normalizePathname } from '../../shared/negotiation'

/** What Nitro 2 puts on `event.context.cloudflare` on a Cloudflare Worker. */
interface CloudflareContext {
  request?: Request
  env?: { ASSETS?: { fetch: (request: Request) => Promise<Response> } }
}

/**
 * The middleware's answer, or on a Cloudflare Worker, which has no static
 * handler to fall through to, the HTML half from the assets binding: Nitro
 * would render the page again otherwise. The `Vary` the middleware set stays.
 */
async function negotiateOrServe(event: H3Event): Promise<unknown> {
  const negotiated = await negotiate(event)
  const { request, env } = (event.context.cloudflare || {}) as CloudflareContext
  if (negotiated !== undefined || event.handled || !env?.ASSETS || !request || (event.method !== 'GET' && event.method !== 'HEAD')) {
    return negotiated
  }
  const response = await env.ASSETS.fetch(request)
  return response.status === 404 ? undefined : response
}

/**
 * Negotiates the prerendered pages on Nitro 2. `prerendered.ts` is the Nitro 3
 * twin. Nitro unshifts its static handler ahead of every server handler, so
 * the middleware never sees a page Nitro serves from disk and the page stays
 * HTML for an agent.
 */
export default defineNitroPlugin((nitroApp: NitroApp) => {
  if (import.meta.dev || import.meta.prerender || !prerendered.size) {
    return
  }

  // Mounted the way Nitro mounts middleware, so `event.path` reads below
  // `app.baseURL` as the middleware expects.
  const base = `${useRuntimeConfig().app.baseURL}/`.replace(/\/+/g, '/')
  nitroApp.h3App.use(base, defineEventHandler((event) => {
    if (prerendered.has(normalizePathname(decodePath(event.path)))) {
      return negotiateOrServe(event)
    }
  }))

  // Nitro's route rules handler always comes first and the static one right
  // after, so this lands between them: redirects and the `/` `Link` header
  // still apply, and the static handler serves the HTML half.
  const stack = nitroApp.h3App.stack
  stack.splice(1, 0, stack.pop()!)
})
