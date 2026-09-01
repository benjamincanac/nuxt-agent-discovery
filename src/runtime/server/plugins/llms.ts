import type { H3Event } from 'h3'
import { appendHeader } from 'h3'
import { withBase } from 'ufo'
import type { NitroApp } from 'nitropack/types'
import { defineNitroPlugin } from 'nitropack/runtime'
import source from '#agent-discovery/source'
import type { AgentListEntry, NegotiationConfig } from '../../shared/types'
import { getAgentSiteUrl, useAgentDiscoveryConfig } from '../utils/agent-discovery'
import { generatedIndexPage, getSourcePage } from '../utils/document'
import { hasFileExtension, isExcluded, matchRoute, normalizeAgentRoute, normalizePathname, rawDestination } from '../../shared/negotiation'

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

/**
 * The page route a link points at, or `undefined` when it names something with
 * no markdown representation: another origin, `llms-full.txt`, an asset, an
 * endpoint under an excluded prefix.
 *
 * Judged by exclusion and extension alone, not by `routes`: a curated section
 * may name pages outside the negotiated patterns, and listing them is its
 * call, so a site narrowing `routes` must not get its curation duplicated by
 * the whole-site fallback. What has to stay out is data, `/openapi.json` by
 * its extension and `/api/v1/tools` by its prefix.
 */
function pageRoute(config: NegotiationConfig, href: string, domain: string): string | undefined {
  const local = toLocalUrl(href, domain)
  if (!local) {
    return undefined
  }
  // `URL.pathname` comes out percent-encoded while every backend stores
  // decoded paths, so the route is decoded the same way the raw handler
  // decodes its slug, or a curated link to `/docs/café` resolves no page.
  const route = normalizeAgentRoute(local.pathname)
  return !isExcluded(route, config) && (route === '/' || !hasFileExtension(route)) ? route : undefined
}

/** At most this many adapter calls in flight, per fan-out. */
const CONCURRENCY = 8

/**
 * `Promise.all` with a bounded number of workers, results in input order.
 *
 * A documentation site hands this hundreds of routes and sections, and firing
 * every `get()` at once is what turns building `llms-full.txt` into a burst
 * the content backend has to absorb in one go.
 */
