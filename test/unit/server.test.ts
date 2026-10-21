import { describe, it, expect } from 'vitest'

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
