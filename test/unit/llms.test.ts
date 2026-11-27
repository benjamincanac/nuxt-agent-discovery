import { beforeEach, describe, it, expect, vi } from 'vitest'
import type { AgentContentSource } from '../../src/runtime/shared/types'
import type { LlmsOptions } from '../../src/runtime/server/utils/llms'

/**
 * The bridge collects every raw twin `llms.txt` links into one
 * `x-nitro-prerender` header, which on a documentation site is hundreds of
 * paths. Only the prerender crawler ever reads it, so the predicate is pinned
 * here: emitting it under `nitro-dev` put a 350+ path header on every `/` and
 * `/llms.txt` response, and the Nuxt dev proxy never relayed those responses
 * at all. The server logged a 200 while the client hung.
 */
const { createLlmsBridge, emitsPrerenderHints } = await import('../../src/runtime/server/utils/llms')
const { setAgentContentSource } = await import('./source.stub')
const { setRuntimeConfig } = await import('./nitro.stub')

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

const event = {} as never

const PAGES = [
  { route: '/docs/a', title: 'A', section: 'Docs' },
  { route: '/docs/b', title: 'B', section: 'Docs' },
  { route: '/api/secret', title: 'Secret', section: 'Docs' }
]

/** An adapter answering the `{ contentCollection: 'docs' }` selector with every page, an excluded one included. */
function createSource(overrides: Partial<AgentContentSource> = {}): AgentContentSource {
  return {
    list: async selector => selector ? ((selector as { contentCollection?: string }).contentCollection ? PAGES : null) : PAGES,
    get: async route => ({ markdown: `# ${route}\n`, title: route }),
    ...overrides
  }
}

beforeEach(() => {
  setRuntimeConfig({
    app: { baseURL: '/' },
    agentDiscovery: {
      siteUrl: 'https://example.com',
      siteName: 'Example',
      rawPrefix: '/raw',
      routes: [{ path: '/docs/**' }],
      excludePrefixes: ['/api/'],
      links: []
    }
  })
  setAgentContentSource(createSource())
})

const hrefs = (options: LlmsOptions) => options.sections.flatMap(section => (section.links || []).map(link => link.href))

describe('llms bridge: llms.txt', () => {
  it('skips excluded pages in a section the adapter resolves', async () => {
    const options: LlmsOptions = { domain: 'https://example.com', sections: [{ title: 'Docs', contentCollection: 'docs' } as never] }
    await createLlmsBridge().generate(event, options)

    expect(hrefs(options)).toEqual(['https://example.com/raw/docs/a.md', 'https://example.com/raw/docs/b.md'])
  })

  it('reads a domain without a scheme as https', async () => {
    const options: LlmsOptions = { domain: 'example.com', sections: [{ title: 'Docs', contentCollection: 'docs' } as never] }
    await createLlmsBridge().generate(event, options)

    expect(options.sections.map(section => section.title)).toEqual(['Docs'])
    expect(hrefs(options)).toEqual(['https://example.com/raw/docs/a.md', 'https://example.com/raw/docs/b.md'])
  })
})

describe('llms bridge: llms-full.txt', () => {
  it('skips excluded pages in a section the adapter resolves', async () => {
    const contents: string[] = []
    await createLlmsBridge().generateFull(event, { domain: 'https://example.com', sections: [{ title: 'Docs', contentCollection: 'docs' } as never] }, contents)

    expect(contents).toEqual(['# /docs/a\n', '# /docs/b\n'])
  })

  it('skips a page whose `get()` rejects and keeps the others', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setAgentContentSource(createSource({
      get: async (route) => {
        if (route === '/docs/a') {
          throw new Error('boom')
        }
        return { markdown: `# ${route}\n` }
      }
    }))
    const contents: string[] = []
    try {
      await createLlmsBridge().generateFull(event, { domain: 'https://example.com', sections: [] }, contents)

      expect(contents).toEqual(['# /docs/b\n'])
      expect(warn).toHaveBeenCalledOnce()
      expect(String(warn.mock.calls[0]![0])).toContain('/docs/a')
    } finally {
      warn.mockRestore()
    }
  })
})
