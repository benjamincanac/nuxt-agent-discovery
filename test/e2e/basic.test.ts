import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { fetch, setup } from '@nuxt/test-utils/e2e'
import {
  BROWSER_ACCEPT,
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
 * The `@nuxt/content` fixture, built and served on the Node preset. Covers the
 * acceptance criteria that don't need the edge: negotiation on a page, the
 * `.md` twin, `Vary`, the markdown 404, and the discovery documents.
 */
await setup({
  rootDir: fileURLToPath(new URL('../fixtures/basic', import.meta.url)),
  build: true,
  server: true,
  setupTimeout: 300000
})

describe('content negotiation', () => {
  it('serves markdown for an explicit `Accept: text/markdown`', async () => {
    const response = await fetch('/docs/getting-started', { headers: { Accept: 'text/markdown' } })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(MARKDOWN_CONTENT_TYPE)
    expect(response.headers.get('vary')).toBe(MARKDOWN_VARY)

    const body = await response.text()
    expect(body).toContain('# Getting Started')
    expect(body).toContain(`canonical_url: "${SITE_URL}/docs/getting-started"`)
    expect(body).toBe(GETTING_STARTED_MARKDOWN)
  })

  it('serves markdown to a known agent user agent without an `Accept` header', async () => {
    const response = await fetch('/docs/getting-started', { headers: { 'User-Agent': CLAUDE_BOT } })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(MARKDOWN_CONTENT_TYPE)
    expect(response.headers.get('vary')).toBe(MARKDOWN_VARY)
    expect(await response.text()).toBe(GETTING_STARTED_MARKDOWN)
  })

  it('serves markdown for the explicit `.md` twin URL', async () => {
    const response = await fetch('/docs/getting-started.md')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(MARKDOWN_CONTENT_TYPE)
    expect(response.headers.get('vary')).toBe(MARKDOWN_VARY)
    expect(response.headers.get('link')).toBe(GETTING_STARTED_LINK)
    expect(await response.text()).toBe(GETTING_STARTED_MARKDOWN)
  })

  it('serves the raw markdown route directly', async () => {
    const response = await fetch('/raw/docs/getting-started.md')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(MARKDOWN_CONTENT_TYPE)
    expect(response.headers.get('vary')).toBe(MARKDOWN_VARY)
    expect(await response.text()).toBe(GETTING_STARTED_MARKDOWN)
  })

  it('negotiates nested pages too', async () => {
    const response = await fetch('/docs/components/button', { headers: { Accept: 'text/markdown' } })

    expect(response.status).toBe(200)
    expect(await response.text()).toBe(BUTTON_MARKDOWN)
  })

  it('maps the homepage to its `/raw/index.md` twin', async () => {
    const response = await fetch('/', { headers: { Accept: 'text/markdown' } })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(MARKDOWN_CONTENT_TYPE)
    expect(await response.text()).toBe(INDEX_MARKDOWN)
  })

  it('keeps HTML for a browser `Accept`', async () => {
    const response = await fetch('/docs/getting-started', { headers: { Accept: BROWSER_ACCEPT } })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(await response.text()).toContain('<!DOCTYPE html>')
  })

  it('keeps HTML when markdown is explicitly refused with `q=0`', async () => {
    const response = await fetch('/docs/getting-started', { headers: { Accept: 'text/markdown;q=0, text/html' } })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
  })

  it('keeps HTML when html outranks markdown', async () => {
    const response = await fetch('/docs/getting-started', { headers: { Accept: 'text/markdown;q=0.4, text/html;q=0.9' } })

    expect(response.headers.get('content-type')).toContain('text/html')
  })
})

describe('errors', () => {
  it('answers an unknown page with markdown for an agent', async () => {
    const response = await fetch('/docs/nonexistent', { headers: { 'User-Agent': CLAUDE_BOT } })

    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toBe(MARKDOWN_CONTENT_TYPE)
    expect(response.headers.get('vary')).toBe(MARKDOWN_VARY)

    const body = await response.text()
    expect(body).toContain('# 404 Page Not Found')
    expect(body).toContain('/docs/nonexistent')
    expect(body).toContain(`${SITE_URL}/llms.txt`)
    expect(body).toContain(`${SITE_URL}/sitemap.md`)
  })

  it('answers an unknown page with HTML for a browser', async () => {
    const response = await fetch('/docs/nonexistent', {
      headers: { 'Accept': BROWSER_ACCEPT, 'Sec-Fetch-Mode': 'navigate' }
    })

    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toContain('text/html')
  })
})

describe('@nuxt/content source', () => {
  it('appends the page related links, like `@nuxt/content`\'s own raw route', async () => {
    const body = await (await fetch('/raw/docs/components/badge.md')).text()

    expect(body).toContain('\n---\n\n- [Reka UI](https://reka-ui.com/docs/components/badge)\n- [GitHub](https://github.com/nuxt/ui)')
  })

  it('strips the highlighter `<style>` node instead of exposing its CSS', async () => {
    const body = await (await fetch('/raw/docs/components/badge.md')).text()

    // The stringifier only drops a `<style>` node while it is last in the
    // tree, so appending the related links above would otherwise dump the
    // per-document shiki CSS variables into the markdown agents read.
    expect(body).not.toMatch(/^<style>$/m)
    expect(body).not.toContain('--shiki-')
    expect(body).toContain('```ts\nconst label = \'Badge\'\n```')
  })
})

describe('discovery documents', () => {
  it('emits the discovery `Link` header and `Vary` on the homepage', async () => {
    const response = await fetch('/')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(response.headers.get('vary')).toBe(MARKDOWN_VARY)

    const link = response.headers.get('link') || ''
    expect(link).toContain('</llms.txt>; rel="describedby"; type="text/plain"')
    expect(link).toContain('</>; rel="alternate"; type="text/markdown"')
    expect(link).toContain('</.well-known/api-catalog>; rel="api-catalog"')
  })

  it('serves `/sitemap.md` linking every page to its markdown twin', async () => {
    const response = await fetch('/sitemap.md')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(MARKDOWN_CONTENT_TYPE)

    const body = await response.text()
    expect(body).toContain('# Basic Sitemap')
    expect(body).toContain(`[Getting Started](${SITE_URL}/docs/getting-started.md)`)
    expect(body).toContain(`[Button](${SITE_URL}/docs/components/button.md)`)
    expect(body).toContain(`[Basic](${SITE_URL})`)
  })

  it('serves the RFC 9727 api-catalog', async () => {
    const response = await fetch('/.well-known/api-catalog')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/linkset+json')

    const linkset = (await response.json()) as { linkset: { 'anchor': string, 'service-desc'?: { href: string, type?: string }[] }[] }
    expect(linkset.linkset.length).toBeGreaterThan(0)

    const root = linkset.linkset.find(entry => entry.anchor === `${SITE_URL}/`)
    expect(root).toBeDefined()
    expect(root!['service-desc']).toContainEqual({ href: `${SITE_URL}/llms.txt`, type: 'text/plain' })
  })

  it('serves a `robots.txt` allowing the shared agent list', async () => {
    const response = await fetch('/robots.txt')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/plain')

    const body = await response.text()
    expect(body).toContain('User-agent: ClaudeBot')
    expect(body).toContain('User-agent: GPTBot')
    expect(body).toContain('Content-Signal: search=yes, ai-train=yes, ai-input=yes')
  })
})

describe('nuxt-llms bridge', () => {
  it('rewrites the `llms.txt` links to their raw markdown twins', async () => {
    const response = await fetch('/llms.txt')

    expect(response.status).toBe(200)

    const body = await response.text()
    expect(body).toContain(`${SITE_URL}/raw/docs/getting-started.md`)
    expect(body).toContain(`${SITE_URL}/raw/docs/components/button.md`)
    expect(body).toContain(`${SITE_URL}/raw/index.md`)
    // Every documentation link points at markdown, never at the HTML page.
    expect(body).not.toContain(`${SITE_URL}/docs/getting-started)`)
  })

  it('still serves `llms-full.txt`', async () => {
    const response = await fetch('/llms-full.txt')

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('# Getting Started')
  })
})
