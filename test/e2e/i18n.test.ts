import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { fetch, setup } from '@nuxt/test-utils/e2e'
import { AGENT_USER_AGENTS, EXCLUDE_PREFIXES } from '../../src/defaults'
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
  const config: NegotiationConfig = {
    siteUrl: SITE_URL,
    siteName: 'i18n',
    rawPrefix: '/raw',
    routes: [{ path: '/', raw: '/raw/index.md' }, { path: '/*/docs/**' }],
    userAgents: AGENT_USER_AGENTS,
    excludePrefixes: EXCLUDE_PREFIXES,
    links: [{ href: '/llms.txt', rel: 'describedby', type: 'text/plain', title: 'llms.txt' }],
    linkHeader: true,
    cachedRoutes: [],
    sitemapSections: { expand: [], labels: {} }
  }

  it('emits the closed-form number of routes for the fixture patterns', () => {
    const routes = vercelMarkdownRoutes(config)
    const exact = config.routes.filter(route => !route.path.includes('*')).length
    const glob = config.routes.filter(route => route.path.includes('*')).length

    // 2 header routes (`Vary`, `Link`) + 2 per exact path + 3 per glob.
    expect(routes).toHaveLength(2 + exact * 2 + glob * 3)
    expect(routes).toHaveLength(7)
  })

  it('captures the locale segment rather than enumerating locales', () => {
    const routes = vercelMarkdownRoutes(config)
    const localeRewrites = routes.filter(route => route.dest?.includes('$'))

    // One `.md` twin rewrite plus the two negotiated ones, all three sharing
    // the same locale capture.
    expect(localeRewrites).toHaveLength(3)
    expect(localeRewrites.every(route => route.dest === '/raw/$1/docs/$2.md')).toBe(true)
    expect(localeRewrites.some(route => route.has?.some(has => has.key === 'accept'))).toBe(true)
    expect(localeRewrites.some(route => route.has?.some(has => has.key === 'user-agent' && has.value.includes('ClaudeBot')))).toBe(true)

    // The homepage keeps its explicit `raw` destination.
    expect(routes.filter(route => route.dest === '/raw/index.md')).toHaveLength(2)
  })

  it('never names a locale or a page', () => {
    const serialized = JSON.stringify(vercelMarkdownRoutes(config))

    for (const fragment of ['/en', '/fr', 'getting-started', 'button', 'about']) {
      expect(serialized).not.toContain(fragment)
    }
  })

  it('stays smaller than a per-page table for the pages the fixture serves', async () => {
    const sitemap = await fetch('/sitemap.md').then(response => response.text())
    const pages = sitemap.split('\n').filter(line => line.startsWith('- [')).length

    expect(pages).toBeGreaterThanOrEqual(5)
    // A per-link table (two routes per page) would already be larger here and
    // would keep growing; this one is fixed at 7.
    expect(vercelMarkdownRoutes(config)).toHaveLength(7)
    expect(vercelMarkdownRoutes(config).length).toBeLessThan(pages * 2)
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
