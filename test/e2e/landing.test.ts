import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { fetch, setup } from '@nuxt/test-utils/e2e'
import { CLAUDE_BOT, MARKDOWN_CONTENT_TYPE, MARKDOWN_VARY } from './expected'

const SITE_URL = 'https://landing.example.com'

/**
 * A site whose `/` is a Vue page with no document behind it, and whose pages
 * are all behind a response cache. That is the `nuxt/ui` docs, `nuxt.com` and
 * `whichcodingtools` shape, and neither half worked before: `/raw/index.md`
 * 404'd while `llms.txt` linked to it, and a section URL with no index page
 * 404'd instead of reaching its first document.
 */
await setup({
  rootDir: fileURLToPath(new URL('../fixtures/landing', import.meta.url)),
  build: true,
  server: true,
  setupTimeout: 300000
})

describe('generated /raw/index.md', () => {
  it('serves a markdown landing page from the registry', async () => {
    const response = await fetch('/raw/index.md')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(MARKDOWN_CONTENT_TYPE)

    const body = await response.text()
    expect(body).toContain(`canonical_url: "${SITE_URL}"`)
    expect(body).toContain('## Resources for Agents')
  })

  it('takes its title and description from `agent-discovery:index`', async () => {
    // The metadata of a Vue landing page lives in the app, not in a document,
    // so `siteName` is only the fallback. `nuxt/ui` docs cannot adopt this
    // route otherwise: its frontmatter would lose the real title and the
    // description entirely.
    const body = await (await fetch('/raw/index.md')).text()

    // The fixture's hook appends to what it was handed, so `Landing` here is
    // the `siteName` the module pre-fills.
    expect(body).toContain('title: "Landing: A Vue Landing Page"')
    expect(body).toContain('description: "Metadata that lives in the app, not in a document."')
    expect(body).toContain('# Landing: A Vue Landing Page')
    // Same shape a content document comes out in.
    expect(body).toContain('\n> Metadata that lives in the app, not in a document.\n')
  })

  it('carries the discovery resources, so an agent can recover from it', async () => {
    const body = await (await fetch('/raw/index.md')).text()

    expect(body).toContain('## Resources for Agents')
    expect(body).toContain(`${SITE_URL}/llms.txt`)
    expect(body).toContain(`${SITE_URL}/.well-known/api-catalog`)
  })

  it('includes what the site pushed through `agent-discovery:index`', async () => {
    const body = await (await fetch('/raw/index.md')).text()

    expect(body).toContain('A Vue landing page, with no content document behind it.')
  })

  it('sets the canonical and alternate links', async () => {
    const link = (await fetch('/raw/index.md')).headers.get('link')

    expect(link).toContain(`<${SITE_URL}>; rel="canonical"`)
    expect(link).toContain(`<${SITE_URL}>; rel="alternate"; type="text/html"`)
  })

  it('serves the whole generated document, byte for byte', async () => {
    // Pinned exactly: the adapter-served `/` carries a resources block of its
    // own, and this branch must not move with it.
    const body = await (await fetch('/raw/index.md')).text()

    expect(body).toBe(`---
title: "Landing: A Vue Landing Page"
description: "Metadata that lives in the app, not in a document."
canonical_url: "${SITE_URL}"
---
# Landing: A Vue Landing Page

> Metadata that lives in the app, not in a document.

A Vue landing page, with no content document behind it.

## Resources for Agents

- [API catalog: every service document this site publishes](${SITE_URL}/.well-known/api-catalog)
- [Sitemap (Markdown): every page on the site](${SITE_URL}/sitemap.md)
- [llms.txt: index of the documentation for LLMs](${SITE_URL}/llms.txt)

Every page on this site is available as raw markdown: append \`.md\` to its
URL or send \`Accept: text/markdown\`.
`)
  })

  it('is what `llms.txt` links to for the homepage', async () => {
    const body = await (await fetch('/llms.txt')).text()

    expect(body).toContain(`${SITE_URL}/raw/index.md`)
  })
})

describe('section without an index page', () => {
  it('redirects to the first document under it', async () => {
    const response = await fetch('/raw/docs.md', { redirect: 'manual' })

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/raw/docs/getting-started.md')
  })

  it('still 404s a path that is neither a page nor a section', async () => {
    const response = await fetch('/raw/nope.md')

    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toBe(MARKDOWN_CONTENT_TYPE)
  })
})

describe('cached routes', () => {
  it('redirects rather than answering in place where a response cache would key on the path alone', async () => {
    // `/docs/**` is `swr`, so a markdown body served here would be replayed to
    // the next browser under the same key. A redirect keeps one variant per URL.
    const response = await fetch('/docs/getting-started', {
      headers: { accept: 'text/markdown' },
      redirect: 'manual'
    })

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('/raw/docs/getting-started.md')
    expect(response.headers.get('vary')).toBe(MARKDOWN_VARY)
  })

  it('carries the query string over to the raw twin', async () => {
    // A page whose content is its query (`/compare?tools=cursor,zed`) would
    // come out empty if the redirect dropped it. On Vercel the CDN 307 does
    // this for us, so both negotiation paths land on the same URL.
    const response = await fetch('/docs/getting-started?tools=cursor,zed', {
      headers: { accept: 'text/markdown' },
      redirect: 'manual'
    })

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('/raw/docs/getting-started.md?tools=cursor,zed')
  })

  it('still serves HTML to a browser on a cached page', async () => {
    const response = await fetch('/docs/getting-started', { headers: { accept: 'text/html' } })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
  })

  it('still serves the explicit `.md` twin, which only ever has one variant', async () => {
    const response = await fetch('/raw/docs/getting-started.md')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(MARKDOWN_CONTENT_TYPE)
    expect(await response.text()).toContain('# Getting Started')
  })

  it('answers an agent user-agent on an uncached page', async () => {
    const response = await fetch('/', { headers: { 'user-agent': CLAUDE_BOT } })

    expect(response.headers.get('content-type')).toBe(MARKDOWN_CONTENT_TYPE)
    expect(await response.text()).toContain('# Landing')
  })
})

describe('llms.txt sections', () => {
  it('groups pages by the section label the adapter returns', async () => {
    const body = await (await fetch('/llms.txt')).text()

    expect(body).toContain('## Guide')
    expect(body).toContain('## Components')
    expect(body.split('## Components')[1]).toContain(`${SITE_URL}/raw/docs/components/button.md`)
  })
})
