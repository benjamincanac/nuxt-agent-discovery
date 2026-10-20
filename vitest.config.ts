import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: [
      // The server utils read their config through `nitropack/runtime`, which
      // only resolves inside a build. The stub lets them be unit tested; the
      // e2e suites run against a real fixture server and never load it.
      { find: /^nitropack\/runtime$/, replacement: fileURLToPath(new URL('./test/unit/nitro.stub.ts', import.meta.url)) },
      // The same for `nuxt/server`, which the Nuxt 5 variants import. Both stubs
      // read one config, so a test runs either variant against the same state.
      { find: /^nuxt\/server$/, replacement: fileURLToPath(new URL('./test/unit/nuxt-server.stub.ts', import.meta.url)) },
      // The alias the module points at the server layer the host runs. The
      // Nitro 2 one by default, a test swaps in the other with `vi.mock`.
      { find: '#agent-discovery/server', replacement: fileURLToPath(new URL('./src/runtime/server/utils/server.legacy.ts', import.meta.url)) },
      // The alias the module points at the site's content adapter, which the
      // server utils import directly. The stub lets a test hand them an
      // adapter of its own, an incomplete one most of all.
      { find: '#agent-discovery/source', replacement: fileURLToPath(new URL('./test/unit/source.stub.ts', import.meta.url)) }
    ]
  },
  test: {
    testTimeout: 120000,
    // The e2e suites build and boot fixtures in place, and `vercel.test.ts`
    // runs a second build of the `basic` fixture. Two files sharing a
    // fixture's `.nuxt` directory would clobber each other.
    fileParallelism: false
  }
})
