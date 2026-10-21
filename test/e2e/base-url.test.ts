import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { fetch, setup } from '@nuxt/test-utils/e2e'
import { MARKDOWN_CONTENT_TYPE } from './expected'

/**
 * A site under `app.baseURL`. Routes, the raw prefix and the registry are all
 * written from the app root, so everything that leaves the server as a URL has
 * to put the base back.
 */
await setup({
  rootDir: fileURLToPath(new URL('../fixtures/base-url', import.meta.url)),
  build: true,
  server: true,
  setupTimeout: 300000
})

const SITE_URL = 'https://example.com/project'

describe('a site under a base path', () => {
  it('negotiates a page below the base', async () => {
    const response = await fetch('/project/docs/alpha', { headers: { Accept: 'text/markdown' } })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(MARKDOWN_CONTENT_TYPE)
    expect(await response.text()).toContain(`canonical_url: "${SITE_URL}/docs/alpha"`)
  })

  it('serves the twin with its canonical under the base', async () => {
    const response = await fetch('/project/docs/alpha.md')

    expect(response.status).toBe(200)
    expect(response.headers.get('link')).toBe(`<${SITE_URL}/docs/alpha>; rel="canonical", <${SITE_URL}/docs/alpha>; rel="alternate"; type="text/html"`)
  })

  it('absolutizes the links of a document under the base', async () => {
    const response = await fetch('/project/raw/index.md')

    expect(await response.text()).toContain(`[docs](${SITE_URL}/docs/alpha)`)
  })

  it('redirects a cached page to its twin under the base', async () => {
    const response = await fetch('/project/docs/cached/beta?ref=x', { headers: { Accept: 'text/markdown' }, redirect: 'manual' })

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('/project/raw/docs/cached/beta.md?ref=x')
  })

  it('points the `Link` header on the homepage below the base', async () => {
    const response = await fetch('/project/', { headers: { Accept: 'text/html' } })

    expect(response.status).toBe(200)
    expect(response.headers.get('link')).toContain('</project/llms.txt>; rel="describedby"')
    expect(response.headers.get('link')).not.toMatch(/<\/(?!project\/)/)
  })

  it('links `llms.txt` under the base, from a bare-origin `llms.domain`', async () => {
    const response = await fetch('/project/llms.txt')

    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).toContain(`- [Alpha](${SITE_URL}/raw/docs/alpha.md)`)
    expect(body).toContain(`- [Beta](${SITE_URL}/raw/docs/cached/beta.md)`)
    expect(body).not.toContain('https://example.com/raw/')
  })

  it('links `sitemap.md` under the base', async () => {
    const response = await fetch('/project/sitemap.md')

    expect(response.status).toBe(200)
    expect(await response.text()).toContain(`(${SITE_URL}/raw/docs/alpha.md)`)
  })
})
