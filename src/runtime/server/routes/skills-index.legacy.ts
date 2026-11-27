import { defineEventHandler, setResponseHeaders } from 'h3'
import { skillsIndex } from '../utils/skills'
import { assertDocumentMethod } from '../utils/server.legacy'

/** The Agent Skills catalog, on Nitro 2. */
export default defineEventHandler((event) => {
  assertDocumentMethod(event)
  const { body, headers } = skillsIndex(event)
  setResponseHeaders(event, headers)
  return body
})
