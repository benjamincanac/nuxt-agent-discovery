import { describe, expect, it } from 'vitest'
import { fetch } from '@nuxt/test-utils/e2e'
import {
  BADGE_MARKDOWN,
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
 * Everything a content backend has to get right, whichever one is serving.
 *
 * The three adapter fixtures assert exactly the same bytes, which is the point
 * of the seam: `@nuxt/content` in `basic`, a hand-written in-memory adapter in
 * `custom-source`, `comark-content` in `comark`. Written once here rather than
 * copied into each suite, because three copies of forty assertions drift.
 *
 * Called from inside each suite's own file, after its `setup()`.
 * `@nuxt/test-utils` boots one fixture per suite, so the fixtures cannot be
 * cross-booted into a single file, and `fetch` resolves against whichever
 * server the calling file started.
 *
 * What stays in the individual suites is what is genuinely fixture-specific:
 * the browser-`Accept` HTML cases (only `basic` renders real pages), the
 * `robots.txt` handoff (which differs by design depending on whether
 * `@nuxtjs/robots` is installed), and the highlighter `<style>` stripping
 * (only `@nuxt/content` produces that node).
 */
export function describeSharedDocuments(): void {
  describe('content negotiation', () => {
    it('serves markdown for an explicit `Accept: text/markdown`', async () => {
      const response = await fetch('/docs/getting-started', { headers: { Accept: 'text/markdown' } })

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe(MARKDOWN_CONTENT_TYPE)
      expect(response.headers.get('vary')).toBe(MARKDOWN_VARY)
      expect(await response.text()).toBe(GETTING_STARTED_MARKDOWN)
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
      // `Vary` even though this URL answers markdown to every client. It is
      // where a negotiated page sends a client, so it is the response the
      // client keeps and the one a shared cache stores.
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

    it('appends the related links a page declares in frontmatter', async () => {
      const response = await fetch('/raw/docs/components/badge.md')

      expect(response.status).toBe(200)
      expect(await response.text()).toBe(BADGE_MARKDOWN)
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
    })

    it('answers an unknown raw markdown URL with a markdown 404', async () => {
      const response = await fetch('/raw/docs/nonexistent.md')

      expect(response.status).toBe(404)
      expect(response.headers.get('content-type')).toBe(MARKDOWN_CONTENT_TYPE)
      expect(await response.text()).toContain('# 404 Page Not Found')
    })
  })

  describe('discovery documents', () => {
    it('serves `/sitemap.md` linking every page to its raw markdown twin', async () => {
      const response = await fetch('/sitemap.md')

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe(MARKDOWN_CONTENT_TYPE)

      const body = await response.text()
      expect(body).toContain('# Basic Sitemap')
      expect(body).toContain(`[Getting Started](${SITE_URL}/raw/docs/getting-started.md)`)
      expect(body).toContain(`[Button](${SITE_URL}/raw/docs/components/button.md)`)
    })

    it('agrees with `llms.txt` on the pages it lists', async () => {
      // The two documents are read together, so a page pointing at the HTML
      // URL in one and at its raw twin in the other is a real divergence.
      const sitemap = await (await fetch('/sitemap.md')).text()
      const llms = await (await fetch('/llms.txt')).text()

      for (const page of ['/raw/docs/getting-started.md', '/raw/docs/components/button.md']) {
        expect(sitemap).toContain(`${SITE_URL}${page}`)
        expect(llms).toContain(`${SITE_URL}${page}`)
      }
    })

    it('rewrites the `llms.txt` links to their raw markdown twins', async () => {
      const body = await (await fetch('/llms.txt')).text()

      expect(body).toContain(`${SITE_URL}/raw/index.md`)
      // Every documentation link points at markdown, never at the HTML page.
      expect(body).not.toContain(`${SITE_URL}/docs/getting-started)`)
    })
  })
}
