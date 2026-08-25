import { withLeadingSlash } from 'ufo'
import { stringify } from 'minimark/stringify'
import { queryCollection } from '@nuxt/content/server'
import type { Collections, PageCollectionItemBase } from '@nuxt/content'
import type { H3Event } from 'h3'
// @ts-expect-error - virtual file provided by @nuxt/content
import collections from '#content/manifest'
import { useNitroApp } from 'nitropack/runtime'
import type { AgentContentSource } from '../../shared/types'

type MinimarkNode = [string, Record<string, unknown>, ...unknown[]]

function pageCollections(): (keyof Collections)[] {
  return Object.entries(collections as Record<string, { type: string }>)
    .filter(([_key, value]) => value.type === 'page')
    .map(([key]) => key) as (keyof Collections)[]
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

  async list(event?: H3Event) {
    const entries: { route: string, title?: string, description?: string }[] = []
    for (const collection of pageCollections()) {
      const pages = await queryCollection(requireEvent(event), collection)
        .select('path', 'title', 'description')
        .where('path', 'NOT LIKE', '%/.navigation')
        .order('path', 'ASC')
        .all() as { path: string, title?: string, description?: string }[]
      entries.push(...pages.map(page => ({ route: page.path, title: page.title, description: page.description })))
    }
    return entries
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
    const hooks = useNitroApp().hooks as unknown as { callHook: (name: string, ...args: unknown[]) => Promise<void> }
    await hooks.callHook('agent-discovery:document', requireEvent(event), page)

    const value = page.body.value as unknown as MinimarkNode[]
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

    return {
      markdown: stringify({ ...page.body, type: 'minimark' }, { format: 'markdown/html' }),
      title: page.title,
      description: page.description
    }
  }
}

export default source
