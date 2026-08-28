import type { H3Event } from 'h3'
import { appendHeader } from 'h3'
import { withBase } from 'ufo'
import type { NitroApp } from 'nitropack/types'
import { defineNitroPlugin } from 'nitropack/runtime'
import source from '#agent-discovery/source'
import type { AgentListEntry } from '../../shared/types'
import { getAgentSiteUrl, useAgentDiscoveryConfig } from '../utils/agent-discovery'
import { getSourcePage } from '../utils/document'
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

function toLocalUrl(href: string, domain: string): { pathname: string, suffix: string } | undefined {
  try {
    const url = new URL(href, domain)
    if (url.origin !== new URL(domain).origin) {
      return undefined
    }
    return { pathname: normalizePathname(url.pathname), suffix: url.search + url.hash }
  } catch {
    return undefined
  }
}

/** A link to a negotiable page, as opposed to `llms-full.txt` or an asset. */
function isPageLink(href: string, domain: string): boolean {
  const local = toLocalUrl(href, domain)
  return !!local && (local.pathname === '/' || !hasFileExtension(local.pathname))
}

function toLink(entry: AgentListEntry, domain: string) {
  return {
    title: entry.title || entry.route,
    description: entry.description,
    href: withBase(entry.route, domain)
  }
}

/** Entries grouped by their `section` label, in first-seen order. */
function groupBySection(entries: AgentListEntry[]): Map<string, AgentListEntry[]> {
  const groups = new Map<string, AgentListEntry[]>()
  for (const entry of entries) {
    const key = entry.section || 'Documentation'
    const group = groups.get(key)
    if (group) {
      group.push(entry)
    } else {
      groups.set(key, [entry])
    }
  }
  return groups
}

/**
 * The `nuxt-llms` bridge, and the only place `llms.txt` gets its pages.
 *
 * `@nuxt/content`'s own llms feature is removed by the module (see the bridge
 * block in `src/module.ts`) because it rendered `llms-full.txt` through a
 * second markdown pipeline that disagreed with `/raw/**.md` and had no comark
 * equivalent. Sections and documents both come from the content adapter now, so
 * every backend produces the same document, and a site's `llms.sections` config
 * keeps working: the section is handed to the adapter, which reads the keys it
 * declares (`contentCollection`/`contentFilters` for `@nuxt/content`,
 * `navigation` for comark).
 */
