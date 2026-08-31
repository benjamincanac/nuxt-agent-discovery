export default defineNuxtConfig({
  modules: ['../../../src/module', 'nuxt-llms'],
  devtools: { enabled: false },
  compatibilityDate: '2026-01-01',
  agentDiscovery: {
    siteName: 'Narrow',
    source: '~~/server/agent-source',
    // Only `/docs/**` negotiates markdown. The curated section still names a
    // page outside it, which is the section's call: listing a page and
    // negotiating it are two different promises.
    routes: ['/docs/**']
  },
  llms: {
    domain: 'https://narrow.example.com',
    title: 'Narrow',
    description: 'Fixture site whose routes cover less than its curation.',
    full: {
      title: 'Narrow',
      description: 'The curated documentation.'
    },
    sections: [{
      title: 'Guide',
      description: 'Curated by hand, partly outside the negotiated routes.',
      links: [{ title: 'Intro', href: '/guide/intro', description: 'A page outside `routes`.' }]
    }]
  }
})
