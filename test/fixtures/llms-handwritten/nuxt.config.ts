export default defineNuxtConfig({
  modules: ['../../../src/module', 'nuxt-llms'],
  devtools: { enabled: false },
  compatibilityDate: '2026-01-01',
  agentDiscovery: {
    siteName: 'Handwritten',
    source: '~~/server/agent-source'
  },
  llms: {
    domain: 'https://handwritten.example.com',
    title: 'Handwritten',
    description: 'Fixture site whose llms sections are all hand-written.',
    full: {
      title: 'Handwritten',
      description: 'The curated documentation.'
    },
    // Every section carries its own links, so the adapter resolves none of
    // them. The site has more pages than these, and neither document may grow
    // the ones it left out.
    sections: [{
      title: 'Docs',
      description: 'The one page this site puts in front of an agent.',
      links: [{ title: 'Alpha', href: '/docs/alpha', description: 'The documented page.' }]
    }, {
      // Hand-written links next to a selector the adapter resolves: the links
      // own the section, so the selector must stay unread in both documents.
      title: 'Mixed',
      description: 'Hand-written links beside a resolvable selector.',
      docs: true,
      links: [{ title: 'Alpha again', href: '/docs/alpha', description: 'The same page, curated by hand.' }]
    }]
  }
})
