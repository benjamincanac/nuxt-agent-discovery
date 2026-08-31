import { parseURL } from 'ufo'
import { defineNitroPlugin } from 'nitropack/runtime'
import { useAgentDiscoveryConfig } from '../utils/agent-discovery'
import { isRawPath } from '../../shared/negotiation'

/** A sitemap URL as the sources hand it over, before `@nuxtjs/sitemap` normalizes it. */
type SitemapUrlInput = string | { loc?: string }

interface SitemapInputContext {
  urls: SitemapUrlInput[]
}

/**
 * Drops the raw markdown twins from every sitemap `@nuxtjs/sitemap` builds.
 *
 * They are alternate representations of pages that are already listed, not
 * pages of their own, and the prerender source picks the generated `.md` files
 * up like any other route.
 *
 * At runtime rather than through `sitemap.exclude`, because that option is read
 * during the sitemap module's own setup: a build-time contribution only lands
 * when the site happens to list this module first, and never at all when
 * `@nuxtjs/seo` installs the sitemap through `moduleDependencies`. The hook
 * fires for the prerendered sitemaps too, since those are built by fetching the
 * route through this same Nitro app.
 */
export default defineNitroPlugin((nitroApp) => {
  const { rawPrefix } = useAgentDiscoveryConfig()

  const onSitemapInput = nitroApp.hooks.hook as unknown as (
    name: 'sitemap:input',
    cb: (ctx: SitemapInputContext) => void
  ) => void

  onSitemapInput('sitemap:input', (ctx) => {
    ctx.urls = ctx.urls.filter((url) => {
      const loc = typeof url === 'string' ? url : url?.loc
      // Sources may hand over absolute URLs, so compare on the pathname.
      return !loc || !isRawPath({ rawPrefix }, parseURL(loc).pathname || loc)
    })
  })
})
