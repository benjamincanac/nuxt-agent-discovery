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
    // table stays O(patterns) instead of O(locales × pages). The locale roots
    // are outside it on purpose: the module appends them itself.
    routes: [{ path: '/', raw: '/raw/index.md' }, '/*/docs/**']
  },
  // Read by the homepage detection off the stub module in `modules/i18n.ts`,
  // which carries the `@nuxtjs/i18n` name. `prefix` is what Docus forces, so
  // both locale roots are landing pages and `/` only redirects browsers.
  i18n: {
    locales: [{ code: 'en', name: 'English' }, { code: 'fr', name: 'Français' }],
    defaultLocale: 'en',
    strategy: 'prefix'
  },
  llms: {
    domain: 'https://i18n.example.com',
    title: 'i18n',
    description: 'Fixture site with locale-prefixed documentation routes.',
    // The full document is where the locale landings have to carry their
    // resources block too, byte for byte with their twins.
    full: {
      title: 'i18n',
      description: 'Fixture site with locale-prefixed documentation routes.'
    }
  }
})
