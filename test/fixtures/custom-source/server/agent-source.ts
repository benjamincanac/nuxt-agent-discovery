import { defineAgentContentSource } from '#agent-discovery'

/**
 * In-memory stand-in for a non-`@nuxt/content` backend (comark, a CMS, a
 * hand-rolled MDC transformer).
 *
 * The markdown bodies are byte-for-byte what the `basic` fixture's
 * `@nuxt/content` pages stringify to, minus the frontmatter, which
 * `runtime/server/routes/raw.ts` adds itself. `test/e2e/custom-source.test.ts`
 * asserts both fixtures serve identical documents.
 */
const pages: Record<string, { title: string, description: string, markdown: string }> = {
  '/': {
    title: 'Basic',
    description: 'Fixture site for the nuxt-agent-discovery e2e tests.',
    markdown: `# Basic

> Fixture site for the nuxt-agent-discovery e2e tests.

Browse the [documentation](/docs/getting-started).
`
  },
  '/docs/getting-started': {
    title: 'Getting Started',
    description: 'How to get started with the fixture.',
    markdown: `# Getting Started

> How to get started with the fixture.

## Installation

Install the module and add it to your \`nuxt.config.ts\`.

## Usage

Request any page with \`Accept: text/markdown\` to receive this document as markdown.
`
  },
  '/docs/components/button': {
    title: 'Button',
    description: 'A button component page used to test nested routes.',
    markdown: `# Button

> A button component page used to test nested routes.

## Usage

Use the button.

## Theme

Style the button.
`
  }
}

export default defineAgentContentSource({
  async routes() {
    return Object.keys(pages)
  },

  async list() {
    return Object.entries(pages).map(([route, page]) => ({ route, title: page.title, description: page.description }))
  },

  async get(route: string) {
    return pages[route] || null
  }
})
