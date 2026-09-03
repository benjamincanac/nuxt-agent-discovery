import type { H3Event } from 'h3'
import { appendHeader } from 'h3'
import { withBase } from 'ufo'
import type { NitroApp } from 'nitropack/types'
import { defineNitroPlugin } from 'nitropack/runtime'
import source from '#agent-discovery/source'
import type { AgentListEntry, NegotiationConfig } from '../../shared/types'
import { getAgentSiteUrl, useAgentDiscoveryConfig } from '../utils/agent-discovery'
import { appendAgentResources, generatedIndexPage, getSourcePage } from '../utils/document'
import { hasFileExtension, isExcluded, isHomepage, matchRoute, normalizeAgentRoute, normalizePathname, rawDestination, siteServesRaw } from '../../shared/negotiation'

type LlmsSection = {
  title: string
  description?: string
  links?: { title: string, description?: string, href: string }[]
}

interface LlmsOptions {
  domain?: string
  /** The `llms.txt` blockquote, and what the details section follows. */
  description?: string
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
 * The page route a link points at, or `undefined` when it names something with no
 * markdown representation. Judged by exclusion and extension alone, not by
 * `routes`: a curated section may name pages outside the negotiated patterns, and
 * listing them is its call.
 */
function pageRoute(config: NegotiationConfig, href: string, domain: string): string | undefined {
  const local = toLocalUrl(href, domain)
  if (!local) {
    return undefined
  }
  // `URL.pathname` comes out percent-encoded while every backend stores decoded
  // paths, or a curated link to `/docs/café` resolves no page.
  const route = normalizeAgentRoute(local.pathname)
  return !isExcluded(route, config) && (route === '/' || !hasFileExtension(route)) ? route : undefined
}

/** At most this many adapter calls in flight, per fan-out. */
const CONCURRENCY = 8

/**
 * `Promise.all` with a bounded number of workers, results in input order. Firing
 * every `get()` at once turns `llms-full.txt` into a burst the backend absorbs whole.
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

/**
 * The adapter's listing with every route normalized the way `listAgentPages` does,
 * so an adapter listing its homepage as `/index` lands on the same `/` the
 * landing-page checks key on. `llms.txt` and `llms-full.txt` share this one call.
 */
async function listPages(adapter: NonNullable<typeof source>, selector: Record<string, unknown> | undefined, event: H3Event): Promise<AgentListEntry[]> {
  return ((await adapter.list?.(selector, event)) || []).map(entry => ({ ...entry, route: normalizeAgentRoute(entry.route) }))
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
 * Sections and documents both come from the content adapter, so every backend
 * produces the same document and a site's `llms.sections` config keeps working:
 * the section is handed over, and the adapter reads the keys it declares.
 */
export default defineNitroPlugin((nitroApp: NitroApp) => {
  const prerenderPaths = new Set<string>()

  nitroApp.hooks.hook('llms:generate' as never, (async (event: H3Event, options: LlmsOptions) => {
    const config = useAgentDiscoveryConfig(event)
    const domain = options.domain || getAgentSiteUrl(event)

    // The details section llmstxt.org reserves between the blockquote and the
    // first `##`. `nuxt-llms` has no field for it, and the description is the
    // only lever a hook has: the generator emits it as `> ${description}` and
    // joins the document's blocks with a blank line, so everything after the
    // first blank line lands outside the quote. The `basic` e2e suite pins the
    // rendered header byte for byte, which turns a change upstream into a
    // failing build here rather than a broken `llms.txt` on every site.
    if (config.llmsDetails?.length && options.description) {
      options.description = [options.description, ...config.llmsDetails].join('\n\n')
    }

    if (source) {
      const adapter = source

      // A section that already carries links owns its curation and is left alone.
      const resolved = await mapLimit(options.sections, section => section.links?.length
        ? null
        : listPages(adapter, section, event))

      const unresolved: LlmsSection[] = []
      for (const [index, section] of options.sections.entries()) {
        if (section.links?.length) {
          continue
        }
        const entries = resolved[index]
        if (entries?.length) {
          section.links = entries.map(entry => toLink(entry, domain))
        } else if (!section.description) {
          // Neither links nor prose renders as a dangling heading.
          unresolved.push(section)
        }
      }
      for (const section of unresolved) {
        options.sections.splice(options.sections.indexOf(section), 1)
      }

      // Only a link the site serves markdown for counts as a page: the
      // "Documentation Sets" section `nuxt-llms` contributes points at
      // `llms-full.txt`, and API endpoints are not documentation either.
      const hasPageLinks = options.sections.some(section => section.links?.some(link => pageRoute(config, link.href, domain)))
      if (!hasPageLinks) {
        // The same filter `listAgentPages` applies, so the fallback cannot
        // advertise pages `sitemap.md` hides.
        const entries = (await listPages(adapter, undefined, event)).filter(entry => !isExcluded(entry.route, config))
        for (const [title, group] of groupBySection(entries)) {
          options.sections.push({
            title,
            description: 'Every page below is available as raw markdown.',
            links: group.map(entry => toLink(entry, domain))
          })
        }
      }
    }

    // An adapter whose homepage is a Vue page has no `/` entry, yet the module
    // still serves `/raw/index.md` for it.
    const linked = options.sections.some(section => section.links?.some(link => toLocalUrl(link.href, domain)?.pathname === '/'))
    if (source && !linked && !isExcluded('/', config) && matchRoute(config.routes, '/')) {
      options.sections.unshift({
        title: 'Overview',
        links: [{ title: config.siteName || 'Landing page', href: withBase('/', domain) }]
      })
    }

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

        // A same-origin link comes out absolute, since `llms.txt` is read detached
        // from the site. An excluded path has no raw twin to rewrite it to.
        const route = (pathname === '/' || !hasFileExtension(pathname)) && !isExcluded(pathname, config)
          ? matchRoute(config.routes, pathname)
          : undefined
        if (!route) {
          return { ...link, href: withBase(pathname + suffix, domain) }
        }

        const raw = rawDestination(config, route, pathname)
        // Prerendering a twin the site serves with its own handler freezes live
        // data at build. The link still points there, the handler answers it.
        if (!siteServesRaw(config, raw)) {
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
    const adapter = source
    const config = useAgentDiscoveryConfig(event)
    const domain = options.domain || getAgentSiteUrl(event)

    // The full document follows the sections the site declared. Rendering every
    // route instead pulls in a showcase, a template gallery, a landing page.
    const routes: string[] = []
    const seen = new Set<string>()
    const add = (route: string) => {
      if (!seen.has(route)) {
        seen.add(route)
        routes.push(route)
      }
    }

    // Selectors resolved together, then added in section order: the dedupe keeps
    // the first route it sees, so declaration order is the document's order.
    const sections = options.sections || []
    const resolved = await mapLimit(sections, section => section.links?.length
      ? null
      : listPages(adapter, section, event))
    for (const [index, section] of sections.entries()) {
      for (const entry of resolved[index] || []) {
        add(entry.route)
      }
      // A section's other links name data or another site, so no page to render.
      for (const link of section.links || []) {
        const route = pageRoute(config, link.href, domain)
        if (route) {
          add(route)
        }
      }
    }
    // No section named a page, so render them all, matching what `llms.txt` lists.
    if (!routes.length) {
      for (const entry of await listPages(adapter, undefined, event)) {
        if (!isExcluded(entry.route, config)) {
          add(entry.route)
        }
      }
    }

    // Mirrors the index hook: `llms.txt` links `/` whenever no section names it,
    // so the full document has to hold the page it advertises.
    if (!seen.has('/') && !isExcluded('/', config) && matchRoute(config.routes, '/')) {
      routes.unshift('/')
    }

    // The same `get()` the raw route calls, so a page reads identically whether an
    // agent fetches `/raw/**.md` or the full document. The homepages carry the
    // resources block like their twins do, and `/` alone has a fallback.
    const pages = await mapLimit(routes, async (route) => {
      const page = await getSourcePage(route, event)
      if (page) {
        return isHomepage(config, route) ? { ...page, markdown: appendAgentResources(event, page.markdown) } : page
      }
      return route === '/' ? await generatedIndexPage(event) : null
    })
    for (const page of pages) {
      if (page?.markdown) {
        contents.push(page.markdown)
      }
    }
  }) as never)

  // Lets the prerender crawler discover twins whose pages are never rendered as
  // HTML. Flushed on `/` because Nitro reads the hint from HTML responses only,
  // and `/llms.txt` goes out as `text/plain`. Encoded per entry, since Nitro
  // splits the header on commas and decodes each part.
  if (emitsPrerenderHints(import.meta.preset)) {
    nitroApp.hooks.hook('beforeResponse', (event) => {
      if (event.path === '/' && prerenderPaths.size) {
        appendHeader(event, 'x-nitro-prerender', Array.from(prerenderPaths, path => encodeURIComponent(path)))
      }
    })
  }
})

/**
 * Whether the hint header goes out at all. Widening this is not free: with
 * `nitro-dev` in the list, a docs site's hundreds of twin paths land in one header
 * on every `/` response, which the Nuxt dev proxy never relays. The server logs a
 * 200 and the client hangs.
 */
export function emitsPrerenderHints(preset: unknown): boolean {
  return preset === 'nitro-prerender'
}
