import { describe, it, expect, beforeEach } from 'vitest'
import type { H3Event } from 'h3'

/**
 * `list()` is optional on the seam: a backend can resolve a route without
 * being able to enumerate its pages. The listing is then empty, and the point
 * of this file is that it comes out empty rather than throwing, which is what
 * every caller of `listAgentPages()` would have seen.
 *
 * The config accessor is the real one, through the aliased `nitropack/runtime`,
 * so the raw URLs come out of the same route matching a site would get.
 */

const { listAgentPages } = await import('../../src/runtime/server/utils/pages')
const { rawUrl } = await import('../../src/runtime/server/utils/agent-discovery')
const { setAgentContentSource } = await import('./source.stub')
const { setRuntimeConfig } = await import('./nitro.stub')

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

describe('listAgentPages: duplicate routes', () => {
  it('lists a route once, keeping the description a later entry carries', async () => {
    // comark-content emits a directory `index.md` as the section node and
    // again as its first child, so `sitemap.md` printed it twice.
    setAgentContentSource({
      async list() {
        return [
          // A blank description counts as none, so the child's fills it in.
          { route: '/examples', title: 'Examples', description: '', section: 'Examples' },
          { route: '/examples', title: 'Examples', description: 'Every example.', section: 'Examples' },
          { route: '/examples/basic', title: 'Basic', section: 'Examples' }
        ]
      },
      async get() {
        return { markdown: '# x\n' }
      }
    })

    const listed = await listAgentPages(event)

    expect(listed.map(entry => entry.route)).toEqual(['/examples', '/examples/basic'])
    expect(listed[0]?.description).toBe('Every example.')
  })

  it('folds spellings that normalize onto the same route', async () => {
    setAgentContentSource({
      async list() {
        return [{ route: '/', title: 'Home' }, { route: '/index', title: 'Index' }]
      },
      async get() {
        return { markdown: '# x\n' }
      }
    })

    const listed = await listAgentPages(event)

    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({ route: '/', title: 'Home' })
  })
})

describe('listAgentPages: excluded prefixes', () => {
  beforeEach(() => {
    setAgentContentSource({
      async list() {
        return [
          { route: '/docs/guide', title: 'Guide' },
          { route: '/api/internal', title: 'Internal' }
        ]
      },
      async get() {
        return { markdown: '# x\n' }
      }
    })
  })

  it('drops them, so no listing advertises a twin that 404s', async () => {
    const listed = await listAgentPages(event)

    expect(listed.map(entry => entry.route)).toEqual(['/docs/guide'])
  })

  it('lists them for a caller that opts in', async () => {
    // The same opt-in `getAgentDocument` has, for the MCP tool listing what
    // the site deliberately keeps out of its public indexes.
    const listed = await listAgentPages(event, { includeExcluded: true })

    expect(listed.map(entry => entry.route)).toEqual(['/docs/guide', '/api/internal'])
  })

  it('checks the normalized route, the spelling the document resolver checks', async () => {
    // An adapter handing back an encoded route slipped past the prefix
    // compare, so the listing advertised a twin whose document resolves
    // `null` and whose URL 404s.
    setAgentContentSource({
      async list() {
        return [
          { route: '/%61pi/internal', title: 'Internal' },
          { route: '/docs/guide/', title: 'Guide' }
        ]
      },
      async get() {
        return { markdown: '# x\n' }
      }
    })

    const listed = await listAgentPages(event)
    expect(listed.map(entry => entry.route)).toEqual(['/docs/guide'])

    // Opted back in, the listing spells the route, the URL and the twin the
    // way `getAgentDocument` and `rawUrl()` do, not the way the adapter did.
    const included = await listAgentPages(event, { includeExcluded: true })
    expect(included.map(entry => entry.route)).toEqual(['/api/internal', '/docs/guide'])
    expect(included[0]).toMatchObject({
      route: '/api/internal',
      url: 'https://example.com/api/internal',
      rawUrl: 'https://example.com/raw/api/internal.md'
    })
  })

  it('filters `prefix` against the normalized spelling too', async () => {
    setAgentContentSource({
      async list() {
        return [{ route: '/%61pi/internal', title: 'Internal' }, { route: '/docs/guide', title: 'Guide' }]
      },
      async get() {
        return { markdown: '# x\n' }
      }
    })

    const listed = await listAgentPages(event, { includeExcluded: true, prefix: '/api/' })

    expect(listed.map(entry => entry.route)).toEqual(['/api/internal'])
  })
})

describe('rawUrl: under a base path', () => {
  beforeEach(() => {
    setRuntimeConfig({
      app: { baseURL: '/project/' },
      agentDiscovery: {
        siteUrl: 'https://example.com/project',
        rawPrefix: '/raw',
        routes: [{ path: '/', raw: '/raw/index.md' }, { path: '/**' }],
        excludePrefixes: []
      }
    })
  })

  it('resolves a route and an absolute URL carrying the base to the same twin', () => {
    expect(rawUrl(event, '/docs/alpha')).toBe('https://example.com/project/raw/docs/alpha.md')
    expect(rawUrl(event, 'https://example.com/project/docs/alpha?x=1')).toBe('https://example.com/project/raw/docs/alpha.md?x=1')
    expect(rawUrl(event, 'https://example.com/project')).toBe('https://example.com/project/raw/index.md')
  })

  it('leaves a same-origin URL outside the base alone', () => {
    expect(rawUrl(event, 'https://example.com/other/page')).toBe('https://example.com/other/page')
    expect(rawUrl(event, 'https://example.com/projects/page')).toBe('https://example.com/projects/page')
  })
})
