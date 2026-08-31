import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { H3Event } from 'h3'

/**
 * `list()` is optional on the seam: a backend can resolve a route without
 * being able to enumerate its pages. The listing is then empty, and the point
 * of this file is that it comes out empty rather than throwing, which is what
 * every caller of `listAgentPages()` would have seen.
 *
 * The config accessor is the real one, through the aliased `#imports`, so the
 * raw URLs come out of the same route matching a site would get. Nitro's
 * runtime only has to import: it is reached through the barrel, which
 * re-exports the document helpers, and nothing here calls into it.
 */
vi.mock('nitropack/runtime', () => ({ useNitroApp: () => ({ hooks: { callHook: async () => {} } }) }))

const { listAgentPages } = await import('../../src/runtime/server/utils/pages')
const { setAgentContentSource } = await import('./source.stub')
const { setRuntimeConfig } = await import('./imports.stub')

const event = {} as H3Event

beforeEach(() => {
  setAgentContentSource(null)
  setRuntimeConfig({
    agentDiscovery: {
      siteUrl: 'https://example.com',
      rawPrefix: '/raw',
      routes: [{ path: '/', raw: '/raw/index.md' }, { path: '/**' }],
      excludePrefixes: ['/_', '/api/']
    }
  })
})

describe('listAgentPages: an adapter without `list()`', () => {
  it('lists nothing instead of throwing', async () => {
    setAgentContentSource({
      async get() {
        return { markdown: '# Getting Started\n' }
      }
    })

    await expect(listAgentPages(event)).resolves.toEqual([])
  })

  it('still lists the pages of an adapter that has it', async () => {
    setAgentContentSource({
      async list() {
        return [{ route: '/docs/getting-started', title: 'Getting Started' }]
      },
      async get() {
        return { markdown: '# Getting Started\n' }
      }
    })

    await expect(listAgentPages(event)).resolves.toEqual([{
      route: '/docs/getting-started',
      title: 'Getting Started',
      description: undefined,
      section: undefined,
      url: 'https://example.com/docs/getting-started',
      rawUrl: 'https://example.com/raw/docs/getting-started.md'
    }])
  })

  it('spells a non-ASCII route like the canonical URL', async () => {
    // The raw route's `Link` header and `canonical_url` frontmatter encode
    // the path, so the listing has to spell it the same way or an agent sees
    // two names for one page.
    setAgentContentSource({
      async list() {
        return [{ route: '/guide/文档', title: '文档' }]
      },
      async get() {
        return { markdown: '# 文档\n' }
      }
    })

    await expect(listAgentPages(event)).resolves.toEqual([{
      route: '/guide/文档',
      title: '文档',
      description: undefined,
      section: undefined,
      url: 'https://example.com/guide/%E6%96%87%E6%A1%A3',
      rawUrl: 'https://example.com/raw/guide/%E6%96%87%E6%A1%A3.md'
    }])
  })
})
