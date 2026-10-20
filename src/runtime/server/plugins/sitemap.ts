import { parseURL } from 'ufo'
import { definePlugin } from 'nitro'
import { useAgentDiscoveryConfig } from '../utils/agent-discovery'
import { isRawPath } from '../../shared/negotiation'
import type { SitemapInputCtx } from '@nuxtjs/sitemap'

/**
 * Drops the raw markdown twins from every sitemap `@nuxtjs/sitemap` builds, on
 * Nitro 3. `sitemap.legacy.ts` is the Nitro 2 twin.
 *
 * At runtime rather than through `sitemap.exclude`, which is read during that
 * module's own setup: a build-time contribution only lands when the site lists
 * this module first, and never when `@nuxtjs/seo` installs the sitemap through
 * `moduleDependencies`.
 */
export default definePlugin((nitroApp) => {
  const { rawPrefix } = useAgentDiscoveryConfig()

  // Typed with the context `@nuxtjs/sitemap` exports, so a shape change fails
  // this build. The cast is only for the hook name, which it does not augment.
  const hooks = nitroApp.hooks as unknown as {
    hook: (name: 'sitemap:input', cb: (ctx: SitemapInputCtx) => void) => void
  } | undefined

  hooks?.hook('sitemap:input', (ctx) => {
    ctx.urls = ctx.urls.filter((url) => {
      const loc = typeof url === 'string' ? url : url?.loc
      // Sources may hand over absolute URLs, so compare on the pathname.
      return !loc || !isRawPath({ rawPrefix }, parseURL(loc).pathname || loc)
    })
  })
})
