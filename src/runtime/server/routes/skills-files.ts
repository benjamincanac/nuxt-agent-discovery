import { useStorage } from 'nitro/storage'
import { createError, defineEventHandler } from 'nuxt/server'
import { resolveSkillFile } from '../utils/skills'

/**
 * Serves one file of a skill from the bundled server assets, on Nitro 3. Server
 * assets are Nitro's, `nuxt/server` has no storage, so this is the `nitro3`
 * variant rather than the portable one.
 */
export default defineEventHandler(async (event) => {
  const file = resolveSkillFile(event, event.url.pathname)
  if ('status' in file) {
    throw createError({ status: file.status, statusText: file.status === 400 ? 'Bad Request' : 'Not Found' })
  }

  const content = await useStorage('assets:agentSkills').getItemRaw<string>(file.path)
  if (!content) {
    throw createError({ status: 404, statusText: 'Not Found' })
  }

  for (const [name, value] of Object.entries(file.headers)) {
    event.res.headers.set(name, value)
  }
  return content
})
