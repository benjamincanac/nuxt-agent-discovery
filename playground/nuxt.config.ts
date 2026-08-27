// Preview deployments answer on the deployment URL, production on the project domain.
const vercelUrl = process.env.VERCEL_ENV === 'production'
  ? process.env.VERCEL_PROJECT_PRODUCTION_URL
  : process.env.VERCEL_URL

export default defineNuxtConfig({
  modules: ['../src/module', '@nuxt/content', 'nuxt-llms'],
  devtools: { enabled: true },
  content: {
    experimental: {
      nativeSqlite: true
    }
  },
  compatibilityDate: '2026-01-01',
  // `/docs/**` is cached, the rest of the site is not. That split is the point:
  // a cached pattern has to 307 to its raw twin, because a response cache keys
  // on the path alone and would otherwise serve one visitor's markdown to the
  // next, while everything outside it keeps a URL-preserving rewrite.
  routeRules: {
    '/docs/**': { isr: 60 }
  },
  nitro: {
    output: {
      // Vercel reads the build output from the repository root, not from the playground.
      dir: process.env.VERCEL ? '../.vercel/output' : undefined
    }
  },
  agentDiscovery: {
    siteName: 'Agent Discovery Playground'
  },
  llms: {
    domain: vercelUrl ? `https://${vercelUrl}` : 'https://agent-discovery.example.com',
    title: 'Agent Discovery Playground',
    description: 'Playground for the nuxt-agent-discovery module.',
    full: {
      title: 'Agent Discovery Playground',
      description: 'The full playground documentation.'
    }
  }
})
