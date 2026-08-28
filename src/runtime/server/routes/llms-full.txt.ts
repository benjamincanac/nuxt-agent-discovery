import { defineEventHandler, setResponseHeader } from 'h3'
import { useNitroApp } from 'nitropack/runtime'
import { useRuntimeConfig } from '#imports'
import type { LlmsDocument } from '../../shared/types'
import { getAgentSiteUrl } from '../utils/agent-discovery'

/**
 * `llms-full.txt`, served natively when `nuxt-llms` is not installed. Like
 * `nuxt-llms`, the handler contributes no content of its own: every block
 * comes from a `llms:generate:full` hook pushing onto `contents`, which for
 * this module is the plugin rendering each page through the same `get()` the
 * raw route calls.
 */
export default defineEventHandler(async (event) => {
  const options = useRuntimeConfig(event).agentDiscoveryLlms as LlmsDocument
  const llms = JSON.parse(JSON.stringify(options)) as LlmsDocument
  llms.domain ||= getAgentSiteUrl(event)

  const contents: string[] = []
  await useNitroApp().hooks.callHook('llms:generate:full' as never, event as never, llms as never, contents as never)

  setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  return contents.join('\n\n')
})
