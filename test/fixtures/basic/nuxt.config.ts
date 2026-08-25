export default defineNuxtConfig({
  modules: ['../../../src/module', '@nuxt/content', 'nuxt-llms'],
  devtools: { enabled: false },
  compatibilityDate: '2026-01-01',
  // Multi-theme highlighting makes the highlighter append a `<style>` node
  // carrying the per-document CSS variables, which the raw markdown must not
  // expose (see the `style` stripping in the `@nuxt/content` source).
  content: {
    build: {
      markdown: {
        highlight: {
          langs: ['ts'],
          theme: {
            default: 'material-theme',
            light: 'material-theme-lighter',
            dark: 'material-theme-palenight'
          }
        }
      }
    }
  },
  compatibilityDate: '2026-01-01',

  agentDiscovery: {
    siteName: 'Basic'
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
