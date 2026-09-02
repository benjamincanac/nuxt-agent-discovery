export default defineNuxtConfig({
  modules: ['../../../src/module', '@nuxt/content', 'nuxt-llms'],
  devtools: { enabled: false },
  compatibilityDate: '2026-01-01',
  // English pages prerendered, the French ones left to request time. `/` is
  // not prerendered here, so nothing ever flushes the llms bridge's crawler
  // hint: the twins reach the build through the pages' own responses. Three
  // of the pages are Vue pages the content has no document for: a section
  // (`/en/docs/components`), whose twin redirects, a page with no twin at all
  // (`/en/docs/playground`), and one whose twin the site serves itself
  // (`/en/docs/live`). `failOnError` makes the build itself the assertion
  // that none of those ends up a failed route.
  nitro: {
    prerender: {
      failOnError: true,
      routes: ['/en/docs/getting-started', '/en/docs/components/button', '/en/docs/components', '/en/docs/playground', '/en/docs/live']
    }
  },
  agentDiscovery: {
    siteName: 'i18n',
    // One wildcard segment covers every locale, so the generated CDN route
    // table stays O(patterns) instead of O(locales × pages).
    routes: [{ path: '/', raw: '/raw/index.md' }, '/*/docs/**']
  },
  llms: {
    domain: 'https://i18n.example.com',
    title: 'i18n',
    description: 'Fixture site with locale-prefixed documentation routes.'
  }
})
