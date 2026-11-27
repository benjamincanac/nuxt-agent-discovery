import { appendResponseHeader, createError, defineEventHandler, getRequestHeader, sendRedirect, setResponseHeader, setResponseStatus } from 'h3'
import { useNitroApp } from 'nitropack/runtime'
import { getAgentBase } from '../utils/agent-discovery'
import { negotiate } from '../utils/negotiate'
import { getRequestPath } from '../utils/server.legacy'

/**
 * Content negotiation on Nitro 2. `negotiate()` decides, this is the h3 v1
 * side of it. `negotiate.ts` is the `nuxt/server` twin.
 *
 * Nitro serves prerendered files ahead of user handlers, so for those pages
 * `plugins/prerendered` runs this ahead of the static handler as well.
 */
export default defineEventHandler(event => negotiate({
  event,
  path: getRequestPath(event),
  method: event.method,
  header: name => getRequestHeader(event, name),
  setHeader: (name, value) => setResponseHeader(event, name, value),
  appendHeader: (name, value) => appendResponseHeader(event, name, value),
  setStatus: status => setResponseStatus(event, status),
  redirect: (location, status) => sendRedirect(event, location, status),
  // Nitro mounts its routes under `app.baseURL`, and `localFetch` goes through it.
  fetch: (path, headers) => useNitroApp().localFetch(`${getAgentBase(event)}${path}`, { headers }),
  createError: (status, statusText) => createError({ statusCode: status, statusMessage: statusText }),
  // Encoded the way `prerenderRoutes()` does, since Nitro splits the header on
  // commas and decodes each part.
  prerender: route => appendResponseHeader(event, 'x-nitro-prerender', encodeURIComponent(route))
}))
