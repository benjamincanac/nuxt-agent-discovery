import { describe, it, expect, vi } from 'vitest'

/**
 * The bridge collects every raw twin `llms.txt` links into one
 * `x-nitro-prerender` header, which on a documentation site is hundreds of
 * paths. Only the prerender crawler ever reads it, so the predicate is pinned
 * here: emitting it under `nitro-dev` put a 350+ path header on every `/` and
 * `/llms.txt` response, and the Nuxt dev proxy never relayed those responses
 * at all. The server logged a 200 while the client hung.
 */
vi.mock('nitropack/runtime', () => ({
  defineNitroPlugin: (plugin: unknown) => plugin,
  useNitroApp: () => ({ hooks: { callHook: async () => {} } })
}))

const { emitsPrerenderHints } = await import('../../src/runtime/server/plugins/llms')

describe('llms bridge: prerender hint header', () => {
  it('emits it for the prerender crawler', () => {
    expect(emitsPrerenderHints('nitro-prerender')).toBe(true)
  })

  it('keeps it out of dev, where nothing consumes it and the proxy chokes on it', () => {
    expect(emitsPrerenderHints('nitro-dev')).toBe(false)
  })

  it('never emits it on a deployed runtime', () => {
    expect(emitsPrerenderHints('vercel')).toBe(false)
    expect(emitsPrerenderHints('node-server')).toBe(false)
    expect(emitsPrerenderHints(undefined)).toBe(false)
  })
})
