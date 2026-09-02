import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fetch, setup, useTestContext } from '@nuxt/test-utils/e2e'
import { vercelMarkdownRoutes } from '../../src/presets/vercel'
import type { NegotiationConfig } from '../../src/runtime/shared/types'
import { CLAUDE_BOT, MARKDOWN_CONTENT_TYPE, MARKDOWN_VARY } from './expected'

const SITE_URL = 'https://i18n.example.com'

/**
 * Locale-prefixed routes: `/*` matches the locale segment, so `en` and `fr`
 * share one pattern and the generated CDN route table never grows with either
 * locales or pages.
 */
await setup({
  rootDir: fileURLToPath(new URL('../fixtures/i18n', import.meta.url)),
  build: true,
  server: true,
  setupTimeout: 300000
})

describe('per-locale negotiation', () => {
  it('negotiates a French page for `Accept: text/markdown`', async () => {
    const response = await fetch('/fr/docs/getting-started', { headers: { Accept: 'text/markdown' } })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(MARKDOWN_CONTENT_TYPE)
    expect(response.headers.get('vary')).toBe(MARKDOWN_VARY)

    const body = await response.text()
    expect(body).toContain('# Démarrage')
    expect(body).toContain(`canonical_url: "${SITE_URL}/fr/docs/getting-started"`)
  })

  it('negotiates a French page for a known agent user agent', async () => {
    const response = await fetch('/fr/docs/getting-started', { headers: { 'User-Agent': CLAUDE_BOT } })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(MARKDOWN_CONTENT_TYPE)
    expect(response.headers.get('vary')).toBe(MARKDOWN_VARY)
    expect(await response.text()).toContain('# Démarrage')
  })

  it('serves the English `.md` twin URL', async () => {
    const response = await fetch('/en/docs/getting-started.md')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(MARKDOWN_CONTENT_TYPE)

    const body = await response.text()
    expect(body).toContain('# Getting Started')
    expect(body).toContain(`canonical_url: "${SITE_URL}/en/docs/getting-started"`)
  })

  it('negotiates a page nested under the locale segment', async () => {
    const response = await fetch('/fr/docs/components/button', { headers: { Accept: 'text/markdown' } })

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('# Bouton')
  })

  it('keeps the homepage on its explicit `raw` destination', async () => {
    const response = await fetch('/', { headers: { Accept: 'text/markdown' } })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(MARKDOWN_CONTENT_TYPE)
    expect(await response.text()).toContain(`canonical_url: "${SITE_URL}"`)
  })

  it('leaves pages outside the patterns as HTML', async () => {
    const response = await fetch('/about', { headers: { Accept: 'text/markdown' } })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
  })
})

describe('sitemap.md destinations', () => {
  it('honours the explicit `raw` destination and agrees with `llms.txt`', async () => {
    const sitemap = await fetch('/sitemap.md').then(response => response.text())
    const llms = await fetch('/llms.txt').then(response => response.text())

    // `{ path: '/', raw: '/raw/index.md' }`. Hand-rolling the twin here sent
    // `/` to the HTML page while `llms.txt` sent it to the override.
    expect(sitemap).toContain(`(${SITE_URL}/raw/index.md)`)
    expect(llms).toContain(`${SITE_URL}/raw/index.md`)
    expect(sitemap).toContain(`(${SITE_URL}/raw/en/docs/getting-started.md)`)
    expect(sitemap).toContain(`(${SITE_URL}/raw/fr/docs/getting-started.md)`)
    // `/about` matches no pattern, so it stays the page URL, absolute.
    expect(sitemap).toContain(`(${SITE_URL}/about)`)
  })
})

/**
 * The route table is generated from `agentDiscovery.routes` alone, so it is
 * O(patterns) and never O(pages). Docus generates two Vercel routes per link
 * found in the built `llms.txt` instead, which is what this pattern form
 * replaces.
 */
