import type { H3Event } from 'h3'
import { appendHeader } from 'h3'
import { withBase } from 'ufo'
import type { NitroApp } from 'nitropack/types'
import { defineNitroPlugin } from 'nitropack/runtime'
import source from '#agent-discovery/source'
import { getAgentSiteUrl, useAgentDiscoveryConfig } from '../utils/agent-discovery'
import { hasFileExtension, matchRoute, normalizePathname, rawDestination } from '../../shared/negotiation'

interface LlmsSection {
  title: string
  description?: string
  links?: { title: string, description?: string, href: string }[]
}

interface LlmsOptions {
  domain?: string
  sections: LlmsSection[]
}

function toLocalPathname(href: string, domain: string): string | undefined {
  try {
    const url = new URL(href, domain)
    if (url.origin !== new URL(domain).origin) {
      return undefined
    }
    return normalizePathname(url.pathname)
  } catch {
    return undefined
  }
}

/**
 * The `nuxt-llms` bridge. This module owns the raw markdown route (so it
 * survives a content-backend swap), which also disables `@nuxt/content`'s
 * llms.txt link rewriting: it is re-done here from the shared route config.
 * For sources `@nuxt/content` doesn't know about (comark, custom adapters),
 * the sections and the full document come from the adapter too.
 */
export default defineNitroPlugin((nitroApp: NitroApp) => {
  const prerenderPaths = new Set<string>()

  nitroApp.hooks.hook('llms:generate' as never, (async (event: H3Event, options: LlmsOptions) => {
    const config = useAgentDiscoveryConfig(event)
    const domain = options.domain || getAgentSiteUrl(event)

    // Populate from the adapter when nothing else did: @nuxt/content fills
    // its collection-backed sections before this hook runs. Only links to
    // negotiable pages count, so nuxt-llms's own llms-full.txt entry doesn't
    // mask an otherwise empty document.
    const hasPageLinks = options.sections.some(section => section.links?.some((link) => {
      const pathname = toLocalPathname(link.href, domain)
      return !!pathname && (pathname === '/' || !hasFileExtension(pathname))
    }))
    if (source && !hasPageLinks) {
      const entries = source.list
        ? await source.list(event)
        : (await source.routes(event)).map(route => ({ route, title: undefined as string | undefined, description: undefined as string | undefined }))
      options.sections.push({
        title: 'Documentation',
        description: 'Every page below is available as raw markdown.',
        links: entries.map(entry => ({
          title: entry.title || entry.route,
          description: entry.description,
          href: withBase(entry.route, domain)
        }))
      })
    }

    // Rewrite page links to their raw markdown twins.
    for (const section of options.sections) {
      if (!section.links) {
        continue
      }
      section.links = section.links.map((link) => {
        const pathname = toLocalPathname(link.href, domain)
        if (!pathname || (pathname !== '/' && hasFileExtension(pathname))) {
          return link
        }
        const route = matchRoute(config.routes, pathname)
        if (!route) {
          return link
        }
        const raw = rawDestination(config, route, pathname)
        prerenderPaths.add(raw)
        return { ...link, href: withBase(raw, domain) }
      })
    }
  }) as never)

  nitroApp.hooks.hook('llms:generate:full' as never, (async (event: H3Event, _options: LlmsOptions, contents: string[]) => {
    // @nuxt/content renders its collection-backed sections before this hook;
    // only adapter-backed sites reach here with nothing rendered.
    if (!source || contents.length) {
      return
    }
    for (const route of await source.routes(event)) {
      const page = await source.get(route, event)
      if (page?.markdown) {
        contents.push(page.markdown)
      }
    }
  }) as never)

  // Lets Nitro's prerender crawler discover the raw markdown twins the
  // generated llms.txt links to. `/llms.txt` is always in the prerender
  // queue, `/` only when the site prerenders it.
  if (['nitro-prerender', 'nitro-dev'].includes(import.meta.preset as string)) {
    nitroApp.hooks.hook('beforeResponse', (event) => {
      if (event.path === '/' || event.path === '/llms.txt') {
        appendHeader(event, 'x-nitro-prerender', Array.from(prerenderPaths))
      }
    })
  }
})
