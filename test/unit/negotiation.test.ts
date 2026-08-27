import { describe, it, expect } from 'vitest'
import {
  MARKDOWN_VARY,
  absolutizeMarkdownLinks,
  acceptQuality,
  acceptsMarkdown,
  compilePattern,
  errorMarkdown,
  formatLinkHeader,
  hasFileExtension,
  isNegotiablePath,
  matchRoute,
  negotiatedRawPath,
  normalizeAgentRoute,
  notAcceptable,
  normalizePathname,
  parseAccept,
  patternsOverlap,
  prefersMarkdownError,
  rawDestination,
  ruleCoversPattern,
  ruleMatchesPath,
  staticPrefix
} from '../../src/runtime/shared/negotiation'
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

const config = createConfig()
const CLAUDE_BOT = 'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)'

describe('normalizePathname', () => {
  it('defaults to the root', () => {
    expect(normalizePathname('')).toBe('/')
  })

  it('drops the query string and the hash', () => {
    expect(normalizePathname('/docs/foo?utm=1')).toBe('/docs/foo')
    expect(normalizePathname('/docs/foo#anchor')).toBe('/docs/foo')
  })

  it('drops a trailing slash but keeps the root', () => {
    expect(normalizePathname('/docs/foo/')).toBe('/docs/foo')
    expect(normalizePathname('/')).toBe('/')
  })
})

describe('hasFileExtension', () => {
  it('only looks at the last segment', () => {
    expect(hasFileExtension('/docs/foo/_payload.json')).toBe(true)
    expect(hasFileExtension('/docs/logo.png')).toBe(true)
    expect(hasFileExtension('/docs/3.x/guide')).toBe(false)
    expect(hasFileExtension('/docs/foo')).toBe(false)
  })
})

describe('parseAccept', () => {
  it('returns nothing for a missing header', () => {
    expect(parseAccept(undefined)).toEqual([])
    expect(parseAccept(null)).toEqual([])
    expect(parseAccept('')).toEqual([])
  })

  it('parses media ranges with q-values', () => {
    expect(parseAccept('text/markdown;q=0.5, text/html')).toEqual([
      { type: 'text/markdown', q: 0.5 },
      { type: 'text/html', q: 1 }
    ])
  })

  it('lowercases media types', () => {
    expect(parseAccept('TEXT/Markdown')).toEqual([{ type: 'text/markdown', q: 1 }])
  })

  it('treats a malformed q-value as 1', () => {
    expect(parseAccept('text/markdown;q=abc')).toEqual([{ type: 'text/markdown', q: 1 }])
  })

  it('clamps q-values to [0, 1]', () => {
    expect(parseAccept('text/markdown;q=5')).toEqual([{ type: 'text/markdown', q: 1 }])
    expect(parseAccept('text/markdown;q=-2')).toEqual([{ type: 'text/markdown', q: 0 }])
  })

  it('ignores parameters other than q', () => {
    expect(parseAccept('text/markdown;charset=utf-8;q=0.4')).toEqual([{ type: 'text/markdown', q: 0.4 }])
  })
})

describe('acceptQuality', () => {
  it('prefers the exact type over a partial wildcard over the full wildcard', () => {
    const entries = parseAccept('*/*;q=0.1, text/*;q=0.5, text/html;q=0.9')
    expect(acceptQuality(entries, 'text/html')).toBe(0.9)
    expect(acceptQuality(entries, 'text/markdown')).toBe(0.5)
    expect(acceptQuality(entries, 'application/json')).toBe(0.1)
  })

  it('is 0 when nothing matches', () => {
    expect(acceptQuality(parseAccept('text/html'), 'application/json')).toBe(0)
  })
})

describe('acceptsMarkdown', () => {
  it('accepts a plain text/markdown request', () => {
    expect(acceptsMarkdown('text/markdown')).toBe(true)
  })

  it('rejects q=0', () => {
    expect(acceptsMarkdown('text/markdown;q=0')).toBe(false)
  })

  it('rejects markdown that html outranks', () => {
    expect(acceptsMarkdown('text/markdown;q=0.5, text/html')).toBe(false)
  })

  it('accepts markdown that outranks html', () => {
    expect(acceptsMarkdown('text/markdown;q=0.9, text/html;q=0.8')).toBe(true)
  })

  it('accepts markdown tied with html', () => {
    expect(acceptsMarkdown('text/markdown;q=0.8, text/html;q=0.8')).toBe(true)
  })

  it('never counts wildcards as asking', () => {
    expect(acceptsMarkdown('*/*')).toBe(false)
    expect(acceptsMarkdown('text/*')).toBe(false)
    expect(acceptsMarkdown('text/*;q=1, text/html;q=0.1')).toBe(false)
  })

  it('is case-insensitive on media types', () => {
    expect(acceptsMarkdown('TEXT/MARKDOWN')).toBe(true)
    expect(acceptsMarkdown('Text/Markdown;Q=0')).toBe(false)
  })

  it('treats a malformed q-value as 1', () => {
    expect(acceptsMarkdown('text/markdown;q=abc, text/html')).toBe(true)
  })

  it('rejects a missing header', () => {
    expect(acceptsMarkdown(undefined)).toBe(false)
  })
})

