import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { fetch, setup } from '@nuxt/test-utils/e2e'
import { MARKDOWN_CONTENT_TYPE, SITE_URL } from './expected'
import { describeSharedDocuments } from './shared'

/**
 * The same site as `basic`, on `comark-content` instead of `@nuxt/content`.
 *
 * This is the design's migration insurance: identical content, identical
 * config, one different adapter file, and every document has to come out byte
 * for byte the same. Built rather than run in dev on purpose, because bundling
 * `comark-content` into the Nitro output is one of the things most likely to
 * break in a real adoption.
 */
await setup({
  rootDir: fileURLToPath(new URL('../fixtures/comark', import.meta.url)),
  build: true,
  server: true,
  setupTimeout: 300000
})

describeSharedDocuments()

describe('comark source', () => {
  it('renders a raw document on the request, not off a prerendered file', async () => {
    const response = await fetch('/raw/about.md')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(MARKDOWN_CONTENT_TYPE)
    expect(await response.text()).toContain('# About')

    // The point of the assertion. A request-time backend has no build-time
    // page list, so the module prerenders nothing for it and every raw twin
    // has to be rendered per request. The two headers say which path served
    // this: the raw handler sets `Link`, while a file served off disk by
    // Nitro's asset layer gets `ETag`/`Last-Modified` and no `Link`.
    expect(response.headers.get('link')).toContain('rel="canonical"')
    expect(response.headers.get('etag')).toBe(null)
  })

  it('redirects a section path to its first document', async () => {
    const response = await fetch('/raw/docs.md', { redirect: 'manual' })

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toMatch(/^\/raw\/docs\/.+\.md$/)
  })

  it('drops a section whose selector belongs to another adapter', async () => {
    const body = await (await fetch('/llms.txt')).text()

    // `contentCollection` is `@nuxt/content`'s key. The comark adapter returns
    // null for it, and the bridge splices the section out rather than leaving
    // a heading with no pages under it.
    expect(body).toContain('## Documentation')
    expect(body).not.toContain('## Legacy')
  })

  it('renders `llms-full.txt` through the same adapter as the raw route', async () => {
    const full = await (await fetch('/llms-full.txt')).text()
    const page = await (await fetch('/raw/docs/getting-started.md')).text()

    // The body only, since the raw route adds frontmatter of its own.
    const body = page.slice(page.indexOf('# Getting Started'), page.indexOf('## Sitemap')).trim()
    expect(full).toContain(body)
  })

  it('keeps the raw prefix absolute in the documents it serves', async () => {
    const body = await (await fetch('/raw/index.md')).text()

    expect(body).toContain(`${SITE_URL}/docs/getting-started`)
  })
})
