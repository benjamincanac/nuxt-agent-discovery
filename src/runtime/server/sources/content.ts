import { withBase, withLeadingSlash } from 'ufo'
import { stringify } from 'minimark/stringify'
import { queryCollection } from '@nuxt/content/server'
import type { Collections, PageCollectionItemBase } from '@nuxt/content'
import type { H3Event } from 'h3'
// @ts-expect-error - virtual file provided by @nuxt/content
import collections from '#content/manifest'
import { useNitroApp } from 'nitropack/runtime'
import { getAgentSiteUrl } from '../utils/agent-discovery'
import type { AgentContentSource, AgentListEntry, AgentSectionSelector } from '../../shared/types'

type MinimarkNode = [string, Record<string, unknown>, ...unknown[]]

/** What `@nuxt/content`'s own llms feature reads off a `llms.sections` entry. */
interface ContentSelector {
  contentCollection?: string
  contentFilters?: { field: string, operator: string, value?: string }[]
}

function pageCollections(): (keyof Collections)[] {
  return Object.entries(collections as Record<string, { type: string }>)
    .filter(([_key, value]) => value.type === 'page')
    .map(([key]) => key) as (keyof Collections)[]
}

/** `getting-started` → `Getting Started`, for auto-generated section titles. */
function titleCase(value: string): string {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, char => char.toUpperCase())
}

const LINK_PROPS = ['href', 'src', 'to']

/**
 * Rewrites site-relative links to absolute ones, in place. `@nuxt/content`'s
 * llms feature did this for `llms-full.txt` and nothing did it for the raw
 * route, so the same page linked differently depending on where it was read.
 * Both come through here now: a markdown file is read detached from the site,
 * so a relative href in it points nowhere.
 */
function absolutizeLinks(nodes: unknown[], siteUrl: string): void {
  for (const node of nodes) {
    if (!Array.isArray(node)) {
      continue
    }
    const props = node[1] as Record<string, unknown> | undefined
    if (props && typeof props === 'object') {
      for (const prop of LINK_PROPS) {
        const value = props[prop]
        // Only site-relative paths. Protocol-relative, absolute and in-page
        // anchors already resolve on their own.
        if (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')) {
          props[prop] = withBase(value, siteUrl)
        }
      }
    }
    absolutizeLinks(node.slice(2), siteUrl)
  }
}

function requireEvent(event?: H3Event): H3Event {
  if (!event) {
    throw new Error('[nuxt-agent-discovery] the @nuxt/content source needs the request event')
  }
  return event
}

/**
 * Built-in `@nuxt/content` v3 adapter: `queryCollection()` over
 * `type: 'page'` collections, stringified with minimark. Mirrors the raw
 * markdown route `@nuxt/content` registers when `nuxt-llms` is present, so
 * swapping to this module changes nothing for agents.
 */