describe('negotiatedRawPath: headers', () => {
  it('serves markdown for Accept: text/markdown', () => {
    expect(negotiatedRawPath(config, '/docs/foo', { accept: 'text/markdown' })).toBe('/raw/docs/foo.md')
  })

  it('does not serve markdown for q=0', () => {
    expect(negotiatedRawPath(config, '/docs/foo', { accept: 'text/markdown;q=0' })).toBeUndefined()
  })

  it('does not serve markdown when html outranks it', () => {
    expect(negotiatedRawPath(config, '/docs/foo', { accept: 'text/markdown;q=0.5, text/html' })).toBeUndefined()
  })

  it('serves markdown when it outranks html', () => {
    expect(negotiatedRawPath(config, '/docs/foo', { accept: 'text/markdown;q=0.9, text/html;q=0.8' })).toBe('/raw/docs/foo.md')
  })

  it('does not serve markdown to wildcard-only clients', () => {
    expect(negotiatedRawPath(config, '/docs/foo', { accept: '*/*' })).toBeUndefined()
    expect(negotiatedRawPath(config, '/docs/foo', { accept: 'text/*' })).toBeUndefined()
  })

  it('treats a malformed q-value as 1', () => {
    expect(negotiatedRawPath(config, '/docs/foo', { accept: 'text/markdown;q=abc' })).toBe('/raw/docs/foo.md')
  })

  it('is case-insensitive on media types', () => {
    expect(negotiatedRawPath(config, '/docs/foo', { accept: 'Text/Markdown' })).toBe('/raw/docs/foo.md')
  })

  it('serves markdown to a known agent without an Accept header', () => {
    expect(negotiatedRawPath(config, '/docs/foo', { userAgent: CLAUDE_BOT })).toBe('/raw/docs/foo.md')
    expect(negotiatedRawPath(config, '/docs/foo', { userAgent: 'GPTBot/1.2' })).toBe('/raw/docs/foo.md')
  })

  it('matches user agents case-sensitively', () => {
    expect(negotiatedRawPath(config, '/docs/foo', { userAgent: 'claudebot/1.0' })).toBeUndefined()
  })

  it('does not serve markdown to a browser', () => {
    expect(negotiatedRawPath(config, '/docs/foo', {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      userAgent: 'Mozilla/5.0 (Macintosh) Chrome/131.0'
    })).toBeUndefined()
  })

  it('does not serve markdown without any hint', () => {
    expect(negotiatedRawPath(config, '/docs/foo')).toBeUndefined()
  })
})

describe('negotiatedRawPath: routes', () => {
  it('honours an explicit raw destination on an exact route', () => {
    expect(negotiatedRawPath(config, '/', { accept: 'text/markdown' })).toBe('/raw/index.md')
  })

  it('maps a wildcard match to the raw prefix', () => {
    expect(negotiatedRawPath(config, '/docs/foo', { accept: 'text/markdown' })).toBe('/raw/docs/foo.md')
    expect(negotiatedRawPath(config, '/docs/a/b/c', { accept: 'text/markdown' })).toBe('/raw/docs/a/b/c.md')
  })

  it('normalizes a trailing slash', () => {
    expect(negotiatedRawPath(config, '/docs/foo/', { accept: 'text/markdown' })).toBe('/raw/docs/foo.md')
  })

  it('strips the query string', () => {
    expect(negotiatedRawPath(config, '/docs/foo?ref=nav', { accept: 'text/markdown' })).toBe('/raw/docs/foo.md')
  })

  it('ignores a path no pattern matches', () => {
    expect(negotiatedRawPath(config, '/blog/x', { accept: 'text/markdown' })).toBeUndefined()
  })

  it('matches a single-segment wildcard for a locale prefix', () => {
    const i18n = createConfig({ routes: [{ path: '/*/docs/**' }] })
    expect(negotiatedRawPath(i18n, '/fr/docs/x', { accept: 'text/markdown' })).toBe('/raw/fr/docs/x.md')
    expect(negotiatedRawPath(i18n, '/docs/x', { accept: 'text/markdown' })).toBeUndefined()
  })
})

describe('negotiatedRawPath: explicit .md twins', () => {
  it('serves the twin whatever the headers say', () => {
    expect(negotiatedRawPath(config, '/docs/foo.md')).toBe('/raw/docs/foo.md')
    expect(negotiatedRawPath(config, '/docs/foo.md', { accept: 'text/html' })).toBe('/raw/docs/foo.md')
    expect(negotiatedRawPath(config, '/docs/foo.md', { accept: 'text/markdown;q=0' })).toBe('/raw/docs/foo.md')
  })

  it('never serves an excluded twin', () => {
    expect(negotiatedRawPath(config, '/api/foo.md')).toBeUndefined()
  })

  it('ignores a twin whose base matches no route', () => {
    expect(negotiatedRawPath(config, '/blog/x.md')).toBeUndefined()
  })
})

