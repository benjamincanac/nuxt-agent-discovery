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
 * Built-in `@nuxt/content` v3 adapter: `queryCollection()` over
 * `type: 'page'` collections, stringified with minimark. Mirrors the raw
 * markdown route `@nuxt/content` registers when `nuxt-llms` is present, so
 * swapping to this module changes nothing for agents.
 */
const source: AgentContentSource = {
  /**
   * Reads `contentCollection` and `contentFilters` off the section, the same
   * two keys `@nuxt/content`'s llms feature declared, so a site's existing
   * `llms.sections` config keeps working after this module takes the feature
   * over. A selector naming anything else is not ours.
   */
  async list(selector: AgentSectionSelector | undefined, event: H3Event) {
    const { contentCollection, contentFilters } = (selector || {}) as ContentSelector
    if (selector && !contentCollection) {
      return null
    }

    const names = contentCollection ? [contentCollection as keyof Collections] : pageCollections()
    if (contentCollection && !pageCollections().includes(contentCollection as keyof Collections)) {
      return null
    }

    // One query per collection, all in flight at once. `Promise.all` keeps the
    // results in the order the collections were declared, which is the order
    // the flattened listing has to come out in.
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
   * section's first document instead of a 404 when the directory has no index.
   *
   * Ordered by `stem`, which keeps the `1.`/`2.` filename prefixes the path has
   * already dropped, so this lands where the site's own navigation does rather
   * than on whatever sorts first alphabetically.
   */
  async firstLeaf(route: string, event: H3Event) {
    const prefix = `${withLeadingSlash(route).replace(/\/$/, '')}/`
    // `%` is a `LIKE` wildcard and the prefix comes from the URL, so `/raw/%.md`
    // would match every page in every collection and materialize them all
    // before the check below throws them away. `_` is a wildcard too but only
    // for a single character, which is a real path character and barely widens
    // anything, so it stays.
    if (prefix.includes('%')) {
      return null
    }
    // One collection at a time, returning on the first match. `list()` needs
    // every collection and parallelizes; this one needs the first that answers,
    // so a later collection is a query nothing asked for. It is also the raw
    // route's 404 path, where the common case is no match at all, and a
    // `Promise.all` there would reject the whole lookup over a collection the
    // answer never depended on.
    for (const collection of pageCollections()) {
      const pages = await queryCollection(event, collection)
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
    // A structured page carries no markdown body: a YAML landing page, or a
    // collection backed by data rather than prose. It has no markdown
    // representation, so the raw route 404s it and the landing page falls
    // through to the generated index, which is what a site wants for `/`.
    if (!page?.body?.value) {
      return null
    }

    // Copied before anything touches it, the way the comark adapter does:
    // whether `queryCollection` hands back a shared object is its business,
    // and both the hook below and the pipeline mutate the tree in place.
    // `appendRelatedLinks` in particular is not idempotent.
    page = { ...page, body: { ...page.body, value: structuredClone(page.body.value) } }

    // Lets sites transform the minimark tree (MDC components → plain
    // markdown) without replacing the whole source.
    await useNitroApp().hooks.callHook('agent-discovery:document', event, page)

    // Mutated in place: `page.body` below stringifies this same array. The
    // minimark stringifier drops a highlighter's `<style>` node only while it
    // is the last one, so the pipeline strips it before appending anything.
    // `@nuxt/content` keeps `links` either at the root or under `meta`,
    // depending on the collection schema.
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
