import { describe, it, expect } from 'vitest'
import { vercelMarkdownRoutes } from '../../src/presets/vercel'
import type { VercelRoute } from '../../src/presets/vercel'
import { formatLinkHeader } from '../../src/runtime/shared/negotiation'
import type { NegotiationConfig } from '../../src/runtime/shared/types'

function createConfig(overrides: Partial<NegotiationConfig> = {}): NegotiationConfig {
  return {
    siteUrl: 'https://example.com',
    siteName: 'Example',
    rawPrefix: '/raw',
    routes: [
      { path: '/', raw: '/raw/index.md' },
      { path: '/docs/**' }
    ],
    userAgents: ['ClaudeBot', 'GPTBot', 'curl/8.4'],
    excludePrefixes: ['/_', '/api/', '/mcp', '/.well-known/'],
    links: [],
    cachedRoutes: [],
    ...overrides
  }
}

const LINKS = [
  { href: '/llms.txt', rel: 'describedby', type: 'text/plain', title: 'llms.txt' },
  { href: '/.well-known/api-catalog', rel: 'api-catalog' }
]

/** Everything a request would go through, in order, until one rewrites it. */
function rewrites(routes: VercelRoute[]): VercelRoute[] {
  return routes.filter(route => route.dest)
}

function matches(route: VercelRoute, path: string): boolean {
  return new RegExp(route.src).test(path)
}

function rewrite(route: VercelRoute, path: string): string {
  return path.replace(new RegExp(route.src), route.dest || '')
}

describe('vercelMarkdownRoutes: Vary', () => {
  const [vary] = vercelMarkdownRoutes(createConfig())

  it('comes first and keeps routing', () => {
    expect(vary?.continue).toBe(true)
    expect(vary?.dest).toBeUndefined()
    expect(vary?.headers).toEqual({ Vary: 'Accept, User-Agent' })
  })

  it('covers every negotiated page', () => {
    expect(matches(vary!, '/')).toBe(true)
    expect(matches(vary!, '/docs/foo')).toBe(true)
    expect(matches(vary!, '/docs/3.x/guide')).toBe(true)
  })

  it('skips the excluded prefixes', () => {
    expect(matches(vary!, '/api/x')).toBe(false)
    expect(matches(vary!, '/_nuxt/x')).toBe(false)
    expect(matches(vary!, '/raw/docs/foo')).toBe(false)
    expect(matches(vary!, '/blog/x')).toBe(false)
  })

  it('covers the .md twin of an exact pattern', () => {
    const [exact] = vercelMarkdownRoutes(createConfig({ routes: [{ path: '/changelog' }] }))
    expect(matches(exact!, '/changelog')).toBe(true)
    expect(matches(exact!, '/changelog.md')).toBe(true)
  })
})

describe('vercelMarkdownRoutes: Link', () => {
  it('emits a continue route on the homepage when links exist', () => {
    const config = createConfig({ links: LINKS })
    const link = vercelMarkdownRoutes(config)[1]
    expect(link?.src).toBe('^/$')
    expect(link?.continue).toBe(true)
    expect(link?.headers).toEqual({ Link: formatLinkHeader(LINKS) })
  })

  it('is absent without links', () => {
    const routes = vercelMarkdownRoutes(createConfig())
    expect(routes.filter(route => route.headers?.Link)).toHaveLength(0)
    expect(routes[1]?.dest).toBeDefined()
  })
})

describe('vercelMarkdownRoutes: route count', () => {
  it('emits 3 rewrites per glob pattern and 2 for the exact root', () => {
    const routes = vercelMarkdownRoutes(createConfig())
    expect(rewrites(routes).filter(route => route.dest === '/raw/docs/$1.md')).toHaveLength(3)
    expect(rewrites(routes).filter(route => route.dest === '/raw/index.md')).toHaveLength(2)
    expect(routes).toHaveLength(6)
  })

  it('emits 3 rewrites for an exact pattern that is not the root', () => {
    const routes = vercelMarkdownRoutes(createConfig({ routes: [{ path: '/changelog' }] }))
    expect(rewrites(routes).filter(route => route.dest === '/raw/changelog.md')).toHaveLength(3)
    expect(routes).toHaveLength(4)
  })

  it('stays O(patterns), never O(pages)', () => {
    const base = createConfig()
    const many = createConfig({ routes: [...base.routes, { path: '/blog/**' }, { path: '/*/docs/**' }] })
    expect(vercelMarkdownRoutes(base)).toHaveLength(6)
    expect(vercelMarkdownRoutes(many)).toHaveLength(6 + 3 + 3)
    // Nothing in the table depends on the pages behind a pattern.
    expect(JSON.stringify(vercelMarkdownRoutes(base))).not.toContain('foo')
  })
})

