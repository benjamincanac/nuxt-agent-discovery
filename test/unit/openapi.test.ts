import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import type { DiscoveryLink, NegotiationConfig } from '../../src/runtime/shared/types'

/**
 * The operation ids, which is the half of these fragments a site can collide
 * with. `paths` is checked from the e2e fixtures, where a real Nitro build
 * serves the document; what needs pinning here is which name wins when two
 * things want the same one.
 *
 * The config accessor is stubbed rather than booted. It lives in a barrel that
 * re-exports the page and document helpers, which reach into Nitro internals
 * that only exist inside a build, and none of that is what this file tests.
 * The MCP endpoint still comes through the aliased `#imports`, since that is
 * read here directly.
 */
const state = vi.hoisted(() => ({ config: undefined as NegotiationConfig | undefined }))

vi.mock('../../src/runtime/server/utils/agent-discovery', () => ({
  useAgentDiscoveryConfig: () => state.config!
}))

const { agentDiscoveryOpenApi } = await import('../../src/runtime/server/utils/openapi')
const { setRuntimeConfig } = await import('./imports.stub')

const LINKS: DiscoveryLink[] = [
  { href: '/sitemap.md', rel: 'sitemap', type: 'text/markdown' },
  { href: '/llms.txt', rel: 'describedby', type: 'text/plain' },
  { href: '/.well-known/api-catalog', rel: 'api-catalog' },
  { href: '/.well-known/skills/index.json', rel: 'index' }
]

function createConfig(overrides: Partial<NegotiationConfig> = {}): NegotiationConfig {
  return {
    siteUrl: 'https://example.com',
    siteName: 'Example',
    rawPrefix: '/raw',
    routes: [{ path: '/', raw: '/raw/index.md' }, { path: '/docs/**' }],
    userAgents: ['ClaudeBot'],
    excludePrefixes: ['/_', '/api/', '/mcp', '/.well-known/'],
    links: LINKS,
    linkHeader: true,
    cachedRoutes: [],
    sitemapSections: { expand: [], labels: {} },
    notAcceptable: false,
    ...overrides
  }
}

const event = {} as H3Event

/** `{ path: operationId }` for every operation in the fragments. */
function ids(config: NegotiationConfig, options?: Parameters<typeof agentDiscoveryOpenApi>[1]): Record<string, string> {
  state.config = config
  setRuntimeConfig({ agentDiscoveryMcp: { endpoint: '/mcp' } })
  const { paths } = agentDiscoveryOpenApi(event, options)
  return Object.fromEntries(Object.entries(paths).map(([path, item]) => {
    const operation = item as { get?: { operationId: string }, post?: { operationId: string } }
    return [path, (operation.get || operation.post)!.operationId]
  }))
}

beforeEach(() => {
  state.config = undefined
  setRuntimeConfig({})
})

describe('agentDiscoveryOpenApi: the operation namespace', () => {
  it('names a page after its pattern and its twin after the same', () => {
    expect(ids(createConfig())).toMatchObject({
      '/': 'getHomepage',
      '/raw/index.md': 'getHomepageMarkdown',
      '/docs/{path}': 'getDocsPage',
      '/raw/docs/{path}.md': 'getDocsPageMarkdown'
    })
  })

  it('gives every discovery document the same id on every site', () => {
    expect(ids(createConfig())).toMatchObject({
      '/sitemap.md': 'getSitemapMarkdown',
      '/llms.txt': 'getLlmsTxt',
      '/.well-known/api-catalog': 'getApiCatalog',
      '/.well-known/skills/index.json': 'getSkillsIndex',
      '/mcp': 'callMcpServer'
    })
  })

  it('never repeats one', () => {
    const values = Object.values(ids(createConfig({
      routes: [{ path: '/' }, { path: '/docs/api' }, { path: '/docs-api' }, { path: '/**' }]
    })))
    expect(new Set(values).size).toBe(values.length)
  })
})

