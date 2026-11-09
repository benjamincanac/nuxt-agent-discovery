import { describe, it, expect, beforeEach } from 'vitest'
import type { H3Event } from 'h3'

/**
 * `sitemap.md` section headings. The groups come from the path, but the
 * labels should read the way the site's own navigation does.
 */
const { sitemapMarkdown } = await import('../../src/runtime/server/utils/sitemap-markdown')
const { setAgentContentSource } = await import('./source.stub')
const { setRuntimeConfig } = await import('./nitro.stub')

const event = {} as H3Event

const configure = (sitemapSections: { expand: string[], labels: Record<string, string> } = { expand: [], labels: {} }) => setRuntimeConfig({
  agentDiscovery: {
    siteUrl: 'https://example.com',
    siteName: 'Example',
    rawPrefix: '/raw',
    routes: [{ path: '/', raw: '/raw/index.md' }, { path: '/**' }],
    excludePrefixes: [],
    sitemapSections
  }
})

beforeEach(() => {
  configure()
  setAgentContentSource({
    async list() {
      return [
        { route: '/' },
        { route: '/ai/mcp', title: 'MCP Server' },
        { route: '/getting-started/installation', title: 'Installation' },
        { route: '/essentials/code-blocks', title: 'Code Blocks' }
      ]
    },
    async sectionTitles() {
      return { '/ai': 'AI', '/getting-started': 'Getting Started' }
    },
    async get() {
      return null
    }
  })
})

describe('sitemap.md: section headings', () => {
  it('takes a section heading from the directory title the source knows', async () => {
    const { body } = await sitemapMarkdown(event)

    expect(body).toContain('## AI\n')
    expect(body).toContain('## Getting Started\n')
    // No title for that directory, so the heading still derives from the path.
    expect(body).toContain('## Essentials\n')
  })

  it('lets a configured label win over the directory title', async () => {
    configure({ expand: [], labels: { ai: 'Agents' } })

    const { body } = await sitemapMarkdown(event)

    expect(body).toContain('## Agents\n')
    expect(body).not.toContain('## AI\n')
  })

  it('looks the title up under the expanded prefix', async () => {
    configure({ expand: ['/docs'], labels: {} })
    setAgentContentSource({
      async list() {
        return [{ route: '/docs/ai/mcp', title: 'MCP Server' }]
      },
      async sectionTitles() {
        return { '/docs': 'Docs', '/docs/ai': 'AI' }
      },
      async get() {
        return null
      }
    })

    const { body } = await sitemapMarkdown(event)

    expect(body).toContain('## AI\n')
  })
})

describe('sitemap.md: page titles', () => {
  it('names an untitled homepage after the site, not its path', async () => {
    const { body } = await sitemapMarkdown(event)

    expect(body).toContain('- [Example](https://example.com/raw/index.md)')
    expect(body).not.toContain('- [/]')
  })
})
