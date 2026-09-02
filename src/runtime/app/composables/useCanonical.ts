import { computed, toValue } from 'vue'
import type { MaybeRefOrGetter } from 'vue'
import { joinURL } from 'ufo'
import { useHead, useRequestURL, useRoute, useRuntimeConfig } from '#imports'

/**
 * Adds a canonical link for the current route, plus a
 * `rel="alternate"; type="text/markdown"` link when a markdown twin is given.
 *
 * ```ts
 * useCanonical(() => `${route.path}.md`)
 * ```
 */
export function useCanonical(markdownAlternate?: MaybeRefOrGetter<string | null | undefined>) {
  const route = useRoute()
  const publicConfig = useRuntimeConfig().public.agentDiscovery as { siteUrl?: string } | undefined
  const requestUrl = useRequestURL()
  const siteUrl = publicConfig?.siteUrl || requestUrl.origin

  useHead({
    link: computed(() => {
      const markdown = toValue(markdownAlternate)
      return [
        { rel: 'canonical' as const, href: joinURL(siteUrl, route.path) },
        ...(markdown ? [{ rel: 'alternate' as const, type: 'text/markdown', href: joinURL(siteUrl, markdown) }] : [])
      ]
    })
  })
}
