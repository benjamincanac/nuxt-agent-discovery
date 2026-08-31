import { describe, it, expect } from 'vitest'
import { vercelMarkdownRoutes } from '../../src/presets/vercel'
import type { VercelRoute } from '../../src/presets/vercel'
import { acceptsMarkdown, formatLinkHeader, MARKDOWN_VARY } from '../../src/runtime/shared/negotiation'
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
    linkHeader: true,
    cachedRoutes: [],
    sitemapSections: { expand: [], labels: {} },
    notAcceptable: false,
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

  // This route labels the HTML half only. The markdown half is the next one,
  // so that each says why it is there.
  it('leaves the documents that never serve HTML alone', () => {
    const [exact] = vercelMarkdownRoutes(createConfig({ routes: [{ path: '/changelog' }] }))
    expect(matches(exact!, '/changelog')).toBe(true)
    expect(matches(exact!, '/changelog.md')).toBe(false)

    expect(matches(vary!, '/llms.txt')).toBe(false)
    expect(matches(vary!, '/robots.txt')).toBe(false)
    expect(matches(vary!, '/sitemap.xml')).toBe(false)
    expect(matches(vary!, '/logo.png')).toBe(false)
    expect(matches(vary!, '/docs/foo.md')).toBe(false)
  })
})

// A negotiated page rewrites or 307s to one of these, so this is the response
// a client keeps and a shared cache stores. Labelling only the page leaves the
// URL the hop lands on saying nothing about the pair behind it.
describe('vercelMarkdownRoutes: Vary on the markdown representations', () => {
  const config = createConfig({ links: [{ href: '/sitemap.md', rel: 'sitemap', type: 'text/markdown' }] })
  const markdown = vercelMarkdownRoutes(config)[1]

  it('comes second and keeps routing, ahead of the rewrites below it', () => {
    expect(markdown?.continue).toBe(true)
    expect(markdown?.dest).toBeUndefined()
    expect(markdown?.headers).toEqual({ Vary: MARKDOWN_VARY })
  })

  it('covers the raw prefix, the `.md` twins and `/sitemap.md`', () => {
    expect(matches(markdown!, '/raw/index.md')).toBe(true)
    expect(matches(markdown!, '/raw/docs/foo.md')).toBe(true)
    expect(matches(markdown!, '/docs/foo.md')).toBe(true)
    expect(matches(markdown!, '/docs/3.x/guide.md')).toBe(true)
    expect(matches(markdown!, '/sitemap.md')).toBe(true)
  })

  it('leaves the pages and the other documents alone', () => {
    expect(matches(markdown!, '/docs/foo')).toBe(false)
    expect(matches(markdown!, '/')).toBe(false)
    expect(matches(markdown!, '/llms.txt')).toBe(false)
    expect(matches(markdown!, '/sitemap.xml')).toBe(false)
    expect(matches(markdown!, '/logo.png')).toBe(false)
  })

  it('covers the twin of an exact pattern, and skips the root which has none', () => {
    const [, exact] = vercelMarkdownRoutes(createConfig({ routes: [{ path: '/' }, { path: '/changelog' }] }))
    expect(matches(exact!, '/changelog.md')).toBe(true)
    expect(matches(exact!, '/.md')).toBe(false)
  })

  it('follows `rawPrefix`', () => {
    const [, moved] = vercelMarkdownRoutes(createConfig({ rawPrefix: '/md' }))
    expect(matches(moved!, '/md/docs/foo.md')).toBe(true)
    expect(matches(moved!, '/raw/docs/foo.md')).toBe(false)
  })

  // Keyed on the registered link: a site serving its own through
  // `discovery.links` needs the label just as much as one using the route.
  it('skips `/sitemap.md` when no link registers it', () => {
    const [, none] = vercelMarkdownRoutes(createConfig())
    expect(matches(none!, '/sitemap.md')).toBe(false)
  })
})

