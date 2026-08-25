import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    testTimeout: 120000,
    // The e2e suites build and boot fixtures in place, and `vercel.test.ts`
    // runs a second build of the `basic` fixture. Two files sharing a
    // fixture's `.nuxt` directory would clobber each other.
    fileParallelism: false
  }
})
