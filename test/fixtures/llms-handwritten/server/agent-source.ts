import { defineAgentContentSource } from '#agent-discovery'

/**
 * In-memory adapter for a site that curates its `llms.sections` by hand.
 *
 * `list()` returns `null` for any selector, which is the contract for a
 * section the adapter does not recognise, and a hand-written section never
 * names anything it could. So the curated links are the only thing either
 * document has to go on, and the pages outside them have to stay out of both.
 */
const pages: Record<string, { title: string, description: string, markdown: string }> = {
  '/': {
    title: 'Handwritten',
    description: 'Fixture site whose llms sections are all hand-written.',
    markdown: `# Handwritten

> Fixture site whose llms sections are all hand-written.

Browse the [documentation](/docs/alpha).
`
  },
  '/docs/alpha': {
    title: 'Alpha',
    description: 'The documented page.',
    markdown: `# Alpha

> The documented page.

The one page the hand-written section links.
`
  },
  '/docs/café': {
    title: 'Café',
    description: 'The accented page.',
    markdown: `# Café

> The accented page.

Stored under a decoded slug, linked through a percent-encoded URL.
`
  },
  '/docs/beta': {
    title: 'Beta',
    description: 'A page the sections leave out.',
    markdown: `# Beta

> A page the sections leave out.

Reachable as raw markdown, absent from the curated documents.
`
  },
  '/private/hidden': {
    title: 'Hidden',
    description: 'A page kept out of the documentation on purpose.',
    markdown: `# Hidden

> A page kept out of the documentation on purpose.

Kept out of the documentation on purpose.
`
  }
}

export default defineAgentContentSource({
  async list(selector) {
    if (selector) {
      // One recognized selector, so the mixed-section rule is testable: a
      // section carrying its own links must not also resolve it.
      return (selector as { docs?: boolean }).docs === true
        ? [{ route: '/docs/beta', title: 'Beta', description: 'A page the sections leave out.' }]
        : null
    }
    return Object.entries(pages).map(([route, page]) => ({ route, title: page.title, description: page.description }))
  },

  async get(route: string) {
    return pages[route] || null
  }
})
