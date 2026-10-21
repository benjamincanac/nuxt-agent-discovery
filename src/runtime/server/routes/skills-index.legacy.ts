import { defineEventHandler, setResponseHeaders } from 'h3'
import { skillsIndex } from '../utils/skills'

/** The Agent Skills catalog, on Nitro 2. */
export default defineEventHandler((event) => {
  const { body, headers } = skillsIndex(event)
  setResponseHeaders(event, headers)
  return body
})
