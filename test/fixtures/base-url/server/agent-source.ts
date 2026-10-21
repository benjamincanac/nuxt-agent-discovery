import { defineAgentContentSource } from '#agent-discovery'

const pages: Record<string, { title: string, description: string, markdown: string }> = {
  '/': {
    title: 'Base URL',
    description: 'Fixture served under a base path.',
    markdown: `# Base URL

> Fixture served under a base path.

See the [docs](/docs/alpha).
`
  },
  '/docs/alpha': {
    title: 'Alpha',
    description: 'A page.',
    markdown: `# Alpha

> A page.

Body of Alpha.
`
  },
  '/docs/cached/beta': {
    title: 'Beta',
    description: 'A page under a cached route rule.',
    markdown: `# Beta

> A page under a cached route rule.

Body of Beta.
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
