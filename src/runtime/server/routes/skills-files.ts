import { createError, defineEventHandler, getRequestURL, setResponseHeader } from 'h3'
import { useStorage } from 'nitropack/runtime'
import { useRuntimeConfig } from '#imports'
import type { SkillEntry } from '../../shared/types'

const CONTENT_TYPES: Record<string, string> = {
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.py': 'text/plain; charset=utf-8',
  '.sh': 'text/plain; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.ts': 'text/plain; charset=utf-8'
}

function contentType(path: string): string {
  return CONTENT_TYPES[path.slice(path.lastIndexOf('.'))] || 'application/octet-stream'
}

/**
 * Serves one file of a skill from the bundled server assets. Only paths under
 * a skill listed in the catalog are reachable, so the route cannot be walked
 * outside the skills directory.
 */
export default defineEventHandler(async (event) => {
  const prefix = '/.well-known/skills/'
  const pathname = getRequestURL(event).pathname
  const index = pathname.indexOf(prefix)
  if (index === -1) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }

  let path: string
  try {
    path = decodeURIComponent(pathname.slice(index + prefix.length))
  } catch {
    // A malformed escape (`%`, `%zz`) is a bad request, not a server error.
    throw createError({ statusCode: 400, statusMessage: 'Bad Request' })
  }
  if (!path || path.includes('..')) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request' })
  }

  const { skills } = useRuntimeConfig(event).agentDiscoverySkills as { skills: SkillEntry[] }
  const skill = skills.find(entry => entry.name === path.split('/')[0])
  if (!skill || !skill.files.includes(path.slice(skill.name.length + 1))) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }

  const content = await useStorage('assets:agentSkills').getItemRaw<string>(path)
  if (!content) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }

  setResponseHeader(event, 'Content-Type', contentType(path))
  setResponseHeader(event, 'Cache-Control', 'public, max-age=3600')

  return content
})
