import { defineEventHandler } from 'nuxt/server'
import { apiCatalog } from '../utils/api-catalog'

/** RFC 9727 api-catalog, on `nuxt/server`. The document is built in `apiCatalog()`. */
export default defineEventHandler((event) => {
  const { body, headers } = apiCatalog(event)
  for (const [name, value] of Object.entries(headers)) {
    event.res.headers.set(name, value)
  }
  return body
})
