import { defineAgentContentSource } from '#agent-discovery'

const pages: Record<string, { title: string, description: string, markdown: string }> = {
  '/': {
    title: 'Bare',
    description: 'Fixture with no site URL configured.',
    markdown: `# Bare

> Fixture with no site URL configured.

See the [docs](/docs/alpha).
`
  },
  '/docs/alpha': {
    title: 'Alpha',
    description: 'The one documentation page.',
    markdown: `# Alpha

> The one documentation page.

Body of Alpha.
`
  }
}

export default defineAgentContentSource({
  async list(selector) {
    if (selector) {
      return null
    }
    return Object.entries(pages).map(([route, page]) => ({ route, title: page.title, description: page.description }))
  },
  async get(route) {
    return pages[route] || null
  }
})
