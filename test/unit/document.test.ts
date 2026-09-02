import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { H3Event } from 'h3'

/**
 * `getAgentDocument()` is the resolver behind `/raw/**.md`, so the two must
 * agree on what exists. The exclusion cases are pinned here because they used
 * to disagree with every listing: `listAgentPages()`, `sitemap.md` and the
 * llms bridge all dropped excluded prefixes while the raw route kept serving
 * them, and a site migrating took the listings as the contract.
 */
vi.mock('nitropack/runtime', () => ({ useNitroApp: () => ({ hooks: { callHook: async () => {} } }) }))

const { getAgentDocument } = await import('../../src/runtime/server/utils/document')
const { setAgentContentSource } = await import('./source.stub')
const { setRuntimeConfig } = await import('./imports.stub')

const event = {} as H3Event

beforeEach(() => {
  setAgentContentSource({
    async get(route) {
      return { title: route.slice(1), markdown: `# ${route.slice(1)}\n` }
    }
  })
  setRuntimeConfig({
    agentDiscovery: {
      siteUrl: 'https://example.com',
      rawPrefix: '/raw',
      routes: [{ path: '/', raw: '/raw/index.md' }, { path: '/**' }],
      excludePrefixes: ['/_', '/api/', '/docs/5.x/'],
      links: []
    }
  })
})

describe('getAgentDocument: excluded prefixes', () => {
  it('resolves nothing under an excluded prefix, like every listing', async () => {
    await expect(getAgentDocument(event, '/docs/5.x/foo')).resolves.toBeNull()
  })

  it('still resolves the page next to it', async () => {
    const document = await getAgentDocument(event, '/docs/4.x/foo')

    expect(document).toMatchObject({ title: 'docs/4.x/foo' })
  })

  it('serves an excluded route to a caller that opts in', async () => {
    // The opt-in exists for MCP tools, which are exactly where a site serves
    // what it does not advertise: a nightly docs version stays out of
    // `sitemap.md` and `llms.txt` but stays reachable through `get-page`.
    const document = await getAgentDocument(event, '/docs/5.x/foo', { includeExcluded: true })

    expect(document).toMatchObject({
      title: 'docs/5.x/foo',
      canonicalUrl: 'https://example.com/docs/5.x/foo'
    })
  })

  it('checks the decoded route, the spelling the exclusion list is written in', async () => {
    await expect(getAgentDocument(event, '/docs/5%2Ex/foo')).resolves.toBeNull()
  })
})

describe('getAgentDocument: homepage', () => {
  const configure = (links: { href: string, rel: string, title?: string }[]) => setRuntimeConfig({
    agentDiscovery: {
      siteUrl: 'https://example.com',
      rawPrefix: '/raw',
      routes: [{ path: '/', raw: '/raw/index.md' }, { path: '/**' }],
      excludePrefixes: [],
      links
    }
  })

  beforeEach(() => {
    configure([
      { href: '/sitemap.md', rel: 'sitemap', title: 'Sitemap (Markdown): every page on the site' },
      { href: '/llms.txt', rel: 'describedby', title: 'llms.txt: index of the documentation for LLMs' },
      { href: '/', rel: 'alternate' }
    ])
  })

  it('appends the resources block between the body and the sitemap footer', async () => {
    setAgentContentSource({
      async get(route) {
        return route === '/' ? { title: 'Home', markdown: '# Home\n\nWelcome.\n' } : null
      }
    })

    await expect(getAgentDocument(event, '/')).resolves.toMatchObject({
      markdown: `---
title: "Home"
canonical_url: "https://example.com"
---
# Home

Welcome.

## Resources for Agents

- [Sitemap (Markdown): every page on the site](https://example.com/sitemap.md)
- [llms.txt: index of the documentation for LLMs](https://example.com/llms.txt)


## Sitemap

See the full [sitemap](https://example.com/sitemap.md) for all pages.
`
    })
  })

  it('leaves a body that already carries the heading alone', async () => {
    // A homepage that rendered the registry by hand before the module did,
    // through `renderAgentResources()` in a hook or a list typed into
    // `content/index.md`, is not listed twice.
    setAgentContentSource({
      async get(route) {
        return route === '/' ? { title: 'Home', markdown: '# Home\n\n## Resources for Agents\n\n- [Sitemap](https://example.com/sitemap.md)\n' } : null
      }
    })

    const document = await getAgentDocument(event, '/') as { markdown: string }

    expect(document.markdown.match(/Resources for Agents/g)).toHaveLength(1)
    expect(document.markdown).not.toContain('llms.txt')
  })

  it('leaves every other page without the block', async () => {
    setAgentContentSource({
      async get(route) {
        return { title: route.slice(1), markdown: `# ${route.slice(1)}\n` }
      }
    })

    const document = await getAgentDocument(event, '/docs/foo') as { markdown: string }

    expect(document.markdown).not.toContain('Resources for Agents')
  })

  it('leaves an empty body empty rather than serving a headless block', async () => {
    setAgentContentSource({
      async get(route) {
        return route === '/' ? { title: 'Home', markdown: '' } : null
      }
    })

    await expect(getAgentDocument(event, '/')).resolves.toMatchObject({
      markdown: '---\ntitle: "Home"\ncanonical_url: "https://example.com"\n---\n\n\n## Sitemap\n\nSee the full [sitemap](https://example.com/sitemap.md) for all pages.\n'
    })
  })

  it('leaves the document alone when the registry has no titled links', async () => {
    configure([{ href: '/', rel: 'alternate' }])
    setAgentContentSource({
      async get(route) {
        return route === '/' ? { title: 'Home', markdown: '# Home\n\nWelcome.\n' } : null
      }
    })

    await expect(getAgentDocument(event, '/')).resolves.toMatchObject({
      markdown: '---\ntitle: "Home"\ncanonical_url: "https://example.com"\n---\n# Home\n\nWelcome.\n\n'
    })
  })

  it('generates the landing page when the adapter has no `/` entry, byte for byte', async () => {
    // Pinned exactly: the adapter-served `/` carries a resources block of its
    // own, and this branch must not move with it.
    setAgentContentSource({
      async get() {
        return null
      }
    })

    await expect(getAgentDocument(event, '/')).resolves.toMatchObject({
      markdown: `---
title: "example.com"
canonical_url: "https://example.com"
---
# example.com

## Resources for Agents

- [Sitemap (Markdown): every page on the site](https://example.com/sitemap.md)
- [llms.txt: index of the documentation for LLMs](https://example.com/llms.txt)

Every page on this site is available as raw markdown: append \`.md\` to its
URL or send \`Accept: text/markdown\`.
`
    })
  })
})