const source: AgentContentSource = {
  async routes(event?: H3Event) {
    const paths: string[] = []
    for (const collection of pageCollections()) {
      const pages = await queryCollection(requireEvent(event), collection)
        .select('path')
        .where('path', 'NOT LIKE', '%/.navigation')
        .all() as { path: string }[]
      paths.push(...pages.map(page => page.path))
    }
    return [...new Set(paths)]
  },

  /**
   * Reads `contentCollection` and `contentFilters` off the section, the same
   * two keys `@nuxt/content`'s llms feature declared, so a site's existing
   * `llms.sections` config keeps working after this module takes the feature
   * over. A selector naming anything else is not ours.
   */
  async list(event?: H3Event, selector?: AgentSectionSelector) {
    const { contentCollection, contentFilters } = (selector || {}) as ContentSelector
    if (selector && !contentCollection) {
      return null
    }

    const names = contentCollection ? [contentCollection as keyof Collections] : pageCollections()
    if (contentCollection && !pageCollections().includes(contentCollection as keyof Collections)) {
      return null
    }

    const entries: AgentListEntry[] = []
    for (const collection of names) {
      const query = queryCollection(requireEvent(event), collection)
        .select('path', 'title', 'description')
        .where('path', 'NOT LIKE', '%/.navigation')
      for (const filter of contentFilters || []) {
        query.where(filter.field as never, filter.operator as never, filter.value as never)
      }
      const pages = await query.order('path', 'ASC').all() as { path: string, title?: string, description?: string }[]
      entries.push(...pages.map(page => ({
        route: page.path,
        title: page.title,
        description: page.description,
        section: titleCase(String(collection))
      })))
    }
    return entries
  },

  /**
   * First page under a section path, so `/raw/getting-started.md` lands on the
   * section's first document instead of a 404 when the directory has no index.
   *
   * Ordered by `stem`, which keeps the `1.`/`2.` filename prefixes the path has
   * already dropped, so this lands where the site's own navigation does rather
   * than on whatever sorts first alphabetically.
   */
  async firstLeaf(route: string, event?: H3Event) {
    const prefix = `${withLeadingSlash(route).replace(/\/$/, '')}/`
    for (const collection of pageCollections()) {
      const pages = await queryCollection(requireEvent(event), collection)
        .select('path', 'stem')
        .where('path', 'LIKE', `${prefix}%`)
        .where('path', 'NOT LIKE', '%/.navigation')
        .order('stem', 'ASC')
        .all() as { path: string }[]
      // `where` has no `ESCAPE` clause, and the path comes from the URL, where
      // `%` and `_` are `LIKE` wildcards: `/raw/do_s.md` matches `/docs/...`.
      // The pattern only ever widens the match, so a plain prefix check on the
      // way out is enough to pin it back down.
      const page = pages.find(entry => entry.path?.startsWith(prefix))
      if (page?.path) {
        return page.path
      }
    }
    return null
  },

  async get(route: string, event?: H3Event) {
    let path = withLeadingSlash(route)
    if (path.endsWith('/index')) {
      path = path.slice(0, -6) || '/'
    }

    let page: PageCollectionItemBase | null = null
    for (const collection of pageCollections()) {
      page = await queryCollection(requireEvent(event), collection).path(path).first() as PageCollectionItemBase | null
      if (page) {
        break
      }
    }
    if (!page) {
      return null
    }

    // Lets sites transform the minimark tree (MDC components → plain
    // markdown) without replacing the whole source.
    await useNitroApp().hooks.callHook('agent-discovery:document', requireEvent(event), page)

    const value = page.body.value as unknown as MinimarkNode[]

    // Syntax highlighters append a `<style>` node carrying the per-document
    // CSS variables. It is meaningless in a markdown representation, and the
    // stringifier only drops it while it is the last node, so anything
    // appended below (the related links) would otherwise expose it.
    for (let i = value.length - 1; i >= 0; i--) {
      if (value[i]?.[0] === 'style') {
        value.splice(i, 1)
      }
    }

    if (value[0]?.[0] !== 'h1') {
      if (page.description) {
        value.unshift(['blockquote', {}, page.description])
      }
      if (page.title) {
        value.unshift(['h1', {}, page.title])
      }
    }

    // Append related links at the end if present, like @nuxt/content does.
    const links = (page as unknown as Record<string, unknown>).links || (page.meta as Record<string, unknown> | undefined)?.links
    if (Array.isArray(links) && links.length > 0) {
      const items = links
        .filter((link: { label?: string, to?: string }) => link.label && link.to)
        .map((link: { label: string, to: string }) => ['li', {}, ['a', { href: link.to }, link.label]] as MinimarkNode)
      if (items.length > 0) {
        value.push(['hr', {}])
        value.push(['ul', {}, ...items])
      }
    }

    absolutizeLinks(value, getAgentSiteUrl(requireEvent(event)))

    return {
      markdown: stringify({ ...page.body, type: 'minimark' }, { format: 'markdown/html' }),
      title: page.title,
      description: page.description
    }
  }
}

export default source
