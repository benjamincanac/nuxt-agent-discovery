import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { fetch, setup } from '@nuxt/test-utils/e2e'
import {
  BUTTON_MARKDOWN,
  CLAUDE_BOT,
  GETTING_STARTED_LINK,
  GETTING_STARTED_MARKDOWN,
  INDEX_MARKDOWN,
  MARKDOWN_CONTENT_TYPE,
  MARKDOWN_VARY,
  SITE_URL
} from './expected'

/**
 * The migration insurance: the same three pages behind a hand-written content
 * adapter instead of `@nuxt/content`, with no content module installed at all.
 *
 * Both suites assert the *same* expected documents and headers (see
 * `expected.ts`), so a divergence between the two backends fails here or in
 * `basic.test.ts`. Cross-booting both fixtures in one file is not possible:
 * `setup()` boots exactly one fixture per suite.
 */
await setup({
  rootDir: fileURLToPath(new URL('../fixtures/custom-source', import.meta.url)),
  build: true,
  server: true,
  setupTimeout: 300000
})

describe('raw markdown route', () => {
  it('serves the same document `@nuxt/content` does', async () => {
    const response = await fetch('/raw/docs/getting-started.md')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(MARKDOWN_CONTENT_TYPE)
    expect(response.headers.get('vary')).toBe(MARKDOWN_VARY)
    expect(await response.text()).toBe(GETTING_STARTED_MARKDOWN)
  })

  it('serves the same homepage document', async () => {
    const response = await fetch('/raw/index.md')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(MARKDOWN_CONTENT_TYPE)
    expect(await response.text()).toBe(INDEX_MARKDOWN)
  })

  it('404s on an unknown page, as markdown', async () => {
    const response = await fetch('/raw/docs/nonexistent.md')

    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toBe(MARKDOWN_CONTENT_TYPE)
    expect(await response.text()).toContain('# 404 Page Not Found')
  })
})

describe('content negotiation', () => {
  it('serves the same document for the `.md` twin URL', async () => {
    const response = await fetch('/docs/getting-started.md')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(MARKDOWN_CONTENT_TYPE)
    expect(response.headers.get('vary')).toBe(MARKDOWN_VARY)
    expect(response.headers.get('link')).toBe(GETTING_STARTED_LINK)
    expect(await response.text()).toBe(GETTING_STARTED_MARKDOWN)
  })

  it('serves the same document for `Accept: text/markdown`', async () => {
    const response = await fetch('/docs/getting-started', { headers: { Accept: 'text/markdown' } })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(MARKDOWN_CONTENT_TYPE)
    expect(response.headers.get('vary')).toBe(MARKDOWN_VARY)
    expect(await response.text()).toBe(GETTING_STARTED_MARKDOWN)
  })

  it('serves the same document to a known agent user agent', async () => {
    const response = await fetch('/docs/getting-started', { headers: { 'User-Agent': CLAUDE_BOT } })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(MARKDOWN_CONTENT_TYPE)
    expect(response.headers.get('vary')).toBe(MARKDOWN_VARY)
    expect(await response.text()).toBe(GETTING_STARTED_MARKDOWN)
  })

  it('serves the same nested page', async () => {
    const response = await fetch('/docs/components/button', { headers: { Accept: 'text/markdown' } })

    expect(response.status).toBe(200)
    expect(await response.text()).toBe(BUTTON_MARKDOWN)
  })
})

describe('discovery documents', () => {
  // FAILING (module bug, not a test bug): the negotiation middleware treats
  // `/sitemap.md` as the `.md` twin of a page called `/sitemap`, rewrites it
  // to `/raw/sitemap.md` and the raw route 404s. The `@nuxt/content` fixture
  // hides it because `/sitemap.md` is prerendered there and Nitro serves
  // public assets ahead of user middleware. Every adapter-backed site (comark,
  // Docus) hits it. `negotiatedRawPath()` needs to leave the module's own
  // routes alone.
  it('serves `/sitemap.md` from the adapter', async () => {
    const response = await fetch('/sitemap.md')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(MARKDOWN_CONTENT_TYPE)

    const body = await response.text()
    expect(body).toContain('# Basic Sitemap')
    expect(body).toContain(`[Getting Started](${SITE_URL}/docs/getting-started.md)`)
    expect(body).toContain(`[Button](${SITE_URL}/docs/components/button.md)`)
  })

  it('rewrites the `llms.txt` links to their raw markdown twins', async () => {
    const response = await fetch('/llms.txt')

    expect(response.status).toBe(200)

    const body = await response.text()
    expect(body).toContain(`${SITE_URL}/raw/docs/getting-started.md`)
    expect(body).toContain(`${SITE_URL}/raw/docs/components/button.md`)
    expect(body).toContain(`${SITE_URL}/raw/index.md`)
  })
})

describe('@nuxtjs/robots handoff', () => {
  it('contributes the shared agent list and the Content-Signal to its robots.txt', async () => {
    const body = await (await fetch('/robots.txt')).text()

    // This module must not register a competing `/robots.txt`.
    expect(body).toContain('nuxt-robots')
    for (const userAgent of ['ClaudeBot', 'GPTBot', 'PerplexityBot', 'Bytespider']) {
      expect(body).toContain(`User-agent: ${userAgent}`)
    }
    // Rides on the wildcard group, so adding `@nuxtjs/robots` cannot lose it.
    expect(body).toContain('Content-Signal: search=yes, ai-train=yes, ai-input=yes')
  })
})
