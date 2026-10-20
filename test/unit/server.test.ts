import { describe, it, expect } from 'vitest'
import type { H3Event } from 'h3'

/**
 * The server layer the shared helpers call through `#agent-discovery/server`,
 * one file per server API. The helpers are tested against the Nitro 2 one, so
 * this pins the `nuxt/server` one to the same answers.
 */
const legacy = await import('../../src/runtime/server/utils/server.legacy')
const portable = await import('../../src/runtime/server/utils/server')
const { setRuntimeConfig } = await import('./nitro.stub')

const h3Event = {
  method: 'GET',
  path: '/docs',
  node: { req: { url: '/docs', headers: { host: 'example.com' } }, res: {} },
  context: {}
} as unknown as H3Event

const requestEvent = {
  req: new Request('https://example.com/docs'),
  url: new URL('https://example.com/docs'),
  res: { headers: new Headers() },
  context: {}
}

describe('server layer', () => {
  it('reads the same runtime config', () => {
    setRuntimeConfig({ agentDiscovery: { siteUrl: 'https://example.com' } })
    expect(portable.useServerConfig(requestEvent)).toEqual(legacy.useServerConfig(h3Event))
  })

  it('resolves the request origin', () => {
    expect(legacy.getRequestOrigin(h3Event)).toBe('http://example.com')
    expect(portable.getRequestOrigin(requestEvent)).toBe('https://example.com')
  })
})
