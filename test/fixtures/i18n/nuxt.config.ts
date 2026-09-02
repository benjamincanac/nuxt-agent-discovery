export default defineNuxtConfig({
  modules: ['../../../src/module', '@nuxt/content', 'nuxt-llms'],
  devtools: { enabled: false },
  compatibilityDate: '2026-01-01',
  // Two pages prerendered, the French ones left to request time. `/` is not
  // prerendered here, so nothing ever flushes the llms bridge's crawler hint:
  // the twins below reach the build through the pages' own responses.
  nitro: {
    prerender: {
      routes: ['/en/docs/getting-started', '/en/docs/components/button']
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