describe('negotiatedRawPath: exclusions', () => {
  it('never negotiates below the raw prefix', () => {
    expect(negotiatedRawPath(config, '/raw/docs/foo', { accept: 'text/markdown' })).toBeUndefined()
    expect(negotiatedRawPath(config, '/raw/docs/foo.md', { accept: 'text/markdown' })).toBeUndefined()
    expect(negotiatedRawPath(config, '/raw', { accept: 'text/markdown' })).toBeUndefined()
  })

  it('never negotiates excluded prefixes', () => {
    expect(negotiatedRawPath(config, '/api/x', { userAgent: CLAUDE_BOT })).toBeUndefined()
    expect(negotiatedRawPath(config, '/_nuxt/x', { userAgent: CLAUDE_BOT })).toBeUndefined()
    expect(negotiatedRawPath(config, '/.well-known/api-catalog', { userAgent: CLAUDE_BOT })).toBeUndefined()
    expect(negotiatedRawPath(config, '/mcp', { userAgent: CLAUDE_BOT })).toBeUndefined()
  })
})

describe('negotiatedRawPath: dotted paths', () => {
  it('leaves assets alone', () => {
    expect(negotiatedRawPath(config, '/docs/foo/_payload.json', { userAgent: CLAUDE_BOT })).toBeUndefined()
    expect(negotiatedRawPath(config, '/docs/logo.png', { accept: 'text/markdown' })).toBeUndefined()
  })

  it('negotiates a mid-path dot', () => {
    expect(negotiatedRawPath(config, '/docs/3.x/guide', { userAgent: CLAUDE_BOT })).toBe('/raw/docs/3.x/guide.md')
    expect(negotiatedRawPath(config, '/docs/3.x/guide', { accept: 'text/markdown' })).toBe('/raw/docs/3.x/guide.md')
  })
})

describe('prefersMarkdownError', () => {
  it('only answers GET and HEAD', () => {
    expect(prefersMarkdownError(config, { method: 'POST', path: '/docs/foo', accept: 'text/markdown' })).toBe(false)
    expect(prefersMarkdownError(config, { method: 'head', path: '/docs/foo', accept: 'text/markdown' })).toBe(true)
  })

  it('always answers markdown below the raw prefix', () => {
    expect(prefersMarkdownError(config, { path: '/raw/anything', accept: 'text/html' })).toBe(true)
  })

  it('keeps JSON errors on excluded prefixes', () => {
    expect(prefersMarkdownError(config, { path: '/api/x', accept: 'text/markdown' })).toBe(false)
    expect(prefersMarkdownError(config, { path: '/_nuxt/x', accept: 'text/markdown' })).toBe(false)
  })

  it('answers markdown on an explicit .md URL', () => {
    expect(prefersMarkdownError(config, { path: '/docs/foo.md', accept: 'text/html' })).toBe(true)
  })

  it('keeps the HTML error on an asset', () => {
    expect(prefersMarkdownError(config, { path: '/docs/logo.png' })).toBe(false)
  })

  it('answers markdown for Accept: text/markdown', () => {
    expect(prefersMarkdownError(config, { path: '/docs/foo', accept: 'text/markdown' })).toBe(true)
  })

  it('answers markdown for a known agent', () => {
    expect(prefersMarkdownError(config, { path: '/docs/foo', userAgent: CLAUDE_BOT })).toBe(true)
  })

  it('keeps the HTML error for a browser', () => {
    expect(prefersMarkdownError(config, { path: '/docs/foo', accept: 'text/html,*/*;q=0.8' })).toBe(false)
  })

  it('keeps the JSON error for an API client', () => {
    expect(prefersMarkdownError(config, { path: '/docs/foo', accept: 'application/json' })).toBe(false)
  })

  it('keeps the HTML error for a fetch() call', () => {
    expect(prefersMarkdownError(config, { path: '/docs/foo', accept: '*/*', secFetchMode: 'cors' })).toBe(false)
  })

  it('answers markdown on a navigation', () => {
    expect(prefersMarkdownError(config, { path: '/docs/foo', accept: '*/*', secFetchMode: 'navigate' })).toBe(true)
  })

  it('answers markdown to curl', () => {
    expect(prefersMarkdownError(config, { path: '/docs/foo', accept: '*/*' })).toBe(true)
  })

  it('answers markdown on an empty Accept', () => {
    expect(prefersMarkdownError(config, { path: '/docs/foo', accept: '' })).toBe(true)
    expect(prefersMarkdownError(config, { path: '/docs/foo' })).toBe(true)
  })
})

