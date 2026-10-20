import { defineEventHandler } from 'nuxt/server'
import { robotsTxt } from '../utils/robots'

/** Generated `robots.txt`, on `nuxt/server`. The document is built in `robotsTxt()`. */
export default defineEventHandler((event) => {
  const { body, headers } = robotsTxt(event)
  for (const [name, value] of Object.entries(headers)) {
    event.res.headers.set(name, value)
  }
  return body
})
