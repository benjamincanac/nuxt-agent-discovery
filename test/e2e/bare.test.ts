import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { fetch, setup, url } from '@nuxt/test-utils/e2e'

/**
 * The empty-`siteUrl` deployment: every document embedding the site URL
 * resolves it from the request origin, so none of them may enter a shared
 * cache. The other fixtures all configure a URL and keep the cacheable
 * headers, which their own suites assert.
 */
await setup({
  rootDir: fileURLToPath(new URL('../fixtures/bare', import.meta.url)),
  build: true,
  server: true,
  setupTimeout: 300000
})

describe('host-dependent documents without a site URL', () => {
  it('keeps the api-catalog out of shared caches', async () => {
    const response = await fetch('/.well-known/api-catalog')

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-cache')
  })

  it('keeps robots.txt out of shared caches', async () => {
    const response = await fetch('/robots.txt')

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-cache')
  })

  it('keeps sitemap.md out of shared caches', async () => {
    const response = await fetch('/sitemap.md')

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-cache')
  })

  it('keeps the raw documents out of shared caches and derives their canonical from the request', async () => {
    const response = await fetch('/raw/docs/alpha.md')

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-cache')

    // The canonical URL is the test server's own origin: derived per request.
    const origin = new URL(url('/')).origin
    expect(await response.text()).toContain(`canonical_url: "${origin}/docs/alpha"`)
  })
})