// The edge half of the opt-in 406. A prerendered page is answered off the
// filesystem and never reaches the middleware, so without this the option
// would be on for the pages Nitro renders and off for the rest of the site.
describe('vercelMarkdownRoutes: 406', () => {
  const strict = createConfig({ notAcceptable: true })
  const refusal = vercelMarkdownRoutes(strict).find(route => route.status === 406)!
  const matcher = (route: VercelRoute, key: string, list: 'has' | 'missing') =>
    route[list]?.find(entry => entry.key === key)?.value
  /** The `missing` `Accept` matcher, read the way the edge reads it: anchored, case-insensitive. */
  const accepts = (route: VercelRoute) => (header: string) =>
    new RegExp(`^(?:${matcher(route, 'accept', 'missing')})$`, 'i').test(header)

  it('is absent unless the site turns it on', () => {
    expect(vercelMarkdownRoutes(createConfig()).some(route => route.status === 406)).toBe(false)
    expect(refusal).toBeDefined()
  })

  it('answers the status itself, on the negotiated pages only', () => {
    expect(refusal.dest).toBeUndefined()
    expect(refusal.continue).toBeUndefined()
    expect(refusal.headers).toEqual({ Vary: MARKDOWN_VARY })
    expect(matches(refusal, '/docs/foo')).toBe(true)
    expect(matches(refusal, '/docs/foo.md')).toBe(false)
    expect(matches(refusal, '/api/x')).toBe(false)
    expect(matches(refusal, '/logo.png')).toBe(false)
  })

  // The middleware's guards, as matchers: an `Accept` has to be there and
  // carry a media range, must not offer a representation, and a navigation or
  // a known agent is never refused.
  it('carries the same guards the middleware applies', () => {
    const offers = accepts(refusal)
    expect(offers('text/html,application/xhtml+xml,*/*;q=0.8')).toBe(true)
    expect(offers('*/*')).toBe(true)
    expect(offers('text/*')).toBe(true)
    expect(offers('text/markdown')).toBe(true)
    expect(offers('application/xml')).toBe(false)
    expect(offers('image/png, application/pdf')).toBe(false)

    // Present and carrying a media range, so a mangled header cannot refuse.
    // Both halves have to be there, or the edge would 406 what the origin
    // serves, which is the one divergence this route cannot have.
    const present = new RegExp(`^(?:${matcher(refusal, 'accept', 'has')})$`, 'i')
    expect(present.test('application/xml')).toBe(true)
    expect(present.test('image/png, application/pdf')).toBe(true)
    expect(present.test('garbage')).toBe(false)
    expect(present.test('text/')).toBe(false)
    expect(present.test('/html')).toBe(false)
    expect(present.test('text/html/extra')).toBe(false)

    expect(matcher(refusal, 'sec-fetch-mode', 'missing')).toBe('navigate')
    expect(matcher(refusal, 'user-agent', 'missing')).toContain('ClaudeBot')
  })

  // A bare substring matched a supported type inside a parameter value, so
  // `application/json;profile="text/html"` read as offering HTML when the only
  // range in it is JSON. Anchored at media-range boundaries the same way the
  // rewrite matcher already was.
  it('does not read a supported type out of a parameter value', () => {
    const offers = accepts(refusal)
    expect(offers('application/json;profile="text/html"')).toBe(false)
    expect(offers('application/json;profile="text/markdown", image/png')).toBe(false)
    expect(offers('text/htmlish')).toBe(false)
    // The real range still counts wherever it sits in the list.
    expect(offers('application/json;profile="x", text/html')).toBe(true)
  })

  // A comma inside a quoted value is not a list separator, so the fragment
  // after it is not the head of a new media range. Reading it as one put the
  // quoted `text/html` at the front of an entry and skipped the refusal.
  it('does not split the header on a comma inside a quoted value', () => {
    const offers = accepts(refusal)
    expect(offers('application/json;profile="x,text/html;q=0"')).toBe(false)
    expect(offers('application/json;profile="a,text/markdown"')).toBe(false)
    // A separator outside the quotes still separates.
    expect(offers('application/json;profile="a,b", text/html')).toBe(true)
  })

  // A matcher is a plain regex over the raw header, so a representation
  // offered and then refused at `q=0` still reads as offered. The edge serves
  // the page where the origin answers 406, which is the fail-safe direction.
  it('is lenient about `q=0` where the runtime is strict', () => {
    expect(accepts(refusal)('text/markdown;q=0')).toBe(true)
  })

  it('drops the user-agent guard when the site emptied the agent list', () => {
    const none = vercelMarkdownRoutes(createConfig({ notAcceptable: true, userAgents: [] })).find(route => route.status === 406)!
    expect(none.missing?.some(entry => entry.key === 'user-agent')).toBe(false)
  })
})

