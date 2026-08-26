import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  modules: ['../../../src/module', 'nuxt-llms'],
  devtools: { enabled: false },
  runtimeConfig: {
    // Absolute, resolved while the config is evaluated. `@nuxt/test-utils`
    // spawns the built server without a `cwd` of its own, so a relative path
    // would resolve against vitest's, the repo root rather than this fixture.
    contentDir: fileURLToPath(new URL('./content', import.meta.url))
  },
  compatibilityDate: '2026-01-01',
  agentDiscovery: {
    siteName: 'Basic',
    // Same pages as `basic`, served by `comark-content` instead of
    // `@nuxt/content`. This one file is the whole difference between the two
    // sites, which is the promise the content-adapter seam makes.
    source: '~~/server/utils/agent-source'
  },
  llms: {
    domain: 'https://basic.example.com',
    title: 'Basic',
    description: 'Fixture site for the nuxt-agent-discovery e2e tests.',
    full: {
      title: 'Basic',
      description: 'The full fixture documentation.'
    },
    sections: [
      // comark's own selector key, resolved by the adapter's `list()`.
      { title: 'Documentation', navigation: '/docs' },
      // `@nuxt/content`'s key, left behind by a site that swapped backend.
      // The comark adapter does not claim it, so the bridge drops the section
      // rather than rendering an empty heading.
      { title: 'Legacy', contentCollection: 'docs' }
    ]
  }
})
