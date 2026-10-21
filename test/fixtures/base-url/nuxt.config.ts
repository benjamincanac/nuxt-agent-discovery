export default defineNuxtConfig({
  // A site served under a base path, as a GitLab Pages project site is. The
  // site URL carries the base while the `llms.domain` is the bare origin, which
  // is how both get written in practice.
  modules: ['../../../src/module', 'nuxt-llms'],
  devtools: { enabled: false },
  app: { baseURL: '/project/' },
  // A cached section, so the middleware answers with its redirect.
  routeRules: {
    '/docs/cached/**': { cache: { maxAge: 60 } }
  },
  compatibilityDate: '2026-01-01',
  agentDiscovery: {
    siteUrl: 'https://example.com/project',
    source: '~~/server/agent-source'
  },
  llms: {
    domain: 'https://example.com',
    title: 'Base URL',
    description: 'Fixture served under a base path.',
    // Written both ways: a route, and an absolute URL carrying the base.
    sections: [{
      title: 'Handwritten',
      links: [
        { title: 'Alpha', href: '/docs/alpha' },
        { title: 'Beta', href: 'https://example.com/project/docs/cached/beta' }
      ]
    }]
  }
})