export default defineNitroPlugin((nitroApp: NitroApp) => {
  const prerenderPaths = new Set<string>()

  nitroApp.hooks.hook('llms:generate' as never, (async (event: H3Event, options: LlmsOptions) => {
    const config = useAgentDiscoveryConfig(event)
    const domain = options.domain || getAgentSiteUrl(event)

    if (source) {
      // Sections the site declared. One that already carries links is left
      // alone; otherwise the adapter is asked whether the section names
      // something it can resolve. Sections do not depend on each other, so the
      // adapter is asked about all of them at once.
      const resolved = await Promise.all(options.sections.map(section => section.links?.length
        ? null
        : (source?.list?.(section as unknown as Record<string, unknown>, event) ?? null)))

      const unresolved: LlmsSection[] = []
      for (const [index, section] of options.sections.entries()) {
        if (section.links?.length) {
          continue
        }
        const entries = resolved[index]
        if (entries?.length) {
          section.links = entries.map(entry => toLink(entry, domain))
        } else if (!section.description) {
          // A selector no adapter recognises, or one that matched nothing: a
          // section left with neither links nor prose renders as a dangling
          // heading. Config that outlived a backend swap is the common case.
          unresolved.push(section)
        }
      }
      for (const section of unresolved) {
        options.sections.splice(options.sections.indexOf(section), 1)
      }

      // Nothing resolved to pages, so list them all. `nuxt-llms` contributes a
      // "Documentation Sets" section pointing at `llms-full.txt`, which must
      // not count as an otherwise empty document having content.
      const hasPageLinks = options.sections.some(section => section.links?.some(link => isPageLink(link.href, domain)))
      if (!hasPageLinks) {
        const entries = (await source.list?.(undefined, event)) || []
        for (const [title, group] of groupBySection(entries)) {
          options.sections.push({
            title,
            description: 'Every page below is available as raw markdown.',
            links: group.map(entry => toLink(entry, domain))
          })
        }
      }
    }

    // The landing page. An adapter whose pages come from structured data has no
    // `/` entry (its homepage is a Vue page), but the module still serves
    // `/raw/index.md` for it, so without this nothing links the document an
    // agent is most likely to want first.
    const linked = options.sections.some(section => section.links?.some(link => toLocalUrl(link.href, domain)?.pathname === '/'))
    if (source && !linked && matchRoute(config.routes, '/')) {
      options.sections.unshift({
        title: 'Overview',
        links: [{ title: config.siteName || 'Landing page', href: withBase('/', domain) }]
      })
    }

    // Rewrite page links to their raw markdown twins.
    for (const section of options.sections) {
      if (!section.links) {
        continue
      }
      section.links = section.links.map((link) => {
        const local = toLocalUrl(link.href, domain)
        if (!local) {
          return link
        }
        const { pathname, suffix } = local

        // Off-site links keep whatever they were written as, but a same-origin
        // one has to come out absolute: `llms.txt` is read detached from the
        // site, so a relative href in it points nowhere.
        const route = pathname === '/' || !hasFileExtension(pathname)
          ? matchRoute(config.routes, pathname)
          : undefined
        if (!route) {
          return { ...link, href: withBase(pathname + suffix, domain) }
        }

        const raw = rawDestination(config, route, pathname)
        prerenderPaths.add(raw)
        return { ...link, href: withBase(raw + suffix, domain) }
      })
    }
  }) as never)

  nitroApp.hooks.hook('llms:generate:full' as never, (async (event: H3Event, options: LlmsOptions, contents: string[]) => {
    if (!source) {
      return
    }

    // The full document follows the sections the site declared, the same set
    // `llms.txt` lists. Rendering every route instead pulls in pages kept out
    // of the documentation on purpose: a landing page, a showcase, a template
    // gallery. Sections carrying hand-written links resolve to nothing here,
    // exactly as they did while `@nuxt/content` owned this.
    const routes: string[] = []
    const seen = new Set<string>()
    const add = (route: string) => {
      if (!seen.has(route)) {
        seen.add(route)
        routes.push(route)
      }
    }

    // Resolved together, then added in section order: the dedupe keeps the
    // first route it sees, so the order the document comes out in has to be
    // the order the sections are declared in.
    const resolved = await Promise.all((options.sections || []).map(section => source?.list?.(section as unknown as Record<string, unknown>, event) ?? null))
    for (const entries of resolved) {
      for (const entry of entries || []) {
        add(entry.route)
      }
    }
    // Nothing resolved to pages, so render them all, on the same condition
    // `llms.txt` lists them all: sections curating page links by hand are the
    // documentation, and dumping the whole site would contradict the index
    // built from the very same predicate. Sections pointing only at data
    // (`/openapi.json`, an API endpoint, a repository) name no documentation,
    // so that site still gets its whole site, as does one with no sections.
    const domain = options.domain || getAgentSiteUrl(event)
    const hasPageLinks = options.sections?.some(section => section.links?.some(link => isPageLink(link.href, domain)))
    if (!routes.length && !hasPageLinks) {
      for (const entry of (await source.list?.(undefined, event)) || []) {
        add(entry.route)
      }
    }

    // The same `get()` the raw route calls, so a page reads identically whether
    // an agent fetches `/raw/**.md` or the single full document.
    const pages = await Promise.all(routes.map(route => getSourcePage(route, event)))
    for (const page of pages) {
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
