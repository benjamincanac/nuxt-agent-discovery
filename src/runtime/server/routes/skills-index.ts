import { defineEventHandler } from 'nuxt/server'
import { skillsIndex } from '../utils/skills'

/** The Agent Skills catalog, on `nuxt/server`. */
export default defineEventHandler((event) => {
  const { body, headers } = skillsIndex(event)
  for (const [name, value] of Object.entries(headers)) {
    event.res.headers.set(name, value)
  }
  return body
})