// The opt-in strict answer. Every case below that returns `false` is a page
// that used to render and has to keep rendering, which is why the option
// exists at all rather than this being the default.
describe('notAcceptable', () => {
  const strict = createConfig({ notAcceptable: true })

  it('is off unless the site turns it on', () => {
    expect(notAcceptable(config, { path: '/docs/foo', accept: 'application/xml' })).toBe(false)
    expect(notAcceptable(strict, { path: '/docs/foo', accept: 'application/xml' })).toBe(true)
  })

  it('refuses an `Accept` that rules out both representations', () => {
    expect(notAcceptable(strict, { path: '/docs/foo', accept: 'application/xml' })).toBe(true)
    expect(notAcceptable(strict, { path: '/docs/foo', accept: 'image/png, application/pdf' })).toBe(true)
    expect(notAcceptable(strict, { path: '/', accept: 'application/xml' })).toBe(true)
  })

  // A quality of zero is a refusal, so refusing both leaves nothing to send.
  it('reads `q=0` as a refusal', () => {
    expect(notAcceptable(strict, { path: '/docs/foo', accept: 'text/markdown;q=0' })).toBe(true)
    expect(notAcceptable(strict, { path: '/docs/foo', accept: 'text/html;q=0, text/markdown;q=0' })).toBe(true)
    // One of the two still acceptable is a page, not an error.
    expect(notAcceptable(strict, { path: '/docs/foo', accept: 'text/markdown;q=0, text/html' })).toBe(false)
    expect(notAcceptable(strict, { path: '/docs/foo', accept: 'application/xml, text/markdown;q=0.1' })).toBe(false)
  })

  it('leaves browsers and `fetch()` alone', () => {
    expect(notAcceptable(strict, { path: '/docs/foo', accept: 'text/html,application/xhtml+xml,*/*;q=0.8' })).toBe(false)
    expect(notAcceptable(strict, { path: '/docs/foo', accept: '*/*' })).toBe(false)
    expect(notAcceptable(strict, { path: '/docs/foo', accept: 'text/*' })).toBe(false)
    expect(notAcceptable(strict, { path: '/docs/foo', accept: '' })).toBe(false)
    expect(notAcceptable(strict, { path: '/docs/foo' })).toBe(false)
  })

  it('never refuses a navigation or a known agent', () => {
    expect(notAcceptable(strict, { path: '/docs/foo', accept: 'application/xml', secFetchMode: 'navigate' })).toBe(false)
    expect(notAcceptable(strict, { path: '/docs/foo', accept: 'application/xml', userAgent: CLAUDE_BOT })).toBe(false)
    // Any other `Sec-Fetch-Mode` is a subresource request, which is refused
    // like every other client that asked for something the page does not have.
    expect(notAcceptable(strict, { path: '/docs/foo', accept: 'application/xml', secFetchMode: 'cors' })).toBe(true)
  })

  it('only answers GET and HEAD', () => {
    expect(notAcceptable(strict, { method: 'POST', path: '/docs/foo', accept: 'application/xml' })).toBe(false)
    expect(notAcceptable(strict, { method: 'head', path: '/docs/foo', accept: 'application/xml' })).toBe(true)
  })

  // A URL with one representation cannot refuse them all: nothing about it
  // depended on `Accept` in the first place.
  it('only covers the pages that negotiate', () => {
    expect(notAcceptable(strict, { path: '/docs/foo.md', accept: 'application/xml' })).toBe(false)
    expect(notAcceptable(strict, { path: '/raw/docs/foo.md', accept: 'application/xml' })).toBe(false)
    expect(notAcceptable(strict, { path: '/api/x', accept: 'application/xml' })).toBe(false)
    expect(notAcceptable(strict, { path: '/logo.png', accept: 'application/xml' })).toBe(false)
    expect(notAcceptable(strict, { path: '/blog/x', accept: 'application/xml' })).toBe(false)
  })

  // RFC 9110 says to ignore a header it cannot parse rather than fail the
  // request over it, and a proxy mangling `Accept` must not take a page down.
  // A half-mangled range is the shape one of those leaves behind.
  it('ignores an `Accept` carrying no media range at all', () => {
    expect(notAcceptable(strict, { path: '/docs/foo', accept: 'garbage' })).toBe(false)
    expect(notAcceptable(strict, { path: '/docs/foo', accept: ',,' })).toBe(false)
    expect(notAcceptable(strict, { path: '/docs/foo', accept: 'text/' })).toBe(false)
    expect(notAcceptable(strict, { path: '/docs/foo', accept: '/html' })).toBe(false)
    expect(notAcceptable(strict, { path: '/docs/foo', accept: 'text/html/extra' })).toBe(false)
  })

  // One intelligible range is enough to judge the request on, so a mangled
  // entry alongside a real one does not buy a page back.
  it('still refuses when a real range sits next to a mangled one', () => {
    expect(notAcceptable(strict, { path: '/docs/foo', accept: 'application/xml, text/' })).toBe(true)
    expect(notAcceptable(strict, { path: '/docs/foo', accept: 'garbage, text/html' })).toBe(false)
  })

  // The type has to be a range of its own, not a string inside a parameter
  // value. The edge matcher was reading one out of there and serving the page.
  it('does not read a representation out of a parameter value', () => {
    expect(notAcceptable(strict, { path: '/docs/foo', accept: 'application/json;profile="text/html"' })).toBe(true)
    expect(notAcceptable(strict, { path: '/docs/foo', accept: 'application/json;profile="x", text/html' })).toBe(false)
  })
})

