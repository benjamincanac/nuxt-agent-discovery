import { comarkContent } from 'comark-content'
import fs from 'comark-content/sources/fs'
import type { ComarkContent } from 'comark-content'
import { createComarkSource } from '#agent-discovery/comark'

/**
 * The comark wiring a real site writes, in miniature.
 *
 * A comark site builds its own content instance (its sources, plugins, cache
 * and, in production, the commit it is pinned to), so the module cannot
 * construct one for it. The accessor is the seam: it hands the adapter
 * whatever instance the site already has.
 *
 * `comarkContent()` is synchronous and the read methods `init()` lazily, so
 * there is nothing to await here and no promise to memoize.
 */
let content: ComarkContent | undefined

export default createComarkSource(() => {
  content ??= comarkContent({
    sources: { content: fs(useRuntimeConfig().contentDir as string) }
  })
  return content
})