describe('O(1) route table', () => {
  // The config the module resolved, read off the running fixture. Asserting
  // against a literal here would restate `nuxt.config` and pass even if the
  // module expanded the locale wildcard into one pattern per locale, which is
  // the one thing this fixture exists to catch.
  // Fetched on first use rather than in `beforeAll`, which runs before
  // `setup()` has published its context.
  let cached: NegotiationConfig | undefined
  const resolved = async () => (cached ??= await fetch('/agent-config.json').then(response => response.json()) as NegotiationConfig)

  it('keeps the locale a wildcard instead of enumerating the locales', async () => {
    const config = await resolved()

    expect(config.routes.map(route => route.path)).toEqual(['/', '/*/docs/**'])
    // The twin file the site serves itself, as the pattern Nitro registers.
    expect(config.ownRawRoutes).toContain('/raw/en/docs/live.md')
    // The fixture ships `en` and `fr`; neither may appear as a pattern.
    expect(config.routes.some(route => /\/(?:en|fr)\//.test(route.path))).toBe(false)
  })

  it('emits the closed-form number of routes for the resolved patterns', async () => {
    const config = await resolved()
    const routes = vercelMarkdownRoutes(config)
    const exact = config.routes.filter(route => !route.path.includes('*')).length
    const glob = config.routes.filter(route => route.path.includes('*')).length

    // 3 header routes (`Vary` on the pages, `Vary` on the markdown twins,
    // `Link`) + 3 per exact path (the negotiated pair and the canonical
    // `Link` on its raw twin) + 5 per glob (three rewrites and the canonical
    // `Link` pair on both twin spaces), and nothing that scales with the 5
    // content files or the 2 locales.
    expect(routes).toHaveLength(3 + exact * 3 + glob * 5)
  })

  it('captures the locale segment rather than enumerating locales', async () => {
    const routes = vercelMarkdownRoutes(await resolved())
    const localeRewrites = routes.filter(route => route.dest?.includes('$'))

    // One `.md` twin rewrite plus the two negotiated ones, all three sharing
    // the same locale capture.
    expect(localeRewrites).toHaveLength(3)
    expect(localeRewrites.every(route => route.dest === '/raw/$1/docs/$2.md')).toBe(true)
    expect(localeRewrites.some(route => route.has?.some(has => has.key === 'accept'))).toBe(true)
    expect(localeRewrites.some(route => route.has?.some(has => has.key === 'user-agent' && new RegExp(has.value).test('ClaudeBot/1.0')))).toBe(true)

    // The homepage keeps its explicit `raw` destination.
    expect(routes.filter(route => route.dest === '/raw/index.md')).toHaveLength(2)
  })

  it('never names a locale or a page', async () => {
    const serialized = JSON.stringify(vercelMarkdownRoutes(await resolved()))

    for (const fragment of ['/en', '/fr', 'getting-started', 'button', 'about']) {
      expect(serialized).not.toContain(fragment)
    }
  })

  it('stays smaller than a per-page table for the pages the fixture serves', async () => {
    const sitemap = await fetch('/sitemap.md').then(response => response.text())
    const pages = sitemap.split('\n').filter(line => line.startsWith('- [')).length
    const routes = vercelMarkdownRoutes(await resolved())

    expect(pages).toBeGreaterThanOrEqual(5)
    // A per-link table (two routes per page) would already be larger here and
    // would keep growing; this one does not move with the page count.
    expect(routes.length).toBeLessThan(pages * 2)
  })
})

describe('openapi operation ids', () => {
  it('keeps the locale pattern apart from the homepage and its twin', async () => {
    const doc = (await (await fetch('/openapi.json')).json()) as { paths: Record<string, { get: { operationId: string } }> }
    const ids = Object.fromEntries(Object.entries(doc.paths).map(([path, item]) => [path, item.get.operationId]))

    // Two page patterns, each with a raw twin: four operations that all have to
    // come out with different names.
    expect(ids).toMatchObject({
      '/': 'getHomepage',
      '/raw/index.md': 'getHomepageMarkdown',
      '/{segment}/docs/{path}': 'getSegmentDocsPage',
      '/raw/{segment}/docs/{path}.md': 'getSegmentDocsPageMarkdown'
    })
    expect(new Set(Object.values(ids)).size).toBe(Object.values(ids).length)
  })

  it('describes no MCP endpoint on a site that declares no server card', async () => {
    // The endpoint rides on `discovery.mcpServerCard`, so a site without one
    // gets neither path rather than an endpoint nothing answers.
    const doc = (await (await fetch('/openapi.json')).json()) as { paths: Record<string, unknown> }

    expect(doc.paths).not.toHaveProperty(['/mcp'])
    expect(doc.paths).not.toHaveProperty(['/.well-known/mcp/server-card.json'])
  })
})

describe('prerender', () => {
  // `@nuxt/test-utils` builds under a random `.nuxt/test/<id>/output`.
  const built = (path: string) => existsSync(join(useTestContext().nuxt!.options.nitro.output!.dir!, 'public', path))

  it('prerenders the twin of every prerendered page', () => {
    // A locale-prefixed site never renders `/`, and Nitro drops the hint the
    // llms bridge puts on `/llms.txt` with the rest of a `text/plain`
    // response, so the page's own HTML response is what carries its twin.
    expect(built('/en/docs/getting-started/index.html') || built('/en/docs/getting-started.html')).toBe(true)
    expect(built('/raw/en/docs/getting-started.md')).toBe(true)
    expect(built('/raw/en/docs/components/button.md')).toBe(true)
  })

  it('leaves the twin of a request-time page to request time', () => {
    expect(built('/fr/docs/getting-started/index.html') || built('/fr/docs/getting-started.html')).toBe(false)
    expect(built('/raw/fr/docs/getting-started.md')).toBe(false)
  })

  it('drops the twin of a section instead of storing its redirect as HTML', async () => {
    // `/en/docs/components` is a Vue page over a directory with no index
    // document, so its twin answers a 302 to the first document. Nitro reads
    // a redirect as a success and would write the HTML refresh stub h3 sends
    // with it, which the static handler then serves in place of the 302.
    expect(built('/en/docs/components/index.html') || built('/en/docs/components.html')).toBe(true)
    expect(built('/raw/en/docs/components.md')).toBe(false)
    expect(built('/raw/en/docs/components.md/index.html')).toBe(false)
    expect(built('/raw/en/docs/components.md.html')).toBe(false)

    const response = await fetch('/raw/en/docs/components.md', { redirect: 'manual' })
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/raw/en/docs/components/button.md')
  })

  it('skips the twin of a page with no document rather than failing the build', async () => {
    // The fixture builds with `failOnError`, so the 404 this twin answers
    // would have failed the whole suite had it been reported.
    expect(built('/en/docs/playground/index.html') || built('/en/docs/playground.html')).toBe(true)
    expect(built('/raw/en/docs/playground.md')).toBe(false)
    expect((await fetch('/raw/en/docs/playground.md')).status).toBe(404)
  })

  it('leaves a twin the site serves itself to its handler, under a wildcard route too', async () => {
    expect(built('/en/docs/live/index.html') || built('/en/docs/live.html')).toBe(true)
    expect(built('/raw/en/docs/live.md')).toBe(false)

    const response = await fetch('/raw/en/docs/live.md')
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('# Live')
    // Answered by the handler, not off a file: Nitro's asset layer would add
    // an `ETag`.
    expect(response.headers.get('etag')).toBe(null)
  })
})