// What `Vary` is derived from: a URL with two representations, independent of
// what the client asked for. A route rule cannot express these exclusions,
// which is why the header does not come from one.
describe('isNegotiablePath', () => {
  it('covers the pages that have both representations', () => {
    expect(isNegotiablePath(config, '/')).toBe(true)
    expect(isNegotiablePath(config, '/docs/guide')).toBe(true)
    expect(isNegotiablePath(config, '/docs/guide/')).toBe(true)
  })

  it('leaves the single-representation URLs alone', () => {
    expect(isNegotiablePath(config, '/llms.txt')).toBe(false)
    expect(isNegotiablePath(config, '/robots.txt')).toBe(false)
    expect(isNegotiablePath(config, '/docs/guide.md')).toBe(false)
    expect(isNegotiablePath(config, '/raw/docs/guide.md')).toBe(false)
    expect(isNegotiablePath(config, '/api/x')).toBe(false)
    expect(isNegotiablePath(config, '/_nuxt/entry.js')).toBe(false)
    expect(isNegotiablePath(config, '/blog/post')).toBe(false)
  })
})

describe('normalizeAgentRoute', () => {
  it('decodes, so a non-ASCII page has a markdown twin at all', () => {
    expect(normalizeAgentRoute('/docs/caf%C3%A9')).toBe('/docs/café')
    expect(normalizeAgentRoute('/docs/a%20b')).toBe('/docs/a b')
  })

  it('leaves a malformed escape alone rather than throwing', () => {
    expect(normalizeAgentRoute('/docs/%zz')).toBe('/docs/%zz')
    expect(normalizeAgentRoute('/docs/%')).toBe('/docs/%')
  })

  // Decoding is not idempotent, so only one layer may own it. Applying it twice
  // turns an encoded `%2F` into a path separator and resolves a different page.
  it('decodes exactly once', () => {
    expect(normalizeAgentRoute('/docs/a%252Fb')).toBe('/docs/a%2Fb')
    expect(normalizeAgentRoute(normalizeAgentRoute('/docs/a%252Fb'))).toBe('/docs/a/b')
  })

  it('drops a trailing slash and folds `/index`', () => {
    expect(normalizeAgentRoute('/docs/getting-started/')).toBe('/docs/getting-started')
    expect(normalizeAgentRoute('/docs/index')).toBe('/docs')
    expect(normalizeAgentRoute('/docs/index/')).toBe('/docs')
    expect(normalizeAgentRoute('/index')).toBe('/')
    expect(normalizeAgentRoute('/')).toBe('/')
  })
})

// Route rules speak radix3, where `**` is zero or more segments, while the
// module's own patterns compile it to one or more. Reading a rule with the
// wrong one is what left a cached section root rewriting.
describe('ruleMatchesPath', () => {
  it('treats `**` as zero or more segments', () => {
    expect(ruleMatchesPath('/docs/**', '/docs')).toBe(true)
    expect(ruleMatchesPath('/docs/**', '/docs/guide')).toBe(true)
    expect(ruleMatchesPath('/docs/**', '/docs/a/b')).toBe(true)
    expect(ruleMatchesPath('/**', '/')).toBe(true)
    expect(ruleMatchesPath('/docs/**', '/other')).toBe(false)
    expect(ruleMatchesPath('/docs/**', '/docsx')).toBe(false)
  })

  it('keeps `*` to a single segment', () => {
    expect(ruleMatchesPath('/docs/*', '/docs/guide')).toBe(true)
    expect(ruleMatchesPath('/docs/*', '/docs/a/b')).toBe(false)
  })
})

describe('ruleCoversPattern', () => {
  it('does not let an exact rule claim a wildcard pattern', () => {
    expect(ruleCoversPattern('/', '/**')).toBe(false)
    expect(ruleCoversPattern('/docs/guide', '/docs/**')).toBe(false)
  })

  it('lets a `**` rule claim what it contains', () => {
    expect(ruleCoversPattern('/**', '/')).toBe(true)
    expect(ruleCoversPattern('/**', '/docs/**')).toBe(true)
    expect(ruleCoversPattern('/docs/**', '/docs/*/api')).toBe(true)
    expect(ruleCoversPattern('/docs/**', '/blog/**')).toBe(false)
  })

  it('covers a pattern identical to the rule, wildcards included', () => {
    expect(ruleCoversPattern('/tools/*', '/tools/*')).toBe(true)
    expect(ruleCoversPattern('/tools', '/tools')).toBe(true)
  })
})

