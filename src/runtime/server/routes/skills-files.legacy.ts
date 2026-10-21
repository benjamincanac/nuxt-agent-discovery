import { createError, defineEventHandler, getRequestURL, setResponseHeaders } from 'h3'
import { useStorage } from 'nitropack/runtime'
import { resolveSkillFile } from '../utils/skills'

/** Serves one file of a skill from the bundled server assets, on Nitro 2. */
export default defineEventHandler(async (event) => {
  const file = resolveSkillFile(event, getRequestURL(event).pathname)
  if ('status' in file) {
    throw createError({ statusCode: file.status, statusMessage: file.status === 400 ? 'Bad Request' : 'Not Found' })
  }

  const content = await useStorage('assets:agentSkills').getItemRaw<string>(file.path)
  if (!content) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }

  setResponseHeaders(event, file.headers)
  return content
})
