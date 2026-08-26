import { describe, it, expect } from 'vitest'
import { vercelMarkdownRoutes } from '../../src/presets/vercel'
import type { VercelRoute } from '../../src/presets/vercel'
import { formatLinkHeader, MARKDOWN_VARY } from '../../src/runtime/shared/negotiation'
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
    sitemapSections: { expand: [], labels: {} },
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

describe('vercelMarkdownRoutes: cached routes', () => {
  // Everything under `/docs` is ISR, the root is prerendered.
  const config = createConfig({ cachedRoutes: ['/docs/**'] })
  const routes = vercelMarkdownRoutes(config)
  const docs = routes.filter(route => route.headers?.Location === '/raw/docs/$1.md')
  const root = routes.filter(route => route.dest === '/raw/index.md')

  it('redirects instead of rewriting on a cached pattern', () => {
    expect(docs).toHaveLength(2)
    for (const route of docs) {
      expect(route.status).toBe(307)
      expect(route.dest).toBeUndefined()
      expect(route.check).toBeUndefined()
      expect(route.headers?.Vary).toBe(MARKDOWN_VARY)
    }
    expect(docs[0]?.has?.[0]?.key).toBe('accept')
    expect(docs[1]?.has?.[0]?.key).toBe('user-agent')
  })

  it('expands the wildcard captures into `Location`', () => {
    const route = docs[0]!
    expect(matches(route, '/docs/foo')).toBe(true)
    expect('/docs/3.x/guide'.replace(new RegExp(route.src), route.headers!.Location!)).toBe('/raw/docs/3.x/guide.md')
  })

  it('leaves the query string to the CDN, which re-attaches it itself', () => {
    // Vercel matches `src` against the pathname excluding the querystring and
    // passes the incoming query on to the destination, so a `Location` of its
    // own would end up duplicating it. `/compare?tools=cursor,zed` reaches
    // `/raw/compare.md?tools=cursor,zed`, which is what the middleware builds
    // by hand on the presets that have no CDN in front of them.
    for (const route of routes) {
      expect(route.headers?.Location || '').not.toContain('?')
      expect(route.dest || '').not.toContain('?')
    }
    expect('/docs/compare'.replace(new RegExp(docs[0]!.src), docs[0]!.headers!.Location!)).toBe('/raw/docs/compare.md')
  })

  it('leaves the uncached patterns rewriting', () => {
    expect(root).toHaveLength(2)
    expect(root.every(route => route.check && !route.status)).toBe(true)
  })

  it('keeps the `.md` twin a rewrite: one variant per URL, nothing to poison', () => {
    const twin = routes.find(route => route.dest === '/raw/docs/$1.md')
    expect(twin).toBeDefined()
    expect(twin!.has).toBeUndefined()
    expect(twin!.status).toBeUndefined()
    expect(rewrite(twin!, '/docs/foo.md')).toBe('/raw/docs/foo.md')
  })

  it('still labels cached pages with `Vary` through the leading continue route', () => {
    expect(routes[0]?.continue).toBe(true)
    expect(matches(routes[0]!, '/docs/foo')).toBe(true)
  })

  it('matches a route rule by static prefix, whatever the wildcards are', () => {
    // `/docs/**` the rule, `/docs/*/api` the pattern: same prefix, still cached.
    const nested = vercelMarkdownRoutes(createConfig({
      routes: [{ path: '/docs/*/api' }],
      cachedRoutes: ['/docs/**']
    }))
    expect(nested.filter(route => route.status === 307)).toHaveLength(2)
  })

  it('does not redirect a pattern that no rule overlaps', () => {
    const other = vercelMarkdownRoutes(createConfig({
      routes: [{ path: '/blog/**' }],
      cachedRoutes: ['/docs/**']
    }))
    expect(other.filter(route => route.status === 307)).toHaveLength(0)
  })

  it('does not demote a broad pattern because one narrow rule is cached', () => {
    // The default route set with a single ISR section. Marking `/**` cached
    // would turn every page on the site into a redirect.
    const routes = vercelMarkdownRoutes(createConfig({
      routes: [{ path: '/', raw: '/raw/index.md' }, { path: '/**' }],
      cachedRoutes: ['/docs/**']
    }))

    const catchAll = routes.filter(route => route.dest === '/raw/$1.md')
    expect(catchAll.every(route => !route.status)).toBe(true)
    expect(routes.filter(route => route.dest === '/raw/index.md').every(route => !route.status)).toBe(true)

    // The cached section gets its own redirect pair, ahead of that rewrite.
    const cached = routes.filter(route => route.status === 307)
    expect(cached).toHaveLength(2)
    expect(cached.every(route => route.headers?.Location === '/raw/docs/$1.md')).toBe(true)
    expect(routes.indexOf(cached[0]!)).toBeLessThan(routes.indexOf(catchAll[0]!))
    expect(matches(cached[0]!, '/docs/guide')).toBe(true)
    expect(matches(cached[0]!, '/about')).toBe(false)
  })

  it('redirects the whole pattern when the rule covers it', () => {
    const routes = vercelMarkdownRoutes(createConfig({
      routes: [{ path: '/docs/**' }],
      cachedRoutes: ['/**']
    }))

    expect(routes.filter(route => route.status === 307)).toHaveLength(2)
    expect(routes.filter(route => route.dest === '/raw/docs/$1.md')).toHaveLength(1)
  })

  it('keeps the table the same size either way', () => {
    expect(routes.length).toBe(vercelMarkdownRoutes(createConfig()).length)
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
