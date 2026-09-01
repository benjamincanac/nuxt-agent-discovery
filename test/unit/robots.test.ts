import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { H3Event } from 'h3'

/**
 * The generated `/robots.txt`, for a site with neither `@nuxtjs/robots` nor a
 * static file. The `disallow` cases exist because the generator used to be
 * allow-only: a single site-specific `Disallow` line forced a site to keep a
 * static `public/robots.txt` (and its build warning) or adopt `@nuxtjs/robots`
 * for that one line.
 */
// The route reaches `nitropack/runtime` through the utils barrel, which only
// resolves inside a build; nothing here calls into it.
vi.mock('nitropack/runtime', () => ({ useNitroApp: () => ({ hooks: { callHook: async () => {} } }) }))

const { default: handler } = await import('../../src/runtime/server/routes/robots.txt')
const { setRuntimeConfig } = await import('./imports.stub')

function createEvent(): H3Event {
  const headers: Record<string, unknown> = {}
  return {
    path: '/robots.txt',
    node: { res: { setHeader: (name: string, value: unknown) => { headers[name] = value } } },
    context: {}
  } as unknown as H3Event
}

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

describe('generated robots.txt', () => {
  beforeEach(() => configure({ contentSignal: 'search=yes, ai-train=yes', disallow: [] }))

  it('emits the wildcard group, the agent groups and the sitemap line', async () => {
    const body = await (handler as unknown as (event: H3Event) => Promise<string>)(createEvent())

    expect(body).toContain('User-agent: *\nContent-Signal: search=yes, ai-train=yes\nAllow: /\n')
    expect(body).toContain('User-agent: ClaudeBot\nAllow: /\n')
    expect(body).toContain('Sitemap: https://example.com/sitemap.xml')
  })

  it('carries the configured `Disallow` lines on the wildcard group only', async () => {
    configure({ contentSignal: 'search=yes', disallow: ['/docs/5.x/', '/admin/'] })
    const body = await (handler as unknown as (event: H3Event) => Promise<string>)(createEvent())

    expect(body).toContain('User-agent: *\nContent-Signal: search=yes\nDisallow: /docs/5.x/\nDisallow: /admin/\nAllow: /\n')
    // The named agents keep their allow-only groups: a specific group exempts
    // its agent from the wildcard rules, which is the deliberate reading (the
    // nightly docs stay out of search while agents may still be served them).
    expect(body).toContain('User-agent: ClaudeBot\nAllow: /\n')
    expect(body).not.toContain('User-agent: ClaudeBot\nDisallow')
  })
})
