import { defineEventHandler } from 'nuxt/server'
import { sitemapMarkdown } from '../utils/sitemap-markdown'

/** Markdown index of every page, on `nuxt/server`. The document is built in `sitemapMarkdown()`. */
export default defineEventHandler(async (event) => {
  const { body, headers } = await sitemapMarkdown(event)
  for (const [name, value] of Object.entries(headers)) {
    event.res.headers.set(name, value)
  }
  return body
})
