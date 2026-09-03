import { defineEventHandler, setResponseHeader } from 'h3'
import { useRuntimeConfig } from '#imports'
import type { SkillEntry } from '../../shared/types'

/** The Agent Skills catalog, generated from the skills directory at build time. */
export default defineEventHandler((event) => {
  const { skills } = useRuntimeConfig(event).agentDiscoverySkills as { skills: SkillEntry[] }

  setResponseHeader(event, 'Content-Type', 'application/json; charset=utf-8')
  setResponseHeader(event, 'Cache-Control', 'public, max-age=3600')

  return { skills }
})
