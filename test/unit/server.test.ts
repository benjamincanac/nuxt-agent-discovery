import { describe, it, expect } from 'vitest'
import type { H3Event } from 'h3'

/**
 * The request path the `nuxt/server` variants read. Nitro 3 keeps a build-time
 * `app.baseURL` on the request URL where Nitro 2's `event.path` had it
 * stripped, so a page under the base would otherwise miss every route pattern.
 */
const { getRequestPath } = await import('../../src/runtime/server/utils/server')
const { setRuntimeConfig } = await import('./nitro.stub')

function path(url: string, baseURL?: string): string {
  setRuntimeConfig({ app: { baseURL } })
  return getRequestPath({ req: new Request(url), url: new URL(url), res: { headers: new Headers() }, context: {} })
}

describe('getRequestPath', () => {
  it('strips the base and keeps the query', () => {
    expect(path('https://example.com/docs/guide?x=1', '/docs/')).toBe('/guide?x=1')
    expect(path('https://example.com/docs', '/docs/')).toBe('/')
    expect(path('https://example.com/docs/', '/docs/')).toBe('/')
  })

  it('leaves a path outside the base, or one only sharing its prefix, alone', () => {
    expect(path('https://example.com/docsearch', '/docs/')).toBe('/docsearch')
    expect(path('https://example.com/other', '/docs/')).toBe('/other')
  })

  it('reads the path as is without a base, or with a relative one', () => {
    expect(path('https://example.com/guide.md', '/')).toBe('/guide.md')
    expect(path('https://example.com/guide.md')).toBe('/guide.md')
    expect(path('https://example.com/guide.md', './')).toBe('/guide.md')
  })
})

/**
 * The Nitro 2 twin. h3 v1 decodes `event.path`, so the path is read off the
 * request URL as it came in, where `%23` and `%3F` are still escapes.
 */
const legacy = await import('../../src/runtime/server/utils/server.legacy')

function legacyPath(originalUrl: string, decoded: string, baseURL?: string): string {
  setRuntimeConfig({ app: { baseURL } })
  return legacy.getRequestPath({ path: decoded, node: { req: { originalUrl, url: decoded } } } as unknown as H3Event)
}

describe('getRequestPath on Nitro 2', () => {
  it('keeps an escaped `#` or `?` that `event.path` reads as a separator', () => {
    expect(legacyPath('/docs/getting-started%23zzz', '/docs/getting-started#zzz')).toBe('/docs/getting-started%23zzz')
    expect(legacyPath('/docs/what%3F?x=1', '/docs/what??x=1')).toBe('/docs/what%3F?x=1')
  })

  it('strips the base and keeps the query, like the `nuxt/server` variant', () => {
    expect(legacyPath('/docs/guide?x=1', '/guide?x=1', '/docs/')).toBe('/guide?x=1')
    expect(legacyPath('/docs', '/', '/docs/')).toBe('/')
    expect(legacyPath('/guide.md', '/guide.md', '/')).toBe('/guide.md')
  })

  it('reads a leading `//` as a path, not a host', () => {
    expect(legacyPath('//evil.example/docs', '//evil.example/docs')).toBe('/evil.example/docs')
  })
})
