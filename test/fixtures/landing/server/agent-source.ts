import { defineAgentContentSource } from '#agent-discovery'

/**
 * The shape `nuxt/ui` docs, `nuxt.com` and `whichcodingtools` have: pages come
 * from structured data, and `/` is a Vue page with no document behind it. The
 * adapter deliberately has no `/` entry, so `/raw/index.md` falls through to
 * the module's generated index.
 *
 * `/docs` is a section with no page of its own, which `firstLeaf` resolves.
 */
const pages: Record<string, { title: string, description: string, markdown: string }> = {
  '/docs/getting-started': {
    title: 'Getting Started',
    description: 'How to get started.',
    markdown: '# Getting Started\n\n> How to get started.\n'
  },
  '/docs/components/button': {
    title: 'Button',
    description: 'A button component.',
    markdown: '# Button\n\n> A button component.\n'
  }
}

export default defineAgentContentSource({
  async list() {
    return Object.entries(pages).map(([route, page]) => ({
      route,
      title: page.title,
      description: page.description,
      section: route.startsWith('/docs/components/') ? 'Components' : 'Guide'
    }))
  },

  async firstLeaf(route: string) {
    const prefix = `${route}/`
    return Object.keys(pages).find(path => path.startsWith(prefix)) || null
  },

  async get(route: string) {
    return pages[route] || null
  }
})
