export default defineNuxtConfig({
  // `@nuxtjs/robots` first, so this fixture proves the integration works
  // even when the robots module reads its own options before ours runs.
  modules: ['@nuxtjs/robots', '../../../src/module', 'nuxt-llms'],
  devtools: { enabled: false },
  compatibilityDate: '2026-01-01',
  agentDiscovery: {
    siteName: 'Basic',
    // No `@nuxt/content` here: the same three pages come from a hand-written
    // adapter, which is the file a site swaps when it changes content backend.
    source: '~~/server/agent-source'
  },
  llms: {
    domain: 'https://basic.example.com',
    title: 'Basic',
    description: 'Fixture site for the nuxt-agent-discovery e2e tests.',
    full: {
      title: 'Basic',
      description: 'The full fixture documentation.'
    }
  }
})
