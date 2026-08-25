import { describe, it, expect } from 'vitest'
import {
  MARKDOWN_VARY,
  acceptQuality,
  acceptsMarkdown,
  compilePattern,
  errorMarkdown,
  formatLinkHeader,
  hasFileExtension,
  matchRoute,
  negotiatedRawPath,
  normalizePathname,
  parseAccept,
  prefersMarkdownError,
  rawDestination
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
    cachedRoutes: [],
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

  it('strips backticks and backslashes from the path', () => {
    const body = errorMarkdown(config, { path: '/docs/`x`\\y', status: 404, siteUrl: 'https://example.com' })
    expect(body).toContain('The page `/docs/xy` does not exist')
    expect(body).not.toContain('\\')
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
  it('compiles ** to one or more segments', () => {
    expect(compilePattern('/docs/**')).toEqual({ source: '^/docs/(.+)$', captures: 1 })
  })

  it('compiles * to a single segment', () => {
    expect(compilePattern('/*/docs/**')).toEqual({ source: '^/([^/]+)/docs/(.+)$', captures: 2 })
  })

  it('escapes regex specials', () => {
    expect(compilePattern('/docs/3.x/**').source).toBe('^/docs/3\\.x/(.+)$')
    expect(new RegExp(compilePattern('/docs/3.x/**').source).test('/docs/3ax/guide')).toBe(false)
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
