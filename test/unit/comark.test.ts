import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { comarkContent } from 'comark-content'
import fs from 'comark-content/sources/fs'
import { BADGE_BODY, BUTTON_BODY, GETTING_STARTED_BODY, INDEX_BODY, SITE_URL } from '../e2e/expected'
import { createComarkSource } from '../../src/runtime/server/sources/comark'
import type { AgentContentSource } from '../../src/runtime/shared/types'

/**
 * The comark adapter against the documents the `@nuxt/content` one produces.
 *
 * This is the migration insurance from the design, run without a Nuxt build:
 * both fixtures hold the same source markdown, so a divergence in either
 * renderer shows up here as a diff on the exact bytes rather than as a failing
 * e2e assertion twenty seconds into a build.
 *
 * The two module-level dependencies of the adapter are stubbed rather than
 * booted. `getAgentSiteUrl` reads runtime config off a request, and the
 * document hook needs a Nitro app; neither is what this file is testing.
 */
vi.mock('../../src/runtime/server/utils/agent-discovery', () => ({
  getAgentSiteUrl: () => SITE_URL
}))

vi.mock('nitropack/runtime', () => ({
  useNitroApp: () => ({ hooks: { callHook: async () => {} } })
}))

const contentDir = fileURLToPath(new URL('../fixtures/comark/content', import.meta.url))

// Stands in for a request. Nothing reads it: `getAgentSiteUrl` is mocked and
// the accessor ignores it, but `get()` requires one to be passed.
const event = {} as never

const content = comarkContent({ sources: { content: fs(contentDir) } })
const source = createComarkSource(() => content as never)

/** A one-document content instance, for trees the fixture cannot express. */
function createStubSource(document: unknown): AgentContentSource {
  return createComarkSource(() => ({
    get: async () => document,
    navigation: async () => []
  }) as never)
}

describe('comark source', () => {
  it('renders the same documents the `@nuxt/content` adapter does', async () => {
    expect((await source.get('/', event))?.markdown).toBe(INDEX_BODY)
    expect((await source.get('/docs/getting-started', event))?.markdown).toBe(GETTING_STARTED_BODY)
    expect((await source.get('/docs/components/button', event))?.markdown).toBe(BUTTON_BODY)
  })

  it('appends the related links from frontmatter', async () => {
    expect((await source.get('/docs/components/badge', event))?.markdown).toBe(BADGE_BODY)
  })

  it('carries the title and description off the frontmatter', async () => {
    const page = await source.get('/docs/getting-started', event)

    expect(page?.title).toBe('Getting Started')
    expect(page?.description).toBe('How to get started with the fixture.')
  })

  it('resolves `/index` to the same document as `/`', async () => {
    const index = await source.get('/index', event)

    expect(index?.markdown).toBe(INDEX_BODY)
  })

  it('404s an unknown route', async () => {
    expect(await source.get('/nope', event)).toBe(null)
  })

  it('does not mutate the document it was handed', async () => {
    // The adapter absolutizes links in place and pushes the title and the
    // related links onto the tree. Handing back comark's own object would let
    // a second request see the first request's origin baked into every href.
    const first = await source.get('/docs/components/badge', event)
    const second = await source.get('/docs/components/badge', event)

    expect(second?.markdown).toBe(first?.markdown)
  })

  it('drops a `style` node instead of rendering it', async () => {
    // comark declares `removeLastStyle` and reads it nowhere, so a
    // highlighter's per-document CSS would otherwise land in the markdown.
    const withStyle = {
      meta: { kind: 'document' },
      data: { title: 'Styled' },
      nodes: [['p', {}, 'Body.'], ['style', {}, '.shiki { --shiki-foo: red }']]
    }
    const styled = createStubSource(withStyle)

    const page = await styled.get('/styled', event)

    expect(page?.markdown).not.toContain('shiki')
    expect(page?.markdown).toBe('# Styled\n\nBody.\n')
  })

  it('absolutizes site-relative links, including component props', async () => {
    const relative = {
      meta: { kind: 'document' },
      data: { title: 'Links' },
      nodes: [
        ['p', {}, ['a', { href: '/docs/getting-started' }, 'Guide']],
        ['my-card', { to: '/docs/components/button', src: 'https://cdn.example.com/a.png' }, 'Card']
      ]
    }
    const page = await createStubSource(relative).get('/links', event)

    expect(page?.markdown).toContain(`${SITE_URL}/docs/getting-started`)
    expect(page?.markdown).toContain(`to="${SITE_URL}/docs/components/button"`)
    // Already absolute, so it is left alone.
    expect(page?.markdown).toContain('https://cdn.example.com/a.png')
  })
})

describe('comark listing', () => {
  it('lists every page in the navigation', async () => {
    const routes = ((await source.list(undefined, event)) || []).map(entry => entry.route)

    expect(routes).toContain('/')
    expect(routes).toContain('/about')
    expect(routes).toContain('/docs/getting-started')
    expect(routes).toContain('/docs/components/button')
  })

  it('carries the title and the navigation group into the listing', async () => {
    const entries = await source.list(undefined, event)
    const button = entries?.find(entry => entry.route === '/docs/components/button')

    expect(button?.title).toBe('Button')
    expect(button?.section).toBeTruthy()
  })

  it('scopes a listing to the subtree a `navigation` selector names', async () => {
    const entries = await source.list({ navigation: '/docs' }, event)

    expect(entries?.length).toBeGreaterThan(0)
    expect(entries?.every(entry => entry.route.startsWith('/docs'))).toBe(true)
  })

  it('returns null for a selector belonging to another adapter', async () => {
    // A site swapping backend keeps its `llms.sections` config, so the
    // `@nuxt/content` keys arrive here. Claiming them would list the wrong
    // pages; the bridge drops the section instead.
    expect(await source.list({ contentCollection: 'docs' }, event)).toBe(null)
  })

  it('resolves a section path to its first document', async () => {
    const leaf = await source.firstLeaf?.('/docs', event)

    expect(leaf).toBeTruthy()
    expect(leaf).not.toBe('/docs')
    expect(await source.get(leaf!, event)).toBeTruthy()
  })
})
