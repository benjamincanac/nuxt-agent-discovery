/**
 * The documents every content backend has to produce, byte for byte.
 *
 * Prose only. The two stringifiers disagree on the blank lines inside a
 * component block, so nothing here carries one: `test/unit/comark.test.ts`
 * pins that difference instead of pretending it away.
 *
 * `basic` serves these from `@nuxt/content` through the built-in adapter,
 * `custom-source` from a hand-written in-memory adapter, and `comark` from
 * `comark-content` through `createComarkSource()`. Same `llms.domain`, same
 * `siteName`, same pages, so a site swapping content backend must see no
 * difference at all. That is the migration insurance from the design's
 * acceptance criteria.
 *
 * Split in two on purpose. The `*_BODY` half is what an adapter returns, which
 * `test/unit/comark.test.ts` asserts directly with no Nuxt build in the way.
 * The `*_MARKDOWN` half is the document the raw route serves, body plus the
 * frontmatter and `## Sitemap` footer `runtime/server/routes/raw.ts` wraps it
 * in.
 */

export const SITE_URL = 'https://basic.example.com'

export const MARKDOWN_CONTENT_TYPE = 'text/markdown; charset=utf-8'
export const MARKDOWN_VARY = 'Accept, User-Agent'

/* ------------------------------ adapter output ----------------------------- */

export const INDEX_BODY = `# Basic

> Fixture site for the nuxt-agent-discovery e2e tests.

Browse the [documentation](${SITE_URL}/docs/getting-started).
`

export const GETTING_STARTED_BODY = `# Getting Started

> How to get started with the fixture.

## Installation

Install the module and add it to your \`nuxt.config.ts\`.

## Usage

Request any page with \`Accept: text/markdown\` to receive this document as markdown.
`

export const BUTTON_BODY = `# Button

> A button component page used to test nested routes.

## Usage

Use the button.

## Theme

Style the button.
`

export const BADGE_BODY = `# Badge

> A page exercising code fences and related links.

## Usage

A fenced code block, which both renderers must emit identically.

\`\`\`ts
const label = 'Badge'
\`\`\`

---

- [Reka UI](https://reka-ui.com/docs/components/badge)
- [GitHub](https://github.com/nuxt/ui)
`

/* ----------------------------- served documents ---------------------------- */

/**
 * What the raw route wraps a body in: the frontmatter it builds from the
 * page's own title and description, and the sitemap footer it appends while
 * `/sitemap.md` is registered. Kept here rather than pasted into each constant
 * so a change to the envelope fails every suite at once, loudly, instead of
 * being copied into four literals.
 */
function rawDocument(page: { title: string, description: string, path: string }, body: string): string {
  const frontmatter = [
    '---',
    `title: ${JSON.stringify(page.title)}`,
    `description: ${JSON.stringify(page.description)}`,
    `canonical_url: ${JSON.stringify(`${SITE_URL}${page.path}`)}`,
    '---',
    ''
  ].join('\n')

  return `${frontmatter}${body}\n\n## Sitemap\n\nSee the full [sitemap](${SITE_URL}/sitemap.md) for all pages.\n`
}

export const INDEX_MARKDOWN = rawDocument({
  title: 'Basic',
  description: 'Fixture site for the nuxt-agent-discovery e2e tests.',
  path: ''
}, INDEX_BODY)

export const GETTING_STARTED_MARKDOWN = rawDocument({
  title: 'Getting Started',
  description: 'How to get started with the fixture.',
  path: '/docs/getting-started'
}, GETTING_STARTED_BODY)

export const BUTTON_MARKDOWN = rawDocument({
  title: 'Button',
  description: 'A button component page used to test nested routes.',
  path: '/docs/components/button'
}, BUTTON_BODY)

export const BADGE_MARKDOWN = rawDocument({
  title: 'Badge',
  description: 'A page exercising code fences and related links.',
  path: '/docs/components/badge'
}, BADGE_BODY)

/** `Link` the raw markdown handler sets on a dynamically served document. */
export const GETTING_STARTED_LINK = `<${SITE_URL}/docs/getting-started>; rel="canonical", <${SITE_URL}/docs/getting-started>; rel="alternate"; type="text/html"`

/** A realistic AI agent user agent, matched against the shared agent list. */
export const CLAUDE_BOT = 'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)'

/** What a browser sends on a navigation. */
export const BROWSER_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
