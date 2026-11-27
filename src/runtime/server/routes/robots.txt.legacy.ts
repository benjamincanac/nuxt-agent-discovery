import { defineEventHandler, setResponseHeaders } from 'h3'
import { robotsTxt } from '../utils/robots'
import { assertDocumentMethod } from '../utils/server.legacy'

/** Generated `robots.txt`, on Nitro 2. The document is built in `robotsTxt()`. */
export default defineEventHandler((event) => {
  assertDocumentMethod(event)
  const { body, headers } = robotsTxt(event)
  setResponseHeaders(event, headers)
  return body
})
