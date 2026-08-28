import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // The server utils read their config through Nitro's `#imports`, which
      // only resolves inside a build. The stub lets them be unit tested; the
      // e2e suites run against a real fixture server and never load it.
      '#imports': fileURLToPath(new URL('./test/unit/imports.stub.ts', import.meta.url)),
      // The alias the module points at the site's content adapter, which the
      // server utils import directly. The stub lets a test hand them an
      // adapter of its own, an incomplete one most of all.
      '#agent-discovery/source': fileURLToPath(new URL('./test/unit/source.stub.ts', import.meta.url))
    }
  },
  test: {
    testTimeout: 120000,
    // The e2e suites build and boot fixtures in place, and `vercel.test.ts`
    // runs a second build of the `basic` fixture. Two files sharing a
    // fixture's `.nuxt` directory would clobber each other.
    fileParallelism: false
  }
})