describe('vercelMarkdownRoutes: Link', () => {
  it('emits a continue route on the homepage when links exist', () => {
    const config = createConfig({ links: LINKS })
    const link = vercelMarkdownRoutes(config).find(route => route.src === '^/$' && route.continue)
    expect(link).toBeDefined()
    expect(link?.headers).toEqual({ Link: formatLinkHeader(LINKS) })
  })

  it('is absent without links', () => {
    const routes = vercelMarkdownRoutes(createConfig())
    // The canonical/alternate pairs on the twins stay; only the homepage
    // discovery route is keyed on the registry.
    expect(routes.filter(route => route.src === '^/$' && route.headers?.Link)).toHaveLength(0)
  })
})

describe('vercelMarkdownRoutes: route count', () => {
  it('emits 3 rewrites per glob pattern and 2 for the exact root, behind the two `Vary` routes', () => {
    const routes = vercelMarkdownRoutes(createConfig())
    expect(rewrites(routes).filter(route => route.dest === '/raw/docs/$1.md')).toHaveLength(3)
    expect(rewrites(routes).filter(route => route.dest === '/raw/index.md')).toHaveLength(2)
    // 7 rewrites/headers plus the 3 canonical Link routes on the twins.
    expect(routes).toHaveLength(10)
  })

  it('emits 3 rewrites for an exact pattern that is not the root', () => {
    const routes = vercelMarkdownRoutes(createConfig({ routes: [{ path: '/changelog' }] }))
    expect(rewrites(routes).filter(route => route.dest === '/raw/changelog.md')).toHaveLength(3)
    // 5 rewrites/headers plus 3 canonical Link routes: the page twin, the raw
    // twin, and the root twin the generated index serves on every config.
    expect(routes).toHaveLength(8)
  })

  it('stays O(patterns), never O(pages)', () => {
    const base = createConfig()
    const many = createConfig({ routes: [...base.routes, { path: '/blog/**' }, { path: '/*/docs/**' }] })
    expect(vercelMarkdownRoutes(base)).toHaveLength(10)
    // Each extra glob pattern adds 3 rewrites and 2 canonical Link routes.
    expect(vercelMarkdownRoutes(many)).toHaveLength(10 + 5 + 5)
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
    expect(negotiated[0]?.has?.[0]).toMatchObject({ type: 'header', key: 'accept' })
    expect(negotiated[1]?.has?.[0]?.key).toBe('user-agent')
  })

  // The matcher has to agree with `acceptsMarkdown`, so it is asserted through
  // headers rather than through its source. `text/markdown` has to head a media
  // range: as a bare substring it also matched inside a parameter value.
  it('matches `Accept` the way the negotiation core does', () => {
    const accept = (header: string) => new RegExp(`^(?:${negotiated[0]!.has![0]!.value})$`).test(header)

    expect(accept('text/markdown')).toBe(true)
    expect(accept('text/markdown;q=0.9')).toBe(true)
    expect(accept('text/html, text/markdown')).toBe(true)
    expect(accept('text/html;profile="text/markdown"')).toBe(false)
    expect(accept('text/html')).toBe(false)
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
    expect(root.every(route => matches(route, '/'))).toBe(true)
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

  // A rule only demotes a pattern it covers *entirely*. Comparing static-prefix
  // lengths instead tied `/` with `/**`, so one cached page took the whole site
  // down to redirects with it.
  it('does not let a cached `/` demote every other pattern', () => {
    const site = vercelMarkdownRoutes(createConfig({
      routes: [{ path: '/', raw: '/raw/index.md' }, { path: '/**' }],
      cachedRoutes: ['/']
    }))

    const home = site.filter(route => route.headers?.Location === '/raw/index.md')
    expect(home).toHaveLength(2)
    expect(home.every(route => route.status === 307)).toBe(true)

    const rest = site.filter(route => route.dest === '/raw/$1.md' && route.has)
    expect(rest).toHaveLength(2)
    expect(rest.every(route => route.check && !route.status)).toBe(true)
  })

  // radix3 reads `**` as zero or more segments, so `/docs/**` caches `/docs`
  // itself. Reading the rule with `compilePattern`, one or more, left the
  // section root rewriting onto a cache that really exists.
  it('treats a section root as cached by its own `**` rule', () => {
    const site = vercelMarkdownRoutes(createConfig({
      routes: [{ path: '/' }, { path: '/docs' }],
      cachedRoutes: ['/docs/**']
    }))

    const docs = site.filter(route => route.headers?.Location === '/raw/docs.md')
    expect(docs).toHaveLength(2)
    expect(docs.every(route => route.status === 307)).toBe(true)
    expect(site.some(route => route.dest === '/raw/docs.md' && route.has)).toBe(false)
  })

  it('emits one redirect per path, never two', () => {
    const site = vercelMarkdownRoutes(createConfig({
      routes: [{ path: '/' }, { path: '/docs/**' }],
      cachedRoutes: ['/docs/**', '/docs/api/**']
    }))

    for (const path of ['/', '/docs/guide', '/docs/api/x']) {
      const hit = site.filter(route => route.status === 307 && matches(route, path))
      expect(hit.length).toBeLessThanOrEqual(2)
      const targets = new Set(hit.map(route => path.replace(new RegExp(route.src), route.headers!.Location!)))
      expect(targets.size).toBeLessThanOrEqual(1)
    }
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

describe('vercelMarkdownRoutes: explicit markdown refusal', () => {
  const routes = vercelMarkdownRoutes(createConfig())
  const accept = routes.filter(route => route.has?.[0]?.key === 'accept')
  const userAgent = routes.filter(route => route.has?.[0]?.key === 'user-agent')

  /** How Vercel evaluates a matcher value: RE2, anchored on the whole header. */
  const refuses = (header: string) => new RegExp(`^(?:${accept[0]!.missing![0]!.value})$`).test(header)

  it('guards every `Accept` route and no other', () => {
    expect(accept.length).toBeGreaterThan(0)
    for (const route of accept) {
      expect(route.missing).toEqual([{ type: 'header', key: 'accept', value: expect.any(String) }])
    }
    // A known agent user agent gets markdown whatever its `Accept` says, the
    // same as `negotiatedRawPath`.
    for (const route of userAgent) {
      expect(route.missing).toBeUndefined()
    }
  })

  it('matches the headers that refuse markdown', () => {
    for (const header of [
      'text/markdown;q=0',
      'text/markdown;q=0, text/html',
      'text/markdown; q=0',
      'text/markdown;Q=0',
      'text/markdown;q=0.0',
      'text/markdown;q=0.000',
      'text/html, text/markdown;q=0'
    ]) {
      expect(refuses(header), header).toBe(true)
      // The whole point: the runtime says no too, so edge and origin agree.
      expect(acceptsMarkdown(header), header).toBe(false)
    }
  })

  it('leaves every real quality alone', () => {
    for (const header of [
      'text/markdown',
      'text/markdown;q=1',
      'text/markdown;q=0.5',
      'text/markdown;q=0.05',
      'text/markdown, text/html;q=0.9',
      'text/html;q=0, text/markdown'
    ]) {
      expect(refuses(header), header).toBe(false)
      expect(acceptsMarkdown(header), header).toBe(true)
    }
  })

  it('cannot express full q-value precedence, a known divergence', () => {
    // `text/html` outranks markdown, so the origin returns HTML while the edge
    // rewrites. Nothing a regex matcher can say, so it stays documented rather
    // than half-solved.
    expect(acceptsMarkdown('text/markdown;q=0.1, text/html;q=0.9')).toBe(false)
    expect(refuses('text/markdown;q=0.1, text/html;q=0.9')).toBe(false)
  })
})

describe('vercelMarkdownRoutes: methods', () => {
  it('scopes every route to GET/HEAD, matching the middleware', () => {
    // The negotiation middleware returns early for anything but GET/HEAD, so
    // an unscoped edge route 406ed or rewrote a POST the origin would serve.
    const config = createConfig({ notAcceptable: true, cachedRoutes: ['/docs/**'], links: LINKS })

    for (const route of vercelMarkdownRoutes(config)) {
      if (route.src === '^/$' && route.headers?.Link) {
        // The homepage Link route stands in for the `/` route rule, which the
        // origin applies to every method.
        expect(route.methods).toBeUndefined()
      } else {
        expect(route.methods, route.src).toEqual(['GET', 'HEAD'])
      }
    }
  })
})

describe('vercelMarkdownRoutes: canonical Link on the twins', () => {
  const routes = vercelMarkdownRoutes(createConfig())
  const linkRoutes = routes.filter(route => route.continue && route.headers?.Link?.includes('rel="canonical"'))

  it('labels both twin URL spaces of a wildcard pattern', () => {
    // A prerendered twin is answered off the filesystem, so the handler that
    // sets this header never runs and the table has to say it instead.
    for (const path of ['/docs/button.md', '/raw/docs/button.md']) {
      const route = linkRoutes.find(candidate => matches(candidate, path))
      expect(route, path).toBeDefined()
      const link = path.replace(new RegExp(route!.src), route!.headers!.Link!)
      expect(link).toBe(formatLinkHeader([
        { href: 'https://example.com/docs/button', rel: 'canonical' },
        { href: 'https://example.com/docs/button', rel: 'alternate', type: 'text/html' }
      ]))
    }
  })

  it('maps an exact raw override to its page, not to the capture', () => {
    const index = linkRoutes.filter(route => matches(route, '/raw/index.md'))

    expect(index).toHaveLength(1)
    expect(index[0]!.headers!.Link).toContain('<https://example.com>; rel="canonical"')
    expect(index[0]!.headers!.Link).not.toContain('/index')
  })

  it('skips a raw destination the site serves itself', () => {
    // An exact `raw` under an excluded prefix is the site's own document: no
    // entry for it, and no garbage sliced into the wildcard's lookahead.
    const routes = vercelMarkdownRoutes(createConfig({
      routes: [{ path: '/design', raw: '/design.md' }, { path: '/**' }],
      excludePrefixes: ['/_', '/api/', '/design.md']
    }))
    const links = routes.filter(route => route.continue && route.headers?.Link?.includes('rel="canonical"'))

    expect(links.some(route => matches(route, '/design.md'))).toBe(false)
    expect(routes.some(route => route.src.includes('(?:ign'))).toBe(false)
    expect(links.filter(route => matches(route, '/raw/index.md'))).toHaveLength(1)
  })

  it('maps the root twin to the site URL when only a wildcard covers `/`', () => {
    const routes = vercelMarkdownRoutes(createConfig({ routes: [{ path: '/**' }] }))
    const links = routes.filter(route => route.continue && route.headers?.Link?.includes('rel="canonical"'))
    const index = links.filter(route => matches(route, '/raw/index.md'))

    expect(index).toHaveLength(1)
    expect(index[0]!.headers!.Link).toContain('<https://example.com>; rel="canonical"')
    expect(index[0]!.headers!.Link).not.toContain('/index')
  })

  it('leaves an index-shaped twin to its frontmatter', () => {
    // `/docs/index.md` folds to `/docs` at the origin, so a capture-derived
    // header would advertise a page URL the handler never serves. No pair
    // beats a wrong one: the document still carries `canonical_url`.
    for (const path of ['/index.md', '/docs/index.md', '/raw/docs/index.md']) {
      expect(linkRoutes.some(route => matches(route, path)), path).toBe(false)
    }
  })

  it('keeps the root twin entry when `/` negotiates through another raw', () => {
    // The guard is keyed on the twin having an owner, not on a `/` route
    // existing: with a `raw` override the route no longer names
    // `/raw/index.md`, which the origin serves regardless.
    const routes = vercelMarkdownRoutes(createConfig({ routes: [{ path: '/', raw: '/raw/home.md' }, { path: '/**' }] }))
    const links = routes.filter(route => route.continue && route.headers?.Link?.includes('rel="canonical"'))
    const index = links.filter(route => matches(route, '/raw/index.md'))

    expect(index).toHaveLength(1)
    expect(index[0]!.headers!.Link).toContain('<https://example.com>; rel="canonical"')
    expect(links.filter(route => matches(route, '/raw/home.md'))).toHaveLength(1)
  })

  it('collapses routes naming the same twin into one entry', () => {
    // `/` and `/index` both map to `/raw/index.md`: two entries would stack
    // two conflicting headers on one response, and the origin folds `/index`
    // into `/` anyway.
    const routes = vercelMarkdownRoutes(createConfig({ routes: [{ path: '/' }, { path: '/index' }, { path: '/**' }] }))
    const links = routes.filter(route => route.continue && route.headers?.Link?.includes('rel="canonical"'))
    const index = links.filter(route => matches(route, '/raw/index.md'))

    expect(index).toHaveLength(1)
    expect(index[0]!.headers!.Link).toContain('<https://example.com>; rel="canonical"')
    expect(links.some(route => matches(route, '/index.md'))).toBe(false)
  })

  it('emits nothing without a configured site URL', () => {
    // The value embeds the page URL and the edge cannot know the request
    // host at build time, so the origin-rendered responses keep the header
    // and the prerendered twins go without, the pre-existing behavior.
    const bare = vercelMarkdownRoutes(createConfig({ siteUrl: '' }))

    expect(bare.some(route => route.headers?.Link?.includes('rel="canonical"'))).toBe(false)
  })
})
