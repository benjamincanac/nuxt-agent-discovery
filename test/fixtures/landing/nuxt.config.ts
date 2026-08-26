export default defineNuxtConfig({
  modules: ['../../../src/module', 'nuxt-llms'],
  devtools: { enabled: false },
  // Everything under `/docs` is cached, like a site running ISR end to end.
  // Request-time negotiation has to switch itself off there.
  routeRules: {
    '/docs/**': { swr: 60 }
  },
  compatibilityDate: '2026-01-01',
  agentDiscovery: {
    siteName: 'Landing',
    siteUrl: 'https://landing.example.com',
    source: '~~/server/agent-source'
  },
  llms: {
    domain: 'https://landing.example.com',
    title: 'Landing',
    description: 'Fixture whose landing page is a Vue page, not a document.'
  }
})
