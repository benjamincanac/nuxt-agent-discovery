import { defineEventHandler, setResponseHeaders } from 'h3'
import { apiCatalog } from '../utils/api-catalog'

/** RFC 9727 api-catalog, on Nitro 2. The document is built in `apiCatalog()`. */
export default defineEventHandler((event) => {
  const { body, headers } = apiCatalog(event)
  setResponseHeaders(event, headers)
  return body
})
