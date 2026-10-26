import { decodePath } from 'ufo'
import { defineEventHandler } from 'h3'
import type { NitroApp } from 'nitropack/types'
import { defineNitroPlugin, useRuntimeConfig } from 'nitropack/runtime'
import prerendered from '#agent-discovery-virtual/prerendered'
import negotiate from '../middleware/negotiate.legacy'
import { normalizePathname } from '../../shared/negotiation'

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
      return negotiate(event)
    }
  }))

  // Nitro's route rules handler always comes first and the static one right
  // after, so this lands between them: redirects and the `/` `Link` header
  // still apply, and the static handler serves the HTML half.
  const stack = nitroApp.h3App.stack
  stack.splice(1, 0, stack.pop()!)
})
