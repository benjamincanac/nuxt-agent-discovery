import { describe, it, expect, beforeEach } from 'vitest'
import type { NegotiationConfig } from '../../src/runtime/shared/types'
import type { NegotiationAdapter } from '../../src/runtime/server/utils/negotiate'

/**
 * The decision both middleware variants share. The e2e suites only boot
 * Nitro 2, so this is what pins the behaviour the `nuxt/server` shim inherits:
 * a fake adapter records what the decision asked of the response.
 */
const { negotiate } = await import('../../src/runtime/server/utils/negotiate')
const { setRuntimeConfig } = await import('./nitro.stub')

function configure(overrides: Partial<NegotiationConfig> = {}, baseURL = '/'): void {
  setRuntimeConfig({
    app: { baseURL },
    agentDiscovery: {
      siteUrl: 'https://example.com',
      siteName: 'Example',
      rawPrefix: '/raw',
      routes: [{ path: '/', raw: '/raw/index.md' }, { path: '/docs/**' }],
      userAgents: ['ClaudeBot'],
      excludePrefixes: ['/_', '/api/'],
      links: [],
      linkHeader: true,
      cachedRoutes: [],
      sitemapSections: { expand: [], labels: {} },
      notAcceptable: false,
      ...overrides
    }
  })
}

function run(path: string, options: { method?: string, headers?: Record<string, string>, response?: Response } = {}) {
  const calls = {
    headers: new Headers(),
    status: undefined as number | undefined,
    redirect: undefined as { location: string, status: number } | undefined,
    fetched: undefined as { path: string, headers: Record<string, string> } | undefined
  }
  const requestHeaders = new Headers(options.headers)
  const adapter: NegotiationAdapter = {
    event: {} as NegotiationAdapter['event'],
    path,
    method: options.method || 'GET',
    header: name => requestHeaders.get(name) ?? undefined,
    setHeader: (name, value) => calls.headers.set(name, value),
    appendHeader: (name, value) => calls.headers.append(name, value),
    setStatus: (status) => {
      calls.status = status
    },
    redirect: (location, status) => {
      calls.redirect = { location, status }
      return 'redirected'
    },
    fetch: async (target, headers) => {
      calls.fetched = { path: target, headers }
      return options.response ?? new Response('# Page\n', { headers: { 'content-type': 'text/markdown; charset=utf-8' } })
    },
    createError: (status, statusText) => Object.assign(new Error(statusText), { status }),
    prerender: () => {}
  }
  return { calls, result: negotiate(adapter) }
}

beforeEach(() => configure())

describe('negotiate', () => {
  it('leaves a browser alone, labelling the page with `Vary`', async () => {
    const { calls, result } = run('/docs/guide', { headers: { accept: 'text/html' } })

    await expect(result).resolves.toBeUndefined()
    expect(calls.headers.get('vary')).toBe('Accept, User-Agent')
    expect(calls.fetched).toBeUndefined()
  })

  it('ignores anything but GET and HEAD', async () => {
    const { calls, result } = run('/docs/guide', { method: 'POST', headers: { accept: 'text/markdown' } })

    await expect(result).resolves.toBeUndefined()
    expect(calls.fetched).toBeUndefined()
  })

  it('fetches the raw twin below the base with the query and host headers, nothing else', async () => {
    const { calls, result } = run('/docs/guide?v=2', { headers: { accept: 'text/markdown', host: 'example.com', cookie: 'a=1' } })

    await expect(result).resolves.toBe('# Page\n')
    expect(calls.fetched).toEqual({ path: '/raw/docs/guide.md?v=2', headers: { accept: 'text/markdown', host: 'example.com' } })
    expect(calls.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
    expect(calls.headers.get('vary')).toBe('Accept, User-Agent')
  })

  it('passes the raw response status, its hardening headers and its `Link` on', async () => {
    const { calls, result } = run('/docs/missing', {
      headers: { accept: 'text/markdown' },
      response: new Response('# 404\n', {
        status: 404,
        headers: { 'cache-control': 'no-cache', 'x-frame-options': 'DENY', 'link': '<https://example.com/docs/missing>; rel="canonical"', 'set-cookie': 'a=1' }
      })
    })

    await expect(result).resolves.toBe('# 404\n')
    expect(calls.status).toBe(404)
    expect(calls.headers.get('cache-control')).toBe('no-cache')
    expect(calls.headers.get('x-frame-options')).toBe('DENY')
    expect(calls.headers.get('link')).toBe('<https://example.com/docs/missing>; rel="canonical"')
    expect(calls.headers.get('set-cookie')).toBeNull()
  })

  it('rethrows a server error instead of serving its body', async () => {
    const { result } = run('/docs/guide', { headers: { accept: 'text/markdown' }, response: new Response('boom', { status: 502, statusText: 'Bad Gateway' }) })

    await expect(result).rejects.toMatchObject({ status: 502, message: 'Bad Gateway' })
  })

  it('follows the raw route to a section\'s first document', async () => {
    const { calls, result } = run('/docs/components', {
      headers: { accept: 'text/markdown' },
      response: new Response(null, { status: 302, headers: { location: '/raw/docs/intro.md' } })
    })

    await expect(result).resolves.toBe('redirected')
    expect(calls.redirect).toEqual({ location: '/raw/docs/intro.md', status: 302 })
    expect(calls.headers.get('vary')).toBe('Accept, User-Agent')
  })

  it('redirects a cached page to its twin under the base, unstored, query kept', async () => {
    configure({ cachedRoutes: ['/docs/**'] }, '/site/')
    const { calls, result } = run('/docs/guide?v=2', { headers: { accept: 'text/markdown' } })

    await expect(result).resolves.toBe('redirected')
    expect(calls.redirect).toEqual({ location: '/site/raw/docs/guide.md?v=2', status: 307 })
    expect(calls.headers.get('cache-control')).toBe('private, no-store')
    expect(calls.headers.get('vary')).toBe('Accept, User-Agent')
    expect(calls.fetched).toBeUndefined()
  })

  it('answers 406 when the site asked for it and neither representation is acceptable', async () => {
    configure({ notAcceptable: true })
    const { result } = run('/docs/guide', { headers: { accept: 'application/xml' } })

    await expect(result).rejects.toMatchObject({ status: 406, message: 'Not Acceptable' })
  })
})