async function mapLimit<T, R>(items: T[], task: (item: T) => R | Promise<R>): Promise<R[]> {
  const results: R[] = []
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await task(items[index]!)
    }
  }))
  return results
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
      // Narrowed once, because the check above does not carry into the
      // closures below.
      const adapter = source

      // Sections the site declared. One that already carries links is left
      // alone; otherwise the adapter is asked whether the section names
      // something it can resolve. Sections do not depend on each other, so the
      // adapter is asked about all of them at once.
      const resolved = await mapLimit(options.sections, section => section.links?.length
        ? null
        : (adapter.list?.(section as unknown as Record<string, unknown>, event) ?? null))

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

      // Nothing resolved to pages, so list them all. Only a link the site
      // serves markdown for counts as a page: the "Documentation Sets" section
      // `nuxt-llms` contributes points at `llms-full.txt`, and a site listing
      // its API endpoints has named no documentation either.
      const hasPageLinks = options.sections.some(section => section.links?.some(link => pageRoute(config, link.href, domain)))
      if (!hasPageLinks) {
        // The same filter `listAgentPages` applies, so the fallback cannot
        // advertise pages `sitemap.md` deliberately hides.
        const entries = ((await adapter.list?.(undefined, event)) || []).filter(entry => !isExcluded(entry.route, config))
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
    // The exclusion guard is for symmetry with the fallback listings: a site
    // excluding `/` has said the landing page is not agent surface.
    if (source && !linked && !isExcluded('/', config) && matchRoute(config.routes, '/')) {
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
        // site, so a relative href in it points nowhere. An excluded path is
        // the site's own document, not a page with a raw twin: rewriting it
        // would mint a URL that 404s.
        const route = (pathname === '/' || !hasFileExtension(pathname)) && !isExcluded(pathname, config)
          ? matchRoute(config.routes, pathname)
          : undefined
        if (!route) {
          return { ...link, href: withBase(pathname + suffix, domain) }
        }

        const raw = rawDestination(config, route, pathname)
        // A twin the site serves with its own handler must not reach the
        // crawler: prerendering it freezes live data at build. The link still
        // points there, the handler answers it per request.
        if (!config.ownRawRoutes?.includes(raw)) {
          prerenderPaths.add(raw)
        }
        return { ...link, href: withBase(raw + suffix, domain) }
      })
    }
  }) as never)

  nitroApp.hooks.hook('llms:generate:full' as never, (async (event: H3Event, options: LlmsOptions, contents: string[]) => {
    if (!source) {
      return
    }
    // Narrowed once, because the check above does not carry into the closures
    // below.
    const adapter = source
    const config = useAgentDiscoveryConfig(event)
    const domain = options.domain || getAgentSiteUrl(event)

    // The full document follows the sections the site declared, the same set
    // `llms.txt` lists. Rendering every route instead pulls in pages kept out
    // of the documentation on purpose: a landing page, a showcase, a template
    // gallery. A section names its pages through a selector the adapter
    // resolves, or through the links it curates by hand, and both end up here.
    const routes: string[] = []
    const seen = new Set<string>()
    const add = (route: string) => {
      if (!seen.has(route)) {
        seen.add(route)
        routes.push(route)
      }
    }

    // Selectors resolved together, then added in section order: the dedupe
    // keeps the first route it sees, so the order the document comes out in
    // has to be the order the sections are declared in.
    const sections = options.sections || []
    // The same guard `llms.txt` applies: a section carrying its own links owns
    // its curation, so its selector must not smuggle in pages the index hides.
    const resolved = await mapLimit(sections, section => section.links?.length
      ? null
      : (adapter.list?.(section as unknown as Record<string, unknown>, event) ?? null))
    for (const [index, section] of sections.entries()) {
      for (const entry of resolved[index] || []) {
        add(entry.route)
      }
      // A section curating its documentation by hand names it in its links, so
      // the pages behind them are what the full document is. Everything else a
      // section can point at (`/openapi.json`, an API endpoint, another site)
      // has no page to render, and `llms.txt` reads those links the same way.
      for (const link of section.links || []) {
        const route = pageRoute(config, link.href, domain)
        if (route) {
          add(route)
        }
      }
    }
    // No section named a page, so render them all, on the same condition
    // `llms.txt` lists them all. Sections pointing only at data name no
    // documentation, so that site still gets its whole site, as does one with
    // no sections at all.
    if (!routes.length) {
      for (const entry of (await adapter.list?.(undefined, event)) || []) {
        // The same filter `listAgentPages` applies, matching the index hook.
        if (!isExcluded(entry.route, config)) {
          add(entry.route)
        }
      }
    }

    // The landing page, mirroring the index hook: `llms.txt` links `/` (or
    // its generated `/raw/index.md`) whenever no section names it, so the
    // full document has to hold the page it advertises.
    if (!seen.has('/') && !isExcluded('/', config) && matchRoute(config.routes, '/')) {
      routes.unshift('/')
    }

    // The same `get()` the raw route calls, so a page reads identically
    // whether an agent fetches `/raw/**.md` or the single full document. `/`
    // is the one route with a fallback: an adapter with no `/` entry still
    // has the generated index behind `/raw/index.md`.
    const pages = await mapLimit(routes, async route =>
      await getSourcePage(route, event) ?? (route === '/' ? await generatedIndexPage(event) : null))
    for (const page of pages) {
      if (page?.markdown) {
        contents.push(page.markdown)
      }
    }
  }) as never)

  // Lets Nitro's prerender crawler discover the raw markdown twins the
  // generated llms.txt links to. `/llms.txt` is always in the prerender
  // queue, `/` only when the site prerenders it.
  if (emitsPrerenderHints(import.meta.preset)) {
    nitroApp.hooks.hook('beforeResponse', (event) => {
      if (event.path === '/' || event.path === '/llms.txt') {
        appendHeader(event, 'x-nitro-prerender', Array.from(prerenderPaths))
      }
    })
  }
})

/**
 * Whether the hint header goes out at all. Only the prerender crawler ever
 * reads it, and it is not free anywhere else: a documentation site collects
 * hundreds of twin paths, and `nitro-dev` used to be in this list, which put
 * them all in one header on every `/` and `/llms.txt` response. The Nuxt dev
 * proxy never relayed those responses: the server logged a 200 and the
 * client hung.
 */
export function emitsPrerenderHints(preset: unknown): boolean {
  return preset === 'nitro-prerender'
}
