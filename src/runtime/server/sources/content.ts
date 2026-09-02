import { withLeadingSlash } from 'ufo'
import { stringify } from 'minimark/stringify'
import { queryCollection } from '@nuxt/content/server'
import type { Collections, PageCollectionItemBase } from '@nuxt/content'
import type { H3Event } from 'h3'
import collections from '#content/manifest'
import { useNitroApp } from 'nitropack/runtime'
import { getAgentSiteUrl } from '../utils/agent-discovery'
import { prepareDocumentTree } from './pipeline'
import type { DocNode } from './pipeline'
import type { AgentContentSource, AgentListEntry, AgentSectionSelector } from '../../shared/types'

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

/**
 * Built-in `@nuxt/content` v3 adapter: `queryCollection()` over `type: 'page'`
 * collections, stringified with minimark. Mirrors the raw markdown route
 * `@nuxt/content` registers when `nuxt-llms` is present.
 */
const source: AgentContentSource = {
  /**
   * Reads the same `contentCollection` and `contentFilters` keys
   * `@nuxt/content`'s llms feature declared, so an existing `llms.sections`
   * config keeps working. A selector naming anything else is not ours.
   */
  async list(selector: AgentSectionSelector | undefined, event: H3Event) {
    const { contentCollection, contentFilters } = (selector || {}) as ContentSelector
    if (selector && !contentCollection) {
      return null
    }

    const pageNames = pageCollections()
    if (contentCollection && !pageNames.includes(contentCollection as keyof Collections)) {
      return null
    }
    const names = contentCollection ? [contentCollection as keyof Collections] : pageNames

    // `Promise.all` keeps the collection declaration order the listing needs.
    const results = await Promise.all(names.map(async (collection) => {
      const query = queryCollection(event, collection)
        .select('path', 'title', 'description')
        .where('path', 'NOT LIKE', '%/.navigation')
      for (const filter of contentFilters || []) {
        query.where(filter.field as never, filter.operator as never, filter.value as never)
      }
      const pages = await query.order('path', 'ASC').all() as { path: string, title?: string, description?: string }[]
      return pages.map((page): AgentListEntry => ({
        route: page.path,
        title: page.title,
        description: page.description,
        section: titleCase(String(collection))
      }))
    }))
    return results.flat()
  },

  /**
   * First page under a section path, so `/raw/getting-started.md` lands on the
   * section's first document instead of a 404. Ordered by `stem`, which keeps
   * the `1.`/`2.` filename prefixes the path has dropped, so this lands where
   * the site's own navigation does.
   */
  async firstLeaf(route: string, event: H3Event) {
    const prefix = `${withLeadingSlash(route).replace(/\/$/, '')}/`
    // `%` is a `LIKE` wildcard and the prefix comes from the URL, so `/raw/%.md`
    // would materialize every page in every collection.
    if (prefix.includes('%')) {
      return null
    }
    // Sequential, unlike `list()`: a `Promise.all` would reject the whole
    // lookup over a collection the answer never depended on.
    for (const collection of pageCollections()) {
      const pages = await queryCollection(event, collection)
        .select('path', 'stem')
        .where('path', 'LIKE', `${prefix}%`)
        .where('path', 'NOT LIKE', '%/.navigation')
        .order('stem', 'ASC')
        .all() as { path: string }[]
      // `where` has no `ESCAPE` clause, so `_` still widens the match
      // (`/raw/do_s.md` matches `/docs/...`). Pinned back down here.
      const page = pages.find(entry => entry.path?.startsWith(prefix))
      if (page?.path) {
        return page.path
      }
    }
    return null
  },

  async get(route: string, event: H3Event) {
    let path = withLeadingSlash(route)
    if (path.endsWith('/index')) {
      path = path.slice(0, -6) || '/'
    }

    let page: PageCollectionItemBase | null = null
    for (const collection of pageCollections()) {
      page = await queryCollection(event, collection).path(path).first() as PageCollectionItemBase | null
      if (page) {
        break
      }
    }
    // A structured page (YAML landing page, data collection) has no markdown
    // representation, so the raw route 404s it and `/` falls through to the index.
    if (!page?.body?.value) {
      return null
    }

    // Copied before anything mutates it: the hook and the pipeline both edit
    // the tree in place, and `appendRelatedLinks` is not idempotent.
    page = { ...page, body: { ...page.body, value: structuredClone(page.body.value) } }

    // Lets sites transform the tree without replacing the whole source.
    await useNitroApp().hooks.callHook('agent-discovery:document', event, page)

    // Mutated in place: `page.body` below stringifies this same array. `links`
    // sits at the root or under `meta`, depending on the collection schema.
    prepareDocumentTree(page.body.value as unknown as DocNode[], {
      title: page.title,
      description: page.description,
      links: (page as unknown as Record<string, unknown>).links || (page.meta as Record<string, unknown> | undefined)?.links,
      siteUrl: getAgentSiteUrl(event)
    })

    return {
      markdown: stringify({ ...page.body, type: 'minimark' }, { format: 'markdown/html' }),
      title: page.title,
      description: page.description
    }
  }
}

export default source
