import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import type { H3Event } from 'h3'

/**
 * The generated `/robots.txt`, for a site with neither `@nuxtjs/robots` nor a
 * static file. The `disallow` cases exist because the generator used to be
 * allow-only: a single site-specific `Disallow` line forced a site to keep a
 * static `public/robots.txt` (and its build warning) or adopt `@nuxtjs/robots`
 * for that one line.
 */

interface Variant {
  handler: (event: unknown) => Promise<string> | string
  setRuntimeConfig: (config: Record<string, unknown>) => void
  /** An event of the shape the server hands the route, and what it wrote. */
  createEvent: () => { event: unknown, headers: () => Record<string, string> }
}

/**
 * Each route runs on its own server layer, the one the module aliases next to
 * it: the Nitro 2 route on `server.legacy.ts`, the `nuxt/server` one on
 * `server.ts`. Fresh modules per variant, so the stub config is the one the
 * route reads.
 */
const variants: Record<string, () => Promise<Variant>> = {
  'Nitro 2': async () => {
    vi.resetModules()
    vi.doUnmock('#agent-discovery/server')
    const { default: handler } = await import('../../src/runtime/server/routes/robots.txt.legacy')
    const { setRuntimeConfig } = await import('./nitro.stub')
    return {
      handler: handler as unknown as Variant['handler'],
      setRuntimeConfig,
      createEvent: () => {
        const headers: Record<string, string> = {}
        const event = {
          path: '/robots.txt',
          node: {
            req: { url: '/robots.txt', headers: { 'host': 'example.com', 'x-forwarded-proto': 'https' } },
            res: { setHeader: (name: string, value: string) => { headers[name.toLowerCase()] = value } }
          },
          context: {}
        } as unknown as H3Event
        return { event, headers: () => headers }
      }
    }
  },
  'nuxt/server': async () => {
    vi.resetModules()
    vi.doMock('#agent-discovery/server', () => import('../../src/runtime/server/utils/server'))
    const { default: handler } = await import('../../src/runtime/server/routes/robots.txt')
    const { setRuntimeConfig } = await import('./nitro.stub')
    return {
      handler: handler as unknown as Variant['handler'],
      setRuntimeConfig,
      createEvent: () => {
        const event = {
          req: new Request('https://example.com/robots.txt'),
          url: new URL('https://example.com/robots.txt'),
          res: { headers: new Headers() },
          context: {}
        }
        return { event, headers: () => Object.fromEntries(event.res.headers) }
      }
    }
  }
}

describe.each(Object.keys(variants))('generated robots.txt (%s)', (name) => {
  let variant: Variant

  function configure(robots: Record<string, unknown>, siteUrl = 'https://example.com') {
    variant.setRuntimeConfig({
      agentDiscovery: {
        siteUrl,
        rawPrefix: '/raw',
        routes: [{ path: '/**' }],
        userAgents: ['ClaudeBot', 'GPTBot'],
        excludePrefixes: [],
        links: [{ href: '/sitemap.xml', rel: 'sitemap' }]
      },
      agentDiscoveryRobots: robots
    })
  }

  beforeAll(async () => {
    variant = await variants[name]!()
  })
  beforeEach(() => configure({ contentSignal: 'search=yes, ai-train=yes', disallow: [] }))

  it('emits the wildcard group, the agent groups and the sitemap line', async () => {
    const { event, headers } = variant.createEvent()
    const body = await variant.handler(event)

    expect(body).toContain('User-agent: *\nContent-Signal: search=yes, ai-train=yes\nAllow: /\n')
    expect(body).toContain('User-agent: ClaudeBot\nAllow: /\n')
    expect(body).toContain('Sitemap: https://example.com/sitemap.xml')
    expect(headers()).toEqual({ 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' })
  })

  it('carries the configured `Disallow` lines on the wildcard group only', async () => {
    configure({ contentSignal: 'search=yes', disallow: ['/docs/5.x/', '/admin/'] })
    const { event } = variant.createEvent()
    const body = await variant.handler(event)

    expect(body).toContain('User-agent: *\nContent-Signal: search=yes\nDisallow: /docs/5.x/\nDisallow: /admin/\nAllow: /\n')
    // The named agents keep their allow-only groups: a specific group exempts
    // its agent from the wildcard rules, which is the deliberate reading (the
    // nightly docs stay out of search while agents may still be served them).
    expect(body).toContain('User-agent: ClaudeBot\nAllow: /\n')
    expect(body).not.toContain('User-agent: ClaudeBot\nDisallow')
  })

  it('falls back to the request origin, uncached, without a site URL', async () => {
    configure({ contentSignal: '', disallow: [] }, '')
    const { event, headers } = variant.createEvent()
    const body = await variant.handler(event)

    expect(body).toContain('Sitemap: https://example.com/sitemap.xml')
    expect(headers()['cache-control']).toBe('no-cache')
  })
})