describe('vercelMarkdownRoutes: negotiated rewrites', () => {
  const routes = vercelMarkdownRoutes(createConfig())
  const docs = rewrites(routes).filter(route => route.dest === '/raw/docs/$1.md')
  const twin = docs.find(route => !route.has)
  const negotiated = docs.filter(route => route.has)

  it('pairs an Accept matcher and a User-Agent matcher on one source', () => {
    expect(negotiated).toHaveLength(2)
    expect(negotiated[0]?.src).toBe(negotiated[1]?.src)
    expect(negotiated.every(route => route.check)).toBe(true)
    expect(negotiated[0]?.has).toEqual([{ type: 'header', key: 'accept', value: '(.*)text/markdown(.*)' }])
    expect(negotiated[1]?.has?.[0]?.key).toBe('user-agent')
  })

  it('matches pages, not .md URLs, assets or excluded prefixes', () => {
    const route = negotiated[0]!
    expect(matches(route, '/docs/foo')).toBe(true)
    expect(matches(route, '/docs/3.x/guide')).toBe(true)
    expect(matches(route, '/docs/foo.md')).toBe(false)
    expect(matches(route, '/docs/foo/_payload.json')).toBe(false)
    expect(matches(route, '/api/x')).toBe(false)
    expect(matches(route, '/raw/docs/foo')).toBe(false)
  })

  it('rewrites a page to its raw markdown twin', () => {
    expect(rewrite(negotiated[0]!, '/docs/foo')).toBe('/raw/docs/foo.md')
    expect(rewrite(negotiated[0]!, '/docs/3.x/guide')).toBe('/raw/docs/3.x/guide.md')
  })

  it('rewrites an explicit .md URL with no matcher at all', () => {
    expect(twin?.has).toBeUndefined()
    expect(twin?.check).toBeUndefined()
    expect(rewrite(twin!, '/docs/foo.md')).toBe('/raw/docs/foo.md')
    expect(matches(twin!, '/api/foo.md')).toBe(false)
  })

  it('rewrites the exact root through its explicit raw destination', () => {
    const root = rewrites(routes).filter(route => route.dest === '/raw/index.md')
    expect(root.every(route => route.src === '^/$')).toBe(true)
    expect(root.every(route => route.check)).toBe(true)
    expect(matches(root[0]!, '/docs/foo')).toBe(false)
  })

  it('rewrites a locale pattern through both wildcards', () => {
    const locale = rewrites(vercelMarkdownRoutes(createConfig({ routes: [{ path: '/*/docs/**' }] })))
    expect(locale.every(route => route.dest === '/raw/$1/docs/$2.md')).toBe(true)
    const localeTwin = locale.find(route => !route.has)!
    const localeNegotiated = locale.find(route => route.has)!
    expect(rewrite(localeTwin, '/fr/docs/guide.md')).toBe('/raw/fr/docs/guide.md')
    expect(rewrite(localeNegotiated, '/fr/docs/guide')).toBe('/raw/fr/docs/guide.md')
    expect(matches(localeNegotiated, '/docs/guide')).toBe(false)
  })
})

describe('vercelMarkdownRoutes: user-agent matcher', () => {
  const config = createConfig()
  const uaRoute = vercelMarkdownRoutes(config).find(route => route.has?.[0]?.key === 'user-agent')
  const value = uaRoute?.has?.[0]?.value || ''

  it('escapes regex specials', () => {
    expect(value).toBe('.*(ClaudeBot|GPTBot|curl/8\\.4).*')
    expect(new RegExp(value).test('curl/8x4')).toBe(false)
  })

  it('includes every configured agent', () => {
    for (const agent of config.userAgents) {
      expect(new RegExp(value).test(`Mozilla/5.0 (compatible; ${agent}/1.0)`)).toBe(true)
    }
    expect(new RegExp(value).test('Mozilla/5.0 (Macintosh) Chrome/131.0')).toBe(false)
  })

  it('stays case-sensitive, like the runtime', () => {
    expect(new RegExp(value).test('claudebot/1.0')).toBe(false)
  })
})
