import { createError, defineEventHandler, getRequestHeader, sendRedirect, serverFetch, setResponseStatus } from 'nuxt/server'
import { negotiate } from '../utils/negotiate'
import { getRequestPath } from '../utils/server'

/**
 * Content negotiation on `nuxt/server`. `negotiate()` decides, this is the
 * h3 v2 side of it. `negotiate.legacy.ts` is the Nitro 2 twin.
 *
 * Nitro serves prerendered files ahead of user handlers, so for those pages
 * `plugins/prerendered` runs this ahead of the static handler as well.
 */
export default defineEventHandler(event => negotiate({
  event,
  path: getRequestPath(event),
  method: event.req.method,
  header: name => getRequestHeader(event, name),
  setHeader: (name, value) => event.res.headers.set(name, value),
  appendHeader: (name, value) => event.res.headers.append(name, value),
  setStatus: status => setResponseStatus(event, status),
  redirect: (location, status) => sendRedirect(event, location, status),
  // Nothing else is forwarded, as with Nitro 2's `localFetch`. The path stays
  // below `app.baseURL`, since `serverFetch` puts the base on it itself.
  fetch: (path, headers) => serverFetch(event, path as never, { headers, forwardHeaders: false }) as Promise<Response>,
  createError: (status, statusText) => createError({ status, statusText }),
  // Queued the way Nuxt's `prerenderRoutes()` does, on the context the renderer
  // turns into its `x-nitro-prerender` header. A header set here would replace
  // the renderer's own hints, `_payload.json` among them.
  prerender: (route) => {
    const context = event.context as { nuxt?: { prerenderRoutes?: string[] } }
    const nuxt = context.nuxt ||= {}
    nuxt.prerenderRoutes ||= []
    nuxt.prerenderRoutes.push(route)
  }
}))
