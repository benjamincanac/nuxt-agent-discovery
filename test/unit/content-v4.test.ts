import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { comarkContent, contentHub } from 'comark-content'
import fs from 'comark-content/sources/fs'
import { GETTING_STARTED_BODY, INDEX_BODY, SITE_URL } from '../e2e/expected'

/**
 * The `@nuxt/content` v4 adapter against real comark-content surfaces: the
 * single instance a `server/content.ts` with one `source` exports, and the hub
 * v4 builds from a v3 `content.config.ts`, one instance per collection.
 */
vi.mock('../../src/runtime/server/utils/agent-discovery', () => ({
  getAgentSiteUrl: () => SITE_URL,
  getAgentMarkdownFormat: () => 'markdown/comark'
}))

vi.mock('nitropack/runtime', () => ({
  useNitroApp: () => ({ hooks: { callHook: async () => {} } })
}))

// The server `content` v4 auto-imports. Only the default export reads it.
vi.mock('#imports', () => ({ content: undefined }))

const { createContentV4Source } = await import('../../src/runtime/server/sources/content-v4')

const contentDir = fileURLToPath(new URL('../fixtures/comark/content', import.meta.url))
const event = {} as never

const single = createContentV4Source(() => comarkContent('content', { source: fs(contentDir) }) as never)

const hub = contentHub([
  comarkContent('docs', { source: fs(`${contentDir}/docs`, { prefix: '/docs' }) }),
  comarkContent('pages', { source: fs(contentDir, { exclude: ['docs/**'] }) })
])
const hubbed = createContentV4Source(() => hub as never)

describe('@nuxt/content v4 source', () => {
  it('renders documents from a single instance', async () => {
    expect((await single.get('/', event))?.markdown).toBe(INDEX_BODY)
    expect((await single.get('/docs/getting-started', event))?.markdown).toBe(GETTING_STARTED_BODY)
  })

  it('renders documents across a hub', async () => {
    expect((await hubbed.get('/', event))?.markdown).toBe(INDEX_BODY)
    expect((await hubbed.get('/docs/getting-started', event))?.markdown).toBe(GETTING_STARTED_BODY)
    expect(await hubbed.get('/nope', event)).toBe(null)
  })

  it('lists every page with no selector', async () => {
    const routes = ((await hubbed.list!(undefined, event)) || []).map(entry => entry.route)

    expect(routes).toEqual(expect.arrayContaining(['/', '/about', '/docs/getting-started', '/docs/components/button']))
  })

  it('scopes a v3 `contentCollection` section to that collection', async () => {
    const routes = ((await hubbed.list!({ contentCollection: 'docs' }, event)) || []).map(entry => entry.route)

    expect(routes.length).toBeGreaterThan(0)
    expect(routes.every(route => route.startsWith('/docs'))).toBe(true)
  })

  it('lists the whole instance when a single one is the collection named', async () => {
    const routes = ((await single.list!({ contentCollection: 'content' }, event)) || []).map(entry => entry.route)

    expect(routes).toContain('/docs/getting-started')
  })

  it('returns null for a collection it does not have, and keeps comark selectors', async () => {
    expect(await hubbed.list!({ contentCollection: 'blog' }, event)).toBe(null)

    const routes = ((await hubbed.list!({ navigation: '/docs' }, event)) || []).map(entry => entry.route)
    expect(routes.every(route => route.startsWith('/docs'))).toBe(true)
  })

  it('resolves a section path to its first document', async () => {
    const leaf = await hubbed.firstLeaf?.('/docs', event)

    expect(leaf).toBeTruthy()
    expect(await hubbed.get(leaf!, event)).toBeTruthy()
  })
})
