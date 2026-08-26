/**
 * The documents both content backends have to produce, byte for byte.
 *
 * The `basic` fixture serves these from `@nuxt/content` through the built-in
 * adapter; `custom-source` serves them from a hand-written in-memory adapter.
 * Same `llms.domain`, same `siteName`, same three pages, so a site swapping
 * content backend must see no difference at all. That is the migration
 * insurance from the design's acceptance criteria.
 *
 * The frontmatter is added by `runtime/server/routes/raw.ts`, not by either
 * adapter, and the `## Sitemap` footer by the same handler when `/sitemap.md`
 * is registered.
 */

export const SITE_URL = 'https://basic.example.com'

export const MARKDOWN_CONTENT_TYPE = 'text/markdown; charset=utf-8'
export const MARKDOWN_VARY = 'Accept, User-Agent'

export const INDEX_MARKDOWN = `---
title: "Basic"
description: "Fixture site for the nuxt-agent-discovery e2e tests."
canonical_url: "https://basic.example.com"
---
# Basic

> Fixture site for the nuxt-agent-discovery e2e tests.

Browse the [documentation](https://basic.example.com/docs/getting-started).


## Sitemap

See the full [sitemap](https://basic.example.com/sitemap.md) for all pages.
`

export const GETTING_STARTED_MARKDOWN = `---
title: "Getting Started"
description: "How to get started with the fixture."
canonical_url: "https://basic.example.com/docs/getting-started"
---
# Getting Started

> How to get started with the fixture.

## Installation

Install the module and add it to your \`nuxt.config.ts\`.

## Usage

Request any page with \`Accept: text/markdown\` to receive this document as markdown.


## Sitemap

See the full [sitemap](https://basic.example.com/sitemap.md) for all pages.
`

export const BUTTON_MARKDOWN = `---
title: "Button"
description: "A button component page used to test nested routes."
canonical_url: "https://basic.example.com/docs/components/button"
---
# Button

> A button component page used to test nested routes.

## Usage

Use the button.

## Theme

Style the button.


## Sitemap

See the full [sitemap](https://basic.example.com/sitemap.md) for all pages.
`

/** `Link` the raw markdown handler sets on a dynamically served document. */
export const GETTING_STARTED_LINK = `<${SITE_URL}/docs/getting-started>; rel="canonical", <${SITE_URL}/docs/getting-started>; rel="alternate"; type="text/html"`

/** A realistic AI agent user agent, matched against the shared agent list. */
export const CLAUDE_BOT = 'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)'

/** What a browser sends on a navigation. */
export const BROWSER_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
