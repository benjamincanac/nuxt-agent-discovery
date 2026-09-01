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
