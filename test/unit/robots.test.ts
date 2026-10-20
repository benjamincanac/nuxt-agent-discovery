import { describe, it, expect, beforeEach } from 'vitest'
import type { H3Event } from 'h3'

/**
 * The generated `/robots.txt`, for a site with neither `@nuxtjs/robots` nor a
 * static file. The `disallow` cases exist because the generator used to be
 * allow-only: a single site-specific `Disallow` line forced a site to keep a
 * static `public/robots.txt` (and its build warning) or adopt `@nuxtjs/robots`
 * for that one line.
 */

const { default: legacyHandler } = await import('../../src/runtime/server/routes/robots.txt.legacy')
const { default: nuxtHandler } = await import('../../src/runtime/server/routes/robots.txt')
const { setRuntimeConfig } = await import('./nitro.stub')

type Handler = (event: unknown) => Promise<string> | string

// The Nitro 2 route and the `nuxt/server` one share the document, so both run
// every case against their own event shape.
const variants: [string, Handler, () => unknown][] = [
  ['Nitro 2', legacyHandler as unknown as Handler, () => {
    const headers: Record<string, unknown> = {}
    return {
      path: '/robots.txt',
      node: { res: { setHeader: (name: string, value: unknown) => { headers[name] = value } } },
      context: {}
    } as unknown as H3Event
  }],
  ['nuxt/server', nuxtHandler as unknown as Handler, () => ({
    req: new Request('https://example.com/robots.txt'),
    url: new URL('https://example.com/robots.txt'),
    res: { headers: new Headers() },
    context: {}
  })]
]

function configure(robots: Record<string, unknown>) {
  setRuntimeConfig({
    agentDiscovery: {
      siteUrl: 'https://example.com',
      rawPrefix: '/raw',
      routes: [{ path: '/**' }],
      userAgents: ['ClaudeBot', 'GPTBot'],
      excludePrefixes: [],
      links: [{ href: '/sitemap.xml', rel: 'sitemap' }]
    },
    agentDiscoveryRobots: robots
  })
}

describe.each(variants)('generated robots.txt (%s)', (_name, handler, createEvent) => {
  beforeEach(() => configure({ contentSignal: 'search=yes, ai-train=yes', disallow: [] }))

  it('emits the wildcard group, the agent groups and the sitemap line', async () => {
    const body = await handler(createEvent())

    expect(body).toContain('User-agent: *\nContent-Signal: search=yes, ai-train=yes\nAllow: /\n')
    expect(body).toContain('User-agent: ClaudeBot\nAllow: /\n')
    expect(body).toContain('Sitemap: https://example.com/sitemap.xml')
  })

  it('carries the configured `Disallow` lines on the wildcard group only', async () => {
    configure({ contentSignal: 'search=yes', disallow: ['/docs/5.x/', '/admin/'] })
    const body = await handler(createEvent())

    expect(body).toContain('User-agent: *\nContent-Signal: search=yes\nDisallow: /docs/5.x/\nDisallow: /admin/\nAllow: /\n')
    // The named agents keep their allow-only groups: a specific group exempts
    // its agent from the wildcard rules, which is the deliberate reading (the
    // nightly docs stay out of search while agents may still be served them).
    expect(body).toContain('User-agent: ClaudeBot\nAllow: /\n')
    expect(body).not.toContain('User-agent: ClaudeBot\nDisallow')
  })
})
