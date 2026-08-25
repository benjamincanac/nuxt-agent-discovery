export default defineNuxtConfig({
  modules: ['../src/module', '@nuxt/content', 'nuxt-llms'],
  devtools: { enabled: true },
  compatibilityDate: '2026-01-01',
  agentDiscovery: {
    siteName: 'Agent Discovery Playground'
  },
  llms: {
    domain: 'https://agent-discovery.example.com',
    title: 'Agent Discovery Playground',
    description: 'Playground for the nuxt-agent-discovery module.',
    full: {
      title: 'Agent Discovery Playground',
      description: 'The full playground documentation.'
    }
  }
})
