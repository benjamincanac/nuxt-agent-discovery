import { useServerConfig } from '#agent-discovery/server'
import { SKILLS_PREFIX } from '../../shared/paths'
import type { AgentRequestEvent, SkillEntry } from '../../shared/types'

/** The Agent Skills catalog, generated from the skills directory at build time. */
export function skillsIndex(event: AgentRequestEvent): { body: { skills: SkillEntry[] }, headers: Record<string, string> } {
  const { skills } = useServerConfig(event).agentDiscoverySkills as { skills: SkillEntry[] }
  return {
    body: { skills },
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600'
    }
  }
}

const SKILL_CONTENT_TYPES: Record<string, string> = {
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

/**
 * The server asset a skill file URL names, or the status to answer with. Only
 * paths under a skill listed in the catalog are reachable.
 */
export function resolveSkillFile(event: AgentRequestEvent, pathname: string): { path: string, headers: Record<string, string> } | { status: 400 | 404 } {
  const index = pathname.indexOf(SKILLS_PREFIX)
  if (index === -1) {
    return { status: 404 }
  }

  let path: string
  try {
    path = decodeURIComponent(pathname.slice(index + SKILLS_PREFIX.length))
  } catch {
    // A malformed escape (`%`, `%zz`) is a bad request, not a server error.
    return { status: 400 }
  }
  if (!path || path.includes('..')) {
    return { status: 400 }
  }

  const { skills } = useServerConfig(event).agentDiscoverySkills as { skills: SkillEntry[] }
  const skill = skills.find(entry => entry.name === path.split('/')[0])
  if (!skill || !skill.files.includes(path.slice(skill.name.length + 1))) {
    return { status: 404 }
  }

  return {
    path,
    headers: {
      'Content-Type': SKILL_CONTENT_TYPES[path.slice(path.lastIndexOf('.'))] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=3600'
    }
  }
}
