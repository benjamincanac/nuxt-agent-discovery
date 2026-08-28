import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { fetch, setup } from '@nuxt/test-utils/e2e'
import { MARKDOWN_CONTENT_TYPE, MARKDOWN_VARY, SITE_URL } from './expected'
import { describeSharedDocuments } from './shared'

/**
 * The migration insurance: the same three pages behind a hand-written content
 * adapter instead of `@nuxt/content`, with no content module installed at all.
 *
 * The shared documents come from `describeSharedDocuments()`, which every
 * adapter fixture runs against the same expected bytes, so a divergence
 * between backends fails in whichever suite drifted. Cross-booting the
 * fixtures in one file is not possible: `setup()` boots exactly one per
 * suite.
 */
await setup({
  rootDir: fileURLToPath(new URL('../fixtures/custom-source', import.meta.url)),
  build: true,
  server: true,
  setupTimeout: 300000
})

describeSharedDocuments()

describe('content negotiation', () => {
  // `notAcceptable` is off here, which is the default. The strict answer would
  // be a 406, and turning it on is the site's call: see the `basic` fixture.
  it('serves the page for an `Accept` allowing neither representation', async () => {
    const response = await fetch('/docs/getting-started', { headers: { Accept: 'application/xml' } })

    expect(response.status).not.toBe(406)
  })

  // The route slug is decoded before the adapter sees it, so the canonical URL
  // built from it carries the raw CJK unless something encodes it again. Node
  // refuses to write a header byte above U+00FF, so getting this wrong is a 500
  // on the response rather than a wrong URL in it.
  it('serves a page whose route needs percent-encoding', async () => {
    const response = await fetch('/raw/guide/%E6%96%87%E6%A1%A3.md')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(MARKDOWN_CONTENT_TYPE)

    const link = response.headers.get('link')
    expect(link).toContain(`${SITE_URL}/guide/%E6%96%87%E6%A1%A3`)
    expect(link).not.toContain('文档')

    const body = await response.text()
    expect(body).toContain(`canonical_url: "${SITE_URL}/guide/%E6%96%87%E6%A1%A3"`)
    expect(body).toContain('# 文档')
  })

  it('negotiates the same page from its encoded HTML URL', async () => {
    const response = await fetch('/guide/%E6%96%87%E6%A1%A3', { headers: { Accept: 'text/markdown' } })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(MARKDOWN_CONTENT_TYPE)
    expect(await response.text()).toContain('# 文档')
  })
})

describe('discovery documents', () => {
  // Without the `/sitemap.md` exclusion the module adds, the negotiation
  // middleware would treat this as the `.md` twin of a page called
  // `/sitemap`, rewrite it to `/raw/sitemap.md` and 404. The `@nuxt/content`
  // fixture hides that because `/sitemap.md` is prerendered there and Nitro
  // serves public assets ahead of user middleware, so this is the fixture
  // that covers it for every adapter-backed site.
  //
  // Only the case where the module owns the route, though. A site serving its
  // own `/sitemap.md` needs the same exclusion, which is keyed on the
  // registered link rather than on this branch: see the `sitemap.md exclusion`
  // unit tests.
  it('serves `/sitemap.md` from the adapter', async () => {
    const response = await fetch('/sitemap.md')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(MARKDOWN_CONTENT_TYPE)
    // Asserted here rather than in the shared documents for the same reason:
    // the `@nuxt/content` fixture prerenders this file, so the handler that
    // sets the header never runs there. On Vercel the CDN route covers it, see
    // the `Vary on the markdown representations` unit tests.
    expect(response.headers.get('vary')).toBe(MARKDOWN_VARY)

    const body = await response.text()
    expect(body).toContain('# Basic Sitemap')
    expect(body).toContain(`[Basic](${SITE_URL}/raw/index.md)`)
    expect(body).toContain(`[Getting Started](${SITE_URL}/raw/docs/getting-started.md)`)
    expect(body).toContain(`[Button](${SITE_URL}/raw/docs/components/button.md)`)
  })

  // The section labels are looked up in a plain record, so a section named
  // after an `Object.prototype` member used to resolve to the prototype's own
  // value and print the source of `Object` as a heading.
  it('labels a section named after an `Object.prototype` member from its key', async () => {
    const body = await (await fetch('/sitemap.md')).text()

    expect(body).toContain('## Constructor')
    expect(body).not.toContain('native code')
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

