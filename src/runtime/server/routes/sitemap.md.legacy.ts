import { defineEventHandler, setResponseHeaders } from 'h3'
import { sitemapMarkdown } from '../utils/sitemap-markdown'
import { assertDocumentMethod } from '../utils/server.legacy'

/** Markdown index of every page, on Nitro 2. The document is built in `sitemapMarkdown()`. */
export default defineEventHandler(async (event) => {
  assertDocumentMethod(event)
  const { body, headers } = await sitemapMarkdown(event)
  setResponseHeaders(event, headers)
  return body
})
