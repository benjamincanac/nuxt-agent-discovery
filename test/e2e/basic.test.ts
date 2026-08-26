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

  it('serves `/sitemap.md` linking every page to its raw markdown twin', async () => {
    const response = await fetch('/sitemap.md')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(MARKDOWN_CONTENT_TYPE)

    const body = await response.text()
    expect(body).toContain('# Basic Sitemap')
    expect(body).toContain(`[Getting Started](${SITE_URL}/raw/docs/getting-started.md)`)
    expect(body).toContain(`[Button](${SITE_URL}/raw/docs/components/button.md)`)
    expect(body).toContain(`[Basic](${SITE_URL}/raw/index.md)`)
  })

  it('agrees with `llms.txt` on the pages it lists', async () => {
    // The two documents are read together, so a homepage pointing at the HTML
    // page in one and at `/raw/index.md` in the other is a real divergence.
    const sitemap = await (await fetch('/sitemap.md')).text()
    const llms = await (await fetch('/llms.txt')).text()

    for (const page of ['/raw/index.md', '/raw/docs/getting-started.md', '/raw/docs/components/button.md']) {
      expect(sitemap).toContain(`${SITE_URL}${page}`)
      expect(llms).toContain(`${SITE_URL}${page}`)
    }
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

describe('sitemap.md sections', () => {
  it('expands the configured prefix into a section per area, with label overrides', async () => {
    const body = await (await fetch('/sitemap.md')).text()

    // `expand: ['/docs']` splits `/docs/**` by its second segment...
    expect(body).toContain('## UI Components')
    // ...and `labels` renames one of them, the rest deriving from the segment.
    expect(body).not.toContain('## Docs')
    // Top-level pages share one section.
    expect(body).toContain('## Pages')
    expect(body).toContain(`[Basic](${SITE_URL}/raw/index.md)`)
  })
})

describe('mcp server card', () => {
  it('serves the configured card, enriched through the hook', async () => {
    const response = await fetch('/.well-known/mcp/server-card.json')

    expect(response.status).toBe(200)

    const card = (await response.json()) as { serverInfo: Record<string, string>, endpoints: unknown[], tools: unknown[] }
    expect(card.serverInfo.name).toBe('Basic')
    expect(card.serverInfo.documentation).toBe(`${SITE_URL}/docs/getting-started`)
    expect(card.endpoints).toEqual([{ type: 'streamable-http', url: `${SITE_URL}/mcp` }])
    // Contributed by the site, which is the only thing that knows its tools.
    expect(card.tools).toEqual([{ name: 'search', description: 'Search the fixture.' }])
  })
})

describe('rawUrl', () => {
  it('maps a page to its raw twin and leaves everything else alone', async () => {
    const body = await (await fetch('/raw-urls.json')).json() as Record<string, string>

    expect(body.page).toBe(`${SITE_URL}/raw/docs/getting-started.md`)
    expect(body.home).toBe(`${SITE_URL}/raw/index.md`)
    expect(body.query).toBe(`${SITE_URL}/raw/docs/getting-started.md?x=1#y`)
    // Not a page: no route matches, so it only becomes absolute.
    expect(body.asset).toBe(`${SITE_URL}/openapi.json`)
    // Off-site links are never rewritten.
    expect(body.external).toBe('https://example.com/docs/x')
  })
})

describe('agent resources block', () => {
  it('renders the discovery registry as markdown', async () => {
    const body = await (await fetch('/agent-resources.md')).text()

    expect(body).toContain('## Resources for Agents')
    expect(body).toContain(`- [llms.txt: index of the documentation for LLMs](${SITE_URL}/llms.txt)`)
    expect(body).toContain(`- [Agent skills index: every skill published by this site](${SITE_URL}/.well-known/skills/index.json)`)
    // Only titled resources are listed, so untitled registry entries stay internal.
    expect(body).not.toContain('](/')
  })
})

describe('openapi fragments', () => {
  it('describes the negotiated routes and their raw twins from the route config', async () => {
    const doc = (await (await fetch('/openapi.json')).json()) as { paths: Record<string, { get: { parameters?: { name: string }[], responses: Record<string, { content: Record<string, unknown>, headers: Record<string, unknown> }> } }> }

    // Default `routes` is ['/', '/**'], so both the page and its twin appear.
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining([
      '/', '/raw/index.md', '/{path}', '/raw/{path}.md'
    ]))
    // The wildcard becomes a path parameter rather than being enumerated.
    expect(doc.paths['/{path}']!.get.parameters?.[0]).toMatchObject({ name: 'path', in: 'path', required: true })
    expect(doc.paths['/']!.get.responses['200']!.content).toHaveProperty('text/markdown')
    expect(doc.paths['/']!.get.responses['200']!.headers.Vary).toEqual({ $ref: '#/components/headers/Vary' })
  })

  it('names every operation, so a generated client keeps its method names', async () => {
    const doc = (await (await fetch('/openapi.json')).json()) as { paths: Record<string, { get: { operationId: string } }> }
    const ids = Object.fromEntries(Object.entries(doc.paths).map(([path, item]) => [path, item.get.operationId]))

    expect(ids).toMatchObject({
      '/': 'getHomepage',
      '/raw/index.md': 'getHomepageMarkdown',
      '/{path}': 'getPage',
      '/raw/{path}.md': 'getPageMarkdown',
      '/sitemap.md': 'getSitemapMarkdown',
      '/llms.txt': 'getLlmsTxt',
      '/llms-full.txt': 'getLlmsFullTxt',
      '/.well-known/api-catalog': 'getApiCatalog',
      '/.well-known/mcp/server-card.json': 'getMcpServerCard',
      '/.well-known/skills/index.json': 'getSkillsIndex'
    })
    // A client generator turns these into method names, so a duplicate would
    // silently drop an operation.
    expect(new Set(Object.values(ids)).size).toBe(Object.values(ids).length)
  })

  it('only describes the discovery documents this site actually serves', async () => {
    const doc = (await (await fetch('/openapi.json')).json()) as { paths: Record<string, unknown>, components: { schemas: Record<string, unknown> } }

    for (const path of ['/sitemap.md', '/llms.txt', '/llms-full.txt', '/.well-known/api-catalog', '/.well-known/mcp/server-card.json', '/.well-known/skills/index.json']) {
      expect(doc.paths).toHaveProperty([path])
    }
    // Schemas ride along with the documents that reference them.
    expect(doc.components.schemas).toHaveProperty('Linkset')
    expect(doc.components.schemas).toHaveProperty('SkillsIndex')
  })
})

describe('agent skills', () => {
  it('generates the skills index from the directory on disk', async () => {
    const response = await fetch('/.well-known/skills/index.json')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')

    const body = (await response.json()) as { skills: { name: string, description: string, files: string[] }[] }
    expect(body.skills).toHaveLength(1)
    expect(body.skills[0]).toEqual({
      name: 'basic-site',
      description: 'Fixture agent skill used to test the skills catalog and file serving.',
      // Generated from disk, `SKILL.md` first, so it cannot drift from what is served.
      files: ['SKILL.md', 'references/conventions.md']
    })
  })

  it('serves each file of a skill with a useful content type', async () => {
    const skill = await fetch('/.well-known/skills/basic-site/SKILL.md')
    expect(skill.status).toBe(200)
    expect(skill.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
    expect(await skill.text()).toContain('# Basic site')

    const reference = await fetch('/.well-known/skills/basic-site/references/conventions.md')
    expect(reference.status).toBe(200)
    expect(await reference.text()).toContain('# Conventions')
  })

  it('ignores a directory without a `SKILL.md` and refuses to escape the skill', async () => {
    expect((await fetch('/.well-known/skills/not-a-skill/README.md')).status).toBe(404)
    expect((await fetch('/.well-known/skills/basic-site/../../../nuxt.config.ts')).status).not.toBe(200)
  })

  it('advertises the skills index in the discovery registry', async () => {
    const link = (await fetch('/')).headers.get('link') || ''
    expect(link).toContain('</.well-known/skills/index.json>; rel="index"; type="application/json"')

    // The skill itself reaches the api-catalog, not the `Link` header.
    expect(link).not.toContain('/.well-known/skills/basic-site/SKILL.md')
    const linkset = (await (await fetch('/.well-known/api-catalog')).json()) as { linkset: { 'anchor': string, 'service-doc'?: { href: string }[] }[] }
    const root = linkset.linkset.find(entry => entry.anchor === `${SITE_URL}/`)
    expect(root!['service-doc']).toContainEqual({ href: `${SITE_URL}/.well-known/skills/basic-site/SKILL.md`, type: 'text/markdown' })
  })

  it('keeps skills out of markdown negotiation', async () => {
    const response = await fetch('/.well-known/skills/basic-site/SKILL.md', { headers: { 'User-Agent': CLAUDE_BOT } })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
  })
})

describe('pages without a markdown body', () => {
  it('404s the raw twin of a structured page', async () => {
    // `data.yml` is a page collection entry carrying data, not prose. It has
    // no markdown representation, so serving an empty document would be worse
    // than saying so.
    expect((await fetch('/raw/data.md')).status).toBe(404)
  })

  it('keeps it out of `llms-full.txt` instead of crashing on it', async () => {
    const response = await fetch('/llms-full.txt')

    expect(response.status).toBe(200)
    expect(await response.text()).not.toContain('Structured')
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

  it('renders only the pages the declared sections name', async () => {
    const body = await (await fetch('/llms-full.txt')).text()

    // `/pages/standalone` is a page collection no section selects. Rendering
    // every route would pull it in alongside the documentation.
    expect(body).toContain('# Getting Started')
    expect(body).not.toContain('deliberately outside the documentation sections')

    // ...while it is still reachable as raw markdown on its own.
    expect((await fetch('/raw/pages/standalone.md')).status).toBe(200)
  })

  it('still serves `llms-full.txt`', async () => {
    const response = await fetch('/llms-full.txt')

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('# Getting Started')
  })

  it('resolves `contentCollection` / `contentFilters` sections through the adapter', async () => {
    // `@nuxt/content`'s llms feature owned these two keys. The module removes
    // that feature, so a site's existing `llms.sections` has to keep working.
    const body = await (await fetch('/llms.txt')).text()

    const components = body.split('## Components')[1]!.split('\n## ')[0]!
    expect(components).toContain(`${SITE_URL}/raw/docs/components/button.md`)
    expect(components).toContain(`${SITE_URL}/raw/docs/components/badge.md`)
    // The filter is applied, so the section is not just every page again.
    expect(components).not.toContain(`${SITE_URL}/raw/docs/getting-started.md`)

    const everything = body.split('## Everything')[1]!.split('\n## ')[0]!
    expect(everything).toContain(`${SITE_URL}/raw/docs/getting-started.md`)
  })

  it('leaves a hand-written section its own links, still rewritten to raw twins', async () => {
    const body = await (await fetch('/llms.txt')).text()
    const handwritten = body.split('## Handwritten')[1]!.split('\n## ')[0]!

    expect(handwritten).toContain(`[Getting Started](${SITE_URL}/raw/docs/getting-started.md)`)
    expect(handwritten.split('\n').filter(line => line.startsWith('- '))).toHaveLength(1)
  })

  it('emits each section once: `@nuxt/content`\'s llms plugin is gone', async () => {
    const body = await (await fetch('/llms.txt')).text()
    const headings = body.split('\n').filter(line => line.startsWith('## '))

    expect(headings).toEqual([...new Set(headings)])
    // The auto-generated fallback must stay out once sections resolve.
    expect(headings).not.toContain('## Docs')
  })

  it('renders `llms-full.txt` through the same adapter as `/raw/**.md`', async () => {
    // The divergence that motivated the takeover: the same page rendered by two
    // pipelines. Both call `source.get()` now, so the bodies have to match.
    const raw = await (await fetch('/raw/docs/getting-started.md')).text()
    const full = await (await fetch('/llms-full.txt')).text()

    // The raw route wraps the body in frontmatter and a sitemap footer.
    const body = raw.split('---\n')[2]!.split('\n\n## Sitemap')[0]!
    expect(full).toContain(body.trim())
  })
})
