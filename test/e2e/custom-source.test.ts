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
