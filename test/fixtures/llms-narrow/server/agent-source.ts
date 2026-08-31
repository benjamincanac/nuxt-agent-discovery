import { defineAgentContentSource } from '#agent-discovery'

/**
 * In-memory adapter for a site whose `routes` cover less than its curation:
 * `/docs/**` negotiates, the curated section links `/guide/intro` anyway.
 */
const pages: Record<string, { title: string, description: string, markdown: string }> = {
  '/docs/alpha': {
    title: 'Alpha',
    description: 'A docs page the section leaves out.',
    markdown: `# Alpha

> A docs page the section leaves out.

Negotiable, listed by the adapter, absent from the curated documents.
`
  },
  '/guide/intro': {
    title: 'Intro',
    description: 'A page outside `routes`.',
    markdown: `# Intro

> A page outside \`routes\`.

Curated by hand while sitting outside the negotiated patterns.
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

  async get(route: string) {
    return pages[route] || null
  }
})
