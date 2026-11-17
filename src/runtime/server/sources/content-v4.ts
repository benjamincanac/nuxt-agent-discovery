// @ts-expect-error - `content` is the server instance `@nuxt/content` v4 registers as
// a Nitro auto-import. It is only typed in a site running v4, not here.
import { content } from '#imports'
import { createComarkSource } from './comark'
import type { AgentContentSource, AgentRequestEvent, AgentSectionSelector } from '../../shared/types'

type ComarkAccessor = Parameters<typeof createComarkSource>[0]
type ComarkLikeContent = Awaited<ReturnType<ComarkAccessor>>

/**
 * The part of the v4 server `content` this adapter reads: one comark-content
 * instance (`name`) or a hub of them (`names`), the shape `createNuxtContent()`
 * returns. Both read through `get()` and `navigation()`.
 */
interface ContentV4Surface extends Omit<ComarkLikeContent, 'navigation'> {
  name?: string
  names?: readonly string[]
  navigation: (names?: string[]) => ReturnType<ComarkLikeContent['navigation']>
}

/** What `@nuxt/content` v3's llms feature reads off a `llms.sections` entry. */
interface ContentSelector {
  contentCollection?: string
}

/**
 * Adapter factory for `@nuxt/content` v4 (`@nuxt/content4`). v4 is built on
 * comark-content, so documents go through the comark adapter. On top of it,
 * the `contentCollection` key of a v3 `llms.sections` entry keeps working:
 * v4's `content.config.ts` compatibility layer makes every collection a named
 * instance on a hub, so the section lists that instance's navigation.
 */
export function createContentV4Source(getContent: (event: AgentRequestEvent) => ContentV4Surface | Promise<ContentV4Surface>): AgentContentSource {
  const base = createComarkSource(getContent as ComarkAccessor)

  return {
    ...base,

    async list(selector: AgentSectionSelector | undefined, event: AgentRequestEvent) {
      const { contentCollection } = (selector || {}) as ContentSelector
      if (!contentCollection) {
        return base.list!(selector, event)
      }

      const surface = await getContent(event)
      const names = surface.names ?? (surface.name ? [surface.name] : [])
      if (!names.includes(contentCollection)) {
        return null
      }
      // `contentFilters` has no comark equivalent, so the whole collection is
      // listed. A hub filters its navigation by instance name; a lone instance
      // takes no argument and is that collection already.
      const scoped = createComarkSource(() => ({
        get: (key, opts) => surface.get(key, opts),
        navigation: () => surface.navigation([contentCollection])
      }))
      return scoped.list!(undefined, event)
    }
  }
}

/** The built-in v4 source, reading the server `content` the site configured. */
export default createContentV4Source(() => content as ContentV4Surface)
