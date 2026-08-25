export default defineNuxtConfig({
  modules: ['../../../src/module', '@nuxt/content', 'nuxt-llms'],
  devtools: { enabled: false },
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
    siteName: 'Basic',
    // `/agent-resources.md` is served by its own handler, so it has to be
    // excluded or the catch-all route pattern would rewrite it to its raw twin.
    excludePrefixes: ['/_', '/api/', '/mcp', '/.well-known/', '/agent-resources.md', '/openapi.json'],
    sitemap: {
      markdown: {
        // `/docs/**` splits into a section per area; anything else stays whole.
        expand: ['/docs'],
        labels: { components: 'UI Components' }
      }
    },
    discovery: {
      mcpServerCard: {
        endpoint: '/mcp',
        name: 'Basic',
        documentation: '/docs/getting-started'
      }
    }
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
