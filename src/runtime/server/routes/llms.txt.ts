import { defineEventHandler, setResponseHeader } from 'h3'
import { useNitroApp } from 'nitropack/runtime'
import { useRuntimeConfig } from '#imports'
import type { LlmsDocument } from '../../shared/types'
import { getAgentSiteUrl, useAgentDiscoveryConfig } from '../utils/agent-discovery'

interface LlmsRuntimeConfig extends LlmsDocument {
  full?: { title: string, description: string }
}

/**
 * `llms.txt`, served natively when `nuxt-llms` is not installed. The document
 * renders byte-identically to `nuxt-llms@0.2.0` from the same config (the one
 * departure: an unset title falls back to `siteName` before the literal
 * `Documentation`), so a site dropping the dependency can diff the two and see
 * nothing move. The `llms:generate` hook fires with the same signature, which
 * is what keeps the section-building plugin, and any hook a site wrote, shared
 * between the two modes.
 */
export default defineEventHandler(async (event) => {
  const options = useRuntimeConfig(event).agentDiscoveryLlms as LlmsRuntimeConfig
  const config = useAgentDiscoveryConfig(event)

  // Cloned per request, as `nuxt-llms` does: hooks mutate the document in
  // place, and the config must not accumulate their edits across requests.
  const llms = JSON.parse(JSON.stringify(options)) as LlmsRuntimeConfig
  // `nuxt-llms` refuses to run without a configured domain; here it falls back
  // to the request origin, which keeps preview deployments correct.
  llms.domain ||= getAgentSiteUrl(event)

  // The synthetic section `nuxt-llms` bakes in at build time, built per
  // request instead because the domain is only known now.
  if (llms.full) {
    llms.sections.unshift({
      title: 'Documentation Sets',
      links: [{ title: llms.full.title, description: llms.full.description, href: `${llms.domain}/llms-full.txt` }]
    })
  }

  await useNitroApp().hooks.callHook('llms:generate' as never, event as never, llms as never)

  const document = [`# ${llms.title || config.siteName || 'Documentation'}`]
  if (llms.description) {
    document.push(`> ${llms.description}`)
  }
  for (const section of llms.sections) {
    document.push(`## ${section.title}`)
    if (section.description) {
      document.push(section.description)
    }
    // The `|| ''` empty block on a linkless section reproduces `nuxt-llms`'s
    // output exactly, its double blank line included.
    document.push(section.links?.map(link => link.description
      ? `- [${link.title}](${link.href}): ${link.description}`
      : `- [${link.title}](${link.href})`).join('\n') || '')
  }
  if (llms.notes?.length) {
    document.push('## Notes', llms.notes.map(note => `- ${note}`).join('\n'))
  }

  setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  return document.join('\n\n')
})