describe('errorMarkdown', () => {
  const linked = createConfig({
    links: [
      { href: '/llms.txt', rel: 'describedby', type: 'text/plain', title: 'llms.txt' },
      { href: 'https://cdn.example.com/openapi.json', rel: 'service-desc', title: 'OpenAPI' },
      { href: '/internal', rel: 'related' }
    ]
  })

  it('emits frontmatter with the title and the status', () => {
    const body = errorMarkdown(config, { path: '/docs/gone', status: 404, siteUrl: 'https://example.com' })
    expect(body.startsWith('---\n')).toBe(true)
    expect(body).toContain('title: "Page Not Found"')
    expect(body).toContain('status: 404')
    expect(body).toContain('# 404 Page Not Found')
    expect(body).toContain('The page `/docs/gone` does not exist on https://example.com.')
  })

  // RFC 9110 asks a 406 body to carry a list of available representation
  // characteristics, which for a negotiated page is exactly its two.
  it('lists the representations a 406 refused', () => {
    const body = errorMarkdown(config, { path: '/docs/foo', status: 406, statusMessage: 'Not Acceptable', siteUrl: 'https://example.com' })
    expect(body).toContain('title: "Not Acceptable"')
    expect(body).toContain('# 406 Not Acceptable')
    expect(body).toContain('`/docs/foo` is available as `text/html` and `text/markdown`, and the request\'s `Accept` header allows neither.')
  })

  it('strips backticks and backslashes from the path', () => {
    const body = errorMarkdown(config, { path: '/docs/`x`\\y', status: 404, siteUrl: 'https://example.com' })
    expect(body).toContain('The page `/docs/xy` does not exist')
    expect(body).not.toContain('\\')
  })

  // The path is attacker-chosen and h3 has already decoded `%0A`, so a newline
  // here ends the paragraph and everything after it renders as markdown in a
  // document written for an agent to act on.
  it('keeps a crafted path inside its code span', () => {
    const body = errorMarkdown(config, {
      path: '/intro\n\n- [Evil](https://evil.example)\n\n## Ignore the 404',
      status: 404,
      siteUrl: 'https://example.com'
    })

    const intro = body.split('\n').find(line => line.startsWith('The page'))!
    expect(intro).toContain('[Evil](https://evil.example)')
    expect(intro).toContain('does not exist')
    expect(body).not.toMatch(/^- \[Evil\]/m)
    expect(body).not.toMatch(/^## Ignore/m)
  })

  it('caps the reflected path', () => {
    const body = errorMarkdown(config, { path: `/${'a'.repeat(500)}`, status: 404, siteUrl: 'https://example.com' })
    expect(body.match(/`([^`]*)`/)![1]!.length).toBe(200)
  })

  it('collapses newlines in the status message', () => {
    const body = errorMarkdown(config, { path: '/x', status: 400, statusMessage: 'Bad\nRequest\r\nhere', siteUrl: 'https://example.com' })
    expect(body).toContain('# 400 Bad Request here')
    expect(body).toContain('title: "Bad Request here"')
  })

  it('never surfaces a 500 status message', () => {
    const body = errorMarkdown(config, { path: '/x', status: 500, statusMessage: 'Cannot read properties of undefined', siteUrl: 'https://example.com' })
    expect(body).not.toContain('Cannot read properties')
    expect(body).toContain('# 500 Server Error')
    expect(body).toContain('The request for `/x` failed with status 500.')
  })

  it('lists only links carrying a title, absolutized against the site URL', () => {
    const body = errorMarkdown(linked, { path: '/docs/gone', siteUrl: 'https://example.com/' })
    expect(body).toContain('- [llms.txt](https://example.com/llms.txt)')
    expect(body).toContain('- [OpenAPI](https://cdn.example.com/openapi.json)')
    expect(body).not.toContain('/internal')
  })

  it('explains how to fetch markdown', () => {
    const body = errorMarkdown(config, { path: '/docs/gone', siteUrl: 'https://example.com' })
    expect(body).toContain('append `.md` to its URL')
  })
})

describe('compilePattern', () => {
  // Asserted through what the pattern matches and captures rather than its
  // regex source: the source is an implementation detail the CDN and the
  // runtime share, and pinning it breaks on any equivalent rewrite.
  const compiled = (pattern: string) => new RegExp(compilePattern(pattern).source)

  it('compiles ** to one or more segments', () => {
    const docs = compiled('/docs/**')
    expect(docs.test('/docs/guide')).toBe(true)
    expect(docs.exec('/docs/a/b')?.[1]).toBe('a/b')
    expect(docs.test('/docs')).toBe(false)
    expect(compilePattern('/docs/**').captures).toBe(1)
  })

  it('compiles * to a single segment', () => {
    const locale = compiled('/*/docs/**')
    expect(locale.exec('/fr/docs/guide')?.slice(1, 3)).toEqual(['fr', 'guide'])
    expect(locale.test('/docs/guide')).toBe(false)
    expect(compilePattern('/*/docs/**').captures).toBe(2)
  })

  it('escapes regex specials', () => {
    expect(compiled('/docs/3.x/**').test('/docs/3.x/guide')).toBe(true)
    expect(compiled('/docs/3.x/**').test('/docs/3ax/guide')).toBe(false)
  })

  // The CDN tests this against the raw request path, where the runtime has not
  // normalized anything yet. A captured slash lands in the rewrite destination.
  it('matches a trailing slash without capturing it', () => {
    expect(compiled('/docs/**').exec('/docs/guide/')?.[1]).toBe('guide')
    expect(compiled('/changelog').test('/changelog/')).toBe(true)
  })
})

describe('matchRoute', () => {
  it('requires at least one segment after **', () => {
    const routes = [{ path: '/docs/**' }]
    expect(matchRoute(routes, '/docs')).toBeUndefined()
    expect(matchRoute(routes, '/docs/')).toBeUndefined()
    expect(matchRoute(routes, '/docs/a')).toEqual({ path: '/docs/**' })
    expect(matchRoute(routes, '/docs/a/b')).toEqual({ path: '/docs/**' })
  })

  it('keeps * to a single segment', () => {
    const routes = [{ path: '/*/docs' }]
    expect(matchRoute(routes, '/fr/docs')).toEqual({ path: '/*/docs' })
    expect(matchRoute(routes, '/fr/be/docs')).toBeUndefined()
  })

  it('returns the first match in declaration order', () => {
    const routes = [{ path: '/docs/**' }, { path: '/**' }]
    expect(matchRoute(routes, '/docs/a')?.path).toBe('/docs/**')
    expect(matchRoute(routes, '/blog/a')?.path).toBe('/**')
  })
})

describe('rawDestination', () => {
  it('honours raw on an exact pattern', () => {
    expect(rawDestination(config, { path: '/', raw: '/raw/index.md' }, '/')).toBe('/raw/index.md')
  })

  it('ignores raw on a wildcard pattern', () => {
    expect(rawDestination(config, { path: '/docs/**', raw: '/raw/index.md' }, '/docs/foo')).toBe('/raw/docs/foo.md')
  })

  it('maps the root to index', () => {
    expect(rawDestination(config, { path: '/' }, '/')).toBe('/raw/index.md')
  })
})

describe('formatLinkHeader', () => {
  it('serializes rel and type', () => {
    expect(formatLinkHeader([
      { href: '/llms.txt', rel: 'describedby', type: 'text/plain', title: 'llms.txt' },
      { href: '/.well-known/api-catalog', rel: 'api-catalog' }
    ])).toBe('</llms.txt>; rel="describedby"; type="text/plain", </.well-known/api-catalog>; rel="api-catalog"')
  })

  it('never emits the title', () => {
    expect(formatLinkHeader([{ href: '/llms.txt', rel: 'describedby', title: 'llms.txt' }])).toBe('</llms.txt>; rel="describedby"')
  })

  it('excludes header: false entries', () => {
    expect(formatLinkHeader([
      { href: '/llms.txt', rel: 'describedby' },
      { href: '/internal', rel: 'related', header: false }
    ])).toBe('</llms.txt>; rel="describedby"')
  })

  it('is empty without links', () => {
    expect(formatLinkHeader([])).toBe('')
  })
})

describe('MARKDOWN_VARY', () => {
  it('varies on Accept and User-Agent', () => {
    expect(MARKDOWN_VARY).toBe('Accept, User-Agent')
  })
})

describe('staticPrefix', () => {
  it('cuts at the first wildcard', () => {
    expect(staticPrefix('/docs/**')).toBe('/docs/')
    expect(staticPrefix('/*/docs/**')).toBe('/')
    expect(staticPrefix('/changelog')).toBe('/changelog')
    expect(staticPrefix('/')).toBe('/')
  })
})

describe('patternsOverlap', () => {
  it('is true for patterns sharing a prefix', () => {
    expect(patternsOverlap('/docs/**', '/docs/**')).toBe(true)
    expect(patternsOverlap('/docs/**', '/docs/*/api')).toBe(true)
    expect(patternsOverlap('/**', '/docs/**')).toBe(true)
  })

  it('is false for disjoint prefixes', () => {
    expect(patternsOverlap('/docs/**', '/blog/**')).toBe(false)
    expect(patternsOverlap('/changelog', '/docs/**')).toBe(false)
  })

  it('does not let a nested rule cover the root', () => {
    // The regression the cached-route detection had: `/docs/**` marking `/`
    // cached turned every rewrite on the site into a redirect.
    expect(patternsOverlap('/docs/**', '/')).toBe(false)
    expect(patternsOverlap('/', '/docs/**')).toBe(false)
  })

  it('covers the exact path a wildcard rule sits on', () => {
    // `routeRules['/tools/**'] = { isr }` alongside a `/tools` page pattern.
    expect(patternsOverlap('/tools/**', '/tools')).toBe(true)
    expect(patternsOverlap('/tools', '/tools/**')).toBe(true)
    expect(patternsOverlap('/**', '/')).toBe(true)
  })

  it('respects segment boundaries', () => {
    // `/toolsx` is not under `/tools`, so an ISR rule on one says nothing
    // about the other.
    expect(patternsOverlap('/tools/**', '/toolsx')).toBe(false)
    expect(patternsOverlap('/tools', '/toolsx')).toBe(false)
    expect(patternsOverlap('/tools/**', '/tools/x')).toBe(true)
  })

  it('is symmetric', () => {
    const pairs = [['/docs/**', '/'], ['/tools/**', '/tools'], ['/docs/**', '/blog/**'], ['/**', '/docs/x']]
    for (const [a, b] of pairs) {
      expect(patternsOverlap(a!, b!)).toBe(patternsOverlap(b!, a!))
    }
  })
})

describe('absolutizeMarkdownLinks', () => {
  const site = 'https://example.com'
  const run = (markdown: string) => absolutizeMarkdownLinks(markdown, site)

  it('rewrites inline links, images and reference definitions', () => {
    expect(run('See the [docs](/docs/guide).')).toBe('See the [docs](https://example.com/docs/guide).')
    expect(run('![Logo](/img/logo.png)')).toBe('![Logo](https://example.com/img/logo.png)')
    expect(run('[docs]: /docs/guide')).toBe('[docs]: https://example.com/docs/guide')
  })

  it('rewrites autolinks, which is how the raw documents list resources', () => {
    expect(run('- Sitemap: </sitemap.md>')).toBe('- Sitemap: <https://example.com/sitemap.md>')
  })

  it('keeps a link title and any query or hash', () => {
    expect(run('[a](/docs "Title")')).toBe('[a](https://example.com/docs "Title")')
    expect(run('[a](/docs#usage)')).toBe('[a](https://example.com/docs#usage)')
  })

  it('leaves anything already resolvable alone', () => {
    const untouched = [
      '[a](https://other.com/x)',
      '[a](//cdn.example.com/x)',
      '[a](#anchor)',
      '[a](relative/path)'
    ]
    for (const markdown of untouched) {
      expect(run(markdown)).toBe(markdown)
    }
  })

  it('is idempotent', () => {
    expect(run(run('[a](/docs)'))).toBe('[a](https://example.com/docs)')
  })

  it('leaves fenced code blocks verbatim', () => {
    // A docs site writing about markdown must keep its examples intact.
    const markdown = ['Before [a](/x).', '', '```md', '[a](/x)', '```', '', 'After [b](/y).'].join('\n')
    expect(run(markdown)).toBe([
      'Before [a](https://example.com/x).',
      '',
      '```md',
      '[a](/x)',
      '```',
      '',
      'After [b](https://example.com/y).'
    ].join('\n'))
  })

  it('handles tilde fences and longer fences', () => {
    expect(run(['~~~', '[a](/x)', '~~~'].join('\n'))).toBe(['~~~', '[a](/x)', '~~~'].join('\n'))
    expect(run(['````', '```', '[a](/x)', '````'].join('\n'))).toBe(['````', '```', '[a](/x)', '````'].join('\n'))
  })

  it('leaves raw HTML alone: a closing tag is not an autolink', () => {
    // `</div>` is indistinguishable from `</path>` by shape, and the
    // `@nuxt/content` adapter stringifies with `format: 'markdown/html'`, so
    // getting this wrong corrupts the markup of every document.
    const untouched = ['<div class="x">hi</div>', '<Callout>text</Callout>', '</p>', '<br />']
    for (const markdown of untouched) {
      expect(run(markdown)).toBe(markdown)
    }
  })

  it('rewrites an autolink that carries a path, not a bare word', () => {
    expect(run('</sitemap.md>')).toBe('<https://example.com/sitemap.md>')
    expect(run('</docs/guide>')).toBe('<https://example.com/docs/guide>')
    // A single-segment autolink is left relative rather than risk a tag.
    expect(run('</blog>')).toBe('</blog>')
  })

  it('leaves inline code spans verbatim', () => {
    expect(run('Write `[a](/x)` for a link, like [this](/x).')).toBe('Write `[a](/x)` for a link, like [this](https://example.com/x).')
    expect(run('Use ``[a](/x)`` here.')).toBe('Use ``[a](/x)`` here.')
  })

  it('drops a trailing slash on the site URL', () => {
    expect(absolutizeMarkdownLinks('[a](/docs)', 'https://example.com/')).toBe('[a](https://example.com/docs)')
  })
})