// `claim()` deduped within the fragments and had no idea what the caller was
// adding afterwards, while the caller had no idea what `claim()` had taken.
// Only a linter caught the result.
describe('agentDiscoveryOpenApi: dedupes against the caller', () => {
  it('steps aside for an `operationId` in the paths it is merged into', () => {
    const paths = {
      '/api/tools.json': { get: { operationId: 'getTools' } },
      '/api/tools/{id}.json': { get: { operationId: 'getTool' } }
    }
    const result = ids(createConfig({ routes: [{ path: '/tools' }] }), { paths })

    expect(result['/tools']).toBe('getTools2')
    expect(result['/raw/tools.md']).toBe('getToolsMarkdown')
  })

  it('reads every method, not just `get`', () => {
    const paths = { '/api/tools.json': { post: { operationId: 'getTools' }, delete: { operationId: 'getToolsMarkdown' } } }
    const result = ids(createConfig({ routes: [{ path: '/tools' }] }), { paths })

    expect(result['/tools']).toBe('getTools2')
    expect(result['/raw/tools.md']).toBe('getToolsMarkdown2')
  })

  // A path item also carries `summary`, `parameters` and `servers`, none of
  // which name an operation, and a caller may hand over a `$ref` entry.
  it('ignores everything in a path item that is not an operation', () => {
    const paths = {
      '/api/tools.json': { summary: 'Tools', parameters: [{ name: 'q', in: 'query' }], get: { operationId: 'listTools' } },
      '/api/other': { $ref: '#/components/pathItems/Other' },
      '/api/empty': null
    }
    expect(() => ids(createConfig(), { paths })).not.toThrow()
    expect(ids(createConfig({ routes: [{ path: '/tools' }] }), { paths })['/tools']).toBe('getTools')
  })

  it('claims a `reserved` id with no paths object to read', () => {
    const result = ids(createConfig({ routes: [{ path: '/tools' }] }), { reserved: ['getTools'] })

    expect(result['/tools']).toBe('getTools2')
  })

  // The caller outranks even the discovery documents: a site cannot rename its
  // own endpoint to get out of the way of one it did not write.
  it('moves a discovery document out of the way of a caller id', () => {
    const result = ids(createConfig(), { reserved: ['getSitemapMarkdown'] })

    expect(result['/sitemap.md']).toBe('getSitemapMarkdown2')
    expect(result['/llms.txt']).toBe('getLlmsTxt')
  })
})

// The fragments could already collide with themselves: the discovery ids were
// hardcoded and never went through `claim()`, so a route pattern deriving one
// of them produced a document no generator would accept.
describe('agentDiscoveryOpenApi: dedupes against itself', () => {
  it('keeps the discovery id and suffixes the page pattern that wants it', () => {
    const result = ids(createConfig({ routes: [{ path: '/sitemap' }] }))

    expect(result['/sitemap.md']).toBe('getSitemapMarkdown')
    expect(result['/sitemap']).toBe('getSitemap')
    // `/raw/sitemap.md` derives `getSitemapMarkdown` too, and gives way.
    expect(result['/raw/sitemap.md']).toBe('getSitemapMarkdown2')
  })

  it('does the same for a pattern deriving a document id outright', () => {
    const result = ids(createConfig({ routes: [{ path: '/skills-index' }] }))

    expect(result['/.well-known/skills/index.json']).toBe('getSkillsIndex')
    expect(result['/skills-index']).toBe('getSkillsIndex2')
  })

  // Only the documents the site serves reserve a name, so a site without
  // skills keeps `getSkillsIndex` free for its own page.
  it('only reserves the documents the site actually serves', () => {
    const result = ids(createConfig({ routes: [{ path: '/skills-index' }], links: [] }))

    expect(result['/skills-index']).toBe('getSkillsIndex')
    expect(result).not.toHaveProperty('/.well-known/skills/index.json')
  })
})
