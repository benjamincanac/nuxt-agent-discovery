# nuxt-agent-discovery

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![License][license-src]][license-href]
[![Nuxt][nuxt-src]][nuxt-href]

Markdown content negotiation, CDN-level rewrites, and discovery documents for AI agents on Nuxt documentation sites.

## Features

- `Accept` / User-Agent content negotiation with real q-value parsing (RFC 9110)
- Vercel Build Output routes so prerendered pages negotiate at the edge, and a Nitro middleware for dev and every other host
- Correct `Vary` and `Link` headers on both halves of a negotiated page, CDN-served files included
- A raw markdown route driven by a pluggable content adapter: `@nuxt/content` built in, comark through a factory, or your own
- A `nuxt-llms` bridge: adapter-backed sections and the full document come from the content adapter, hand-written links stay yours
- Markdown error bodies with recovery links for agents hitting a 404
- `/.well-known/api-catalog` (RFC 9727), an optional MCP server card, and Agent Skills under `/.well-known/skills/`
- `/sitemap.md`, a markdown index of every page, grouped into sections you control
- `robots.txt` AI policy generated from the same user-agent list negotiation matches
- `listAgentPages()`, `getAgentDocument()` and `extractSections()`, the three pieces an MCP docs tool is built from
- An `agent-discovery:extend` hook so other modules can add discovery links and user agents

## Quick Setup

1. Add `nuxt-agent-discovery` to your project

```bash
pnpm add -D nuxt-agent-discovery
```

2. Add it to the `modules` section of `nuxt.config.ts`

```ts
export default defineNuxtConfig({
  modules: ['nuxt-agent-discovery']
})
```

Zero-config works when `@nuxt/content` and `nuxt-llms` are already installed: the content source is auto-detected and every page (`/**`) negotiates markdown. Out of the box you get the raw markdown route under `/raw`, markdown for `Accept: text/markdown`, explicit `.md` twin URLs and known agent User-Agents, `Vary` on both halves of every negotiated page, a discovery `Link` header on `/`, the `/.well-known/api-catalog` and `/sitemap.md` documents, a `robots.txt` allowing the agent list, and markdown error bodies.

## How negotiation decides

In this order:

1. An explicit `.md` twin URL is always a markdown request, whatever the headers say.
2. `Accept: text/markdown` with a q-value that `text/html` doesn't outrank. A wildcard on its own never counts as asking, so `*/*` and `text/*` keep HTML.
3. `Accept` refusing `text/html` outright while a wildcard permits markdown, as in `text/html;q=0, */*`.
4. A known agent User-Agent, matched case-insensitively against the shared list.

Exclusions never negotiate: `/_`, `/api/`, `/mcp`, `/.well-known/`, the raw prefix itself, and any path whose last segment is dotted (assets, `_payload.json`, images).

Errors follow the same idea but browsers are protected: a `fetch()` call keeps the HTML or JSON error it was written against, and an explicit `Accept: text/html` or `application/json` is honored unless the client is a known agent. Everything else, curl, an empty `Accept`, a navigation, gets the markdown error body.

### Strict content negotiation

A negotiated page has exactly two representations, so an `Accept` allowing neither is a 406 per RFC 9110. `notAcceptable: true` makes the module answer one, at the origin and at the Vercel edge both. It's off by default because the strictly correct answer breaks clients that send a narrow `Accept` without meaning it. Browsers, `fetch()`, navigations and known agents are never refused, a header carrying no media range at all is ignored, and the 406 body lists the two representations.

## Configuration

```ts
export default defineNuxtConfig({
  agentDiscovery: {
    siteUrl: '',                 // '' resolves per-request / from `site.url` / `llms.domain`
    siteName: '',                // falls back to `site.name`
    rawPrefix: '/raw',
    source: 'auto',                    // 'auto' | 'content' | false | path to an AgentContentSource
    routes: ['/', '/**'],
    excludePrefixes: { extend: [] },   // or { replace: [...] }
    userAgents: { extend: [] },        // or { replace: [...] }
    discovery: {
      link: true,
      apiCatalog: true,
      sitemapXml: true,               // only when `@nuxtjs/sitemap` is installed and enabled
      mcpServerCard: false,
      links: []
    },
    errors: true,
    notAcceptable: false,
    sitemap: { markdown: true },
    robots: { aiPolicy: true, contentSignal: 'search=yes, ai-train=yes, ai-input=yes', disallow: [] },
    skills: { dir: 'skills' }
  }
})
```

- **`siteUrl`** Canonical site URL. Left empty it resolves from `site.url`, then `llms.domain`, then per request from the incoming host.
- **`siteName`** Used in `sitemap.md` and the generated `/raw/index.md`. Falls back to `site.name`.
- **`rawPrefix`** Where raw markdown representations live.
- **`source`** `'auto'` detects `@nuxt/content`, `'content'` forces it, `false` disables every content-backed feature, anything else is a path to a file exporting an `AgentContentSource` (see [Content sources](#content-sources)).
- **`routes`** Page patterns markdown is negotiated for, as strings or `{ path, raw }` objects. `*` matches one segment, `**` one or more. `raw` overrides the raw destination on exact patterns; point it under `rawPrefix` or an excluded prefix so the destination never re-enters negotiation, and the build refuses one that negotiates back to itself. Pages the content source doesn't hold answer agents a 404 by design, so on a site mixing hand-written pages with a partial content directory, narrow the patterns or use `excludePrefixes`.
- **`excludePrefixes.extend`** Extra path prefixes on top of the defaults (`/_`, `/api/`, `/mcp`, `/.well-known/`). An excluded path is not a page anywhere: it never negotiates, no listing includes it, and the raw route answers 404 for it. Server code can still reach one through the `includeExcluded` option on `getAgentDocument()` and `listAgentPages()`. Add any standalone `.md` document the site serves itself. **`.replace`** replaces the list.
- **`userAgents.extend`** Extra user agents on top of the defaults (18 agents from `ai.robots.txt`, see `src/defaults.ts`). **`.replace`** replaces the list.
- **`discovery.link`** Emit the discovery `Link` header on `/`.
- **`discovery.apiCatalog`** Serve `/.well-known/api-catalog` (RFC 9727).
- **`discovery.sitemapXml`** Advertise `/sitemap.xml`, only when `@nuxtjs/sitemap` is installed and enabled. A disabled companion counts as absent everywhere: the module then serves `/robots.txt` itself and registers no sitemap filter.
- **`discovery.mcpServerCard`** Given an `McpServerCardOptions` object, serves `/.well-known/mcp/server-card.json`.
- **`discovery.links`** Site-specific discovery links. Rels are validated against the IANA registry, an invented one fails the build.
- **`errors`** Answer errors with a markdown body carrying recovery links when the request prefers it.
- **`notAcceptable`** See [Strict content negotiation](#strict-content-negotiation).
- **`sitemap.markdown`** Serve `/sitemap.md` from the content adapter. Pass an object to control grouping: `expand` lists prefixes whose children each get their own section, `labels` overrides derived headings.
- **`skills`** Agent Skills served under `/.well-known/skills/`. Each subdirectory of `dir` holding a `SKILL.md` with a `description` becomes a skill, its files listed from disk into a generated index. `false` to disable.
- **`robots.aiPolicy`** Feeds the user-agent list into `@nuxtjs/robots` when installed, otherwise generates `/robots.txt` (skipped when a static one exists). **`robots.contentSignal`** adds the `Content-Signal` line, `false` to omit. **`robots.disallow`** adds `Disallow` lines to the wildcard group, in the generated file and through `@nuxtjs/robots` alike. Wildcard only: the per-agent `Allow` groups exempt their agents from these rules, so what search engines skip stays reachable for the agents the site names.

## Routes

| Route | Registered when |
| --- | --- |
| `/raw/**.md` | a content source resolves, under whatever `rawPrefix` is set to |
| `/sitemap.md` | a content source resolves and `sitemap.markdown` is on |
| `/.well-known/api-catalog` | `discovery.apiCatalog` |
| `/.well-known/mcp/server-card.json` | `discovery.mcpServerCard` is an object |
| `/.well-known/skills/index.json` and `/.well-known/skills/**` | at least one valid skill is found |
| `/robots.txt` | `robots.aiPolicy`, and neither `@nuxtjs/robots` nor a static `public/robots.txt` |

`/llms.txt` and `/llms-full.txt` belong to `nuxt-llms`; this module feeds them but never registers them.

With the built-in `@nuxt/content` source, the raw twin of every exact route pattern and `/sitemap.md` are prerendered, every prerendered page hands Nitro's crawler its own twin, and the `nuxt-llms` bridge hands it every twin `llms.txt` links when `/` is prerendered too. On a fully static build (`nuxt generate`) they are prerendered whatever the source, since there is no server to render them per request. A twin the site backs with a handler of its own (a `server/routes/raw/modules.md.get.ts` reading live data, or a handler another module registered on that route) is skipped by both, so it keeps answering per request instead of being frozen at build.

### The raw route

`/raw/**.md` answers `text/markdown; charset=utf-8`, with `Vary: Accept, User-Agent` and a `Link` header carrying the page's `rel="canonical"` and its `rel="alternate"; type="text/html"`. The body opens on frontmatter:

```md
---
title: "Getting Started"
description: "Install the module and negotiate a first page."
canonical_url: "https://example.com/docs/getting-started"
---
```

Then the page markdown, with every same-origin link absolutized. On `/` the discovery registry follows the body as a `## Resources for Agents` block, the same block the generated landing page carries. When `/sitemap.md` is served, a `## Sitemap` section is appended pointing at it.

A path naming a section rather than a page redirects 302 to the section's first document when the adapter implements `firstLeaf()`. Anything else missing answers a real 404 with the markdown error body, so an agent can tell an unknown URL from an empty one. `/` is the exception: with no `/` entry in the adapter, `/raw/index.md` falls through to a generated landing page, see [`agent-discovery:index`](#extending). The recommended way to author the agent homepage is a `/` document in the content source: the module wraps it with the resources block and the sitemap footer, and the generated page is the fallback for sites that have none.

## Content sources

**`'auto'` / `@nuxt/content`** (default when the module is installed): queries every `type: 'page'` collection and stringifies with `minimark/stringify`, resolved from `@nuxt/content` itself so the stringifier is always the one that produced the tree. The output mirrors the raw markdown route `@nuxt/content` registers itself when `nuxt-llms` is present, related links included, so nothing changes for agents when this module takes over. A site transforming MDC components into plain markdown hooks `agent-discovery:document` before the tree is stringified:

```ts
// server/plugins/agent-discovery.ts
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('agent-discovery:document', async (event, page) => {
    // mutate page.body.value (a minimark tree) in place
  })
})
```

**comark**, via `createComarkSource()`. comark sites construct their own content instance, so pass an accessor:

```ts
// server/utils/agent-source.ts
import { createComarkSource } from '#agent-discovery/comark'

export default createComarkSource(() => getProdContent())
```

```ts
export default defineNuxtConfig({
  agentDiscovery: {
    source: '~~/server/utils/agent-source'
  }
})
```

It produces the same document the `@nuxt/content` adapter does for prose, which is what makes swapping backends close to a one-file change. Components are the exception: the two stringifiers serialize a component block with different whitespace, so diff a page carrying components before pointing a comark site at this. `agent-discovery:document` fires here too, with comark's own `ContentFile`.

**Custom**, any other source file, exporting an `AgentContentSource` as its default export:

```ts
// server/utils/agent-source.ts
import { defineAgentContentSource } from '#agent-discovery'

export default defineAgentContentSource({
  async list() {
    return [{ route: '/', title: 'Hello' }]
  },
  async get(route) {
    if (route !== '/') return null
    return { markdown: '# Hello', title: 'Hello' }
  }
})
```

`list(selector, event)` returns every markdown-representable page and feeds `sitemap.md`, `listAgentPages()` and the `nuxt-llms` bridge; with a `selector` (a `llms.sections` entry handed over verbatim) it returns only the pages the selector names, or `null` when it isn't one it understands. It is optional for a get-only source: the listings come out empty and `get()` keeps serving documents. `get(route, event)` resolves one route to its markdown. `firstLeaf(route, event)` is optional and resolves a section path to its first document. Site-relative links are absolutized for you.

### llms.txt sections

The module removes `@nuxt/content`'s llms feature and generates `llms.txt` and `llms-full.txt` from the adapter, so the documents agree with what `/raw/**.md` serves. Existing `llms.sections` config keeps working: each section is handed to the adapter, which reads the keys it declares (`contentCollection`/`contentFilters` for `@nuxt/content`, `navigation` for comark). A section carrying its own `links` is left alone, its same-origin page links rendered into the full document, and each link matching a configured route rewritten to its raw twin; off-site and data links pass through untouched. Declare no sections at all and pages are grouped by the `section` label the adapter returns.

`nuxt-llms` prerenders both documents unconditionally, so on a backend resolving content per request they go stale without a redeploy ([nuxt-llms#24](https://github.com/nuxtlabs/nuxt-llms/issues/24)). Until that lands, opt the two routes out yourself:

```ts
export default defineNuxtConfig({
  nitro: {
    prerender: {
      ignore: ['/llms.txt', '/llms-full.txt']
    }
  }
})
```

## Extending

**`agent-discovery:mcp-server-card`** adds to the served card. With `@nuxtjs/mcp-toolkit` installed the module already lists the server's tools, resources and prompts, so this is for what the toolkit can't know. Tools in the `admin` group are left out, and `discovery.mcpServerCard.excludeGroups` extends that default:

```ts
// server/plugins/agent-discovery.ts
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('agent-discovery:mcp-server-card', (event, card) => {
    card.tools = [...(card.tools ?? []), { name: 'external', description: 'Served elsewhere.' }]
  })
})
```

**`renderAgentResources()`** renders the discovery registry as a markdown block, the same list the `Link` header and the api-catalog are built from. The module appends it to the `/` document itself, so call it only for a page you render by hand.

**`agentDiscoveryOpenApi()`** returns the discovery layer as OpenAPI fragments for sites publishing an `openapi.json`: the negotiated page patterns, their raw twins, and every discovery document the site serves, each with a stable `operationId`. Pass the `paths` you are merging into so your own operation ids are claimed first:

```ts
const discovery = agentDiscoveryOpenApi(event, { paths: myPaths })

return {
  openapi: '3.1.0',
  info: { title: 'Example', version },
  tags: [...discovery.tags, ...myTags],
  paths: { ...discovery.paths, ...myPaths },
  components: { ...discovery.components, schemas: { ...discovery.components.schemas, ...mySchemas } }
}
```

**`agent-discovery:index`** fills in the generated `/raw/index.md` for sites whose landing page is a Vue page rather than a document. Keep it to metadata and data-driven blocks: homepage prose belongs in a `/` document in the content source, which the raw route wraps with the same resources block:

```ts
// server/plugins/agent-discovery.ts
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('agent-discovery:index', (event, index) => {
    index.title = 'Nuxt UI'
    index.description = 'The Intuitive Vue UI Library'
    index.body.push('Nuxt UI is a Vue component library...')
  })
})
```

**`rawUrl()`** resolves a page URL to its markdown twin through the same route config everything else uses:

```ts
import { rawUrl } from '#agent-discovery'

rawUrl(event, '/docs/getting-started') // https://example.com/raw/docs/getting-started.md
```

The same entry point exports `getAgentSiteUrl(event)` and `useAgentDiscoveryConfig(event)`.

**`useCanonical()`** is the app-side half: a `rel="canonical"` link for the current route, and a `rel="alternate"; type="text/markdown"` one when you pass it a markdown path.

**`agent-discovery:sitemap`** adds to `/sitemap.md` before it renders, for the pages the adapter cannot know about. The map is keyed by the raw first path segment of the grouped routes (`docs`, `blog`; the second segment under an expanded prefix, `pages` for top-level ones), and `sitemap.markdown.labels` only applies at render. So extending an existing section means using its key, while a new section can use any key and renders it capitalized unless `labels` overrides it:

```ts
// server/plugins/agent-discovery.ts
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('agent-discovery:sitemap', (event, sections) => {
    // Append to the existing "Docs" section, keyed by its path segment.
    sections.get('docs')?.push({ title: 'Changelog', href: 'https://example.com/raw/changelog.md' })
    // A new section: any key works, `labels` can rename it.
    sections.set('design', [{ title: 'Design system', href: 'https://example.com/design.md' }])
  })
})
```

**`agent-discovery:extend`** lets other modules add discovery links and user agents at build time.

## Agent tooling

The three pieces an MCP docs tool is built from are exported from `#agent-discovery`, backed by the same content adapter and route config as everything else. The module ships no tools of its own, since descriptions are prompt engineering each site tunes:

```ts
// server/mcp/tools/get-page.ts
import { getAgentDocument } from '#agent-discovery'

export default defineMcpTool({
  description: 'Read a documentation page as markdown.',
  inputSchema: { path: z.string(), sections: z.array(z.string()).optional() },
  handler: async ({ path, sections }) => {
    const document = await getAgentDocument(useEvent(), path, { sections })
    if (!document) throw createError({ statusCode: 404, message: `No page at ${path}` })
    if ('redirect' in document) throw createError({ statusCode: 404, message: `${path} is a section, try ${document.redirect}` })
    return document.markdown
  }
})
```

- **`listAgentPages(event, { search, prefix, includeExcluded })`** returns every page with its title, description, section, page URL and raw markdown URL.
- **`getAgentDocument(event, route, { sections, includeExcluded })`** returns the exact bytes `/raw/<route>.md` serves, resolved in-process; passing `sections` narrows the document, so the byte-for-byte guarantee holds without it.

Both skip routes under excluded prefixes, matching the raw route's 404. `includeExcluded: true` opts back in, for the tool serving what the site deliberately does not advertise, like a nightly docs version kept out of `sitemap.md` and `llms.txt`.
- **`extractSections(markdown, titles)`** narrows a document to the `##` sections named, keeping frontmatter, title and description.

## Companion modules

Detected automatically, never a dependency, `@nuxtjs/seo`-installed included:

- **`@nuxtjs/robots`** takes over `robots.txt`; the shared user-agent list and `contentSignal` are contributed through its `robots:config` hook.
- **`@nuxtjs/mcp-toolkit`** owns `/mcp`; the MCP server card reads what it exposes, so it can't advertise a tool the server dropped.
- **`@nuxtjs/sitemap`** owns `sitemap.xml`; the raw markdown twins are dropped from it, since they are alternate representations of pages already listed.

## Deployment

### Vercel

On the `vercel` preset, a Nitro `compiled` hook prepends routes to `.vercel/output/config.json` (Build Output API v3): `continue: true` header routes carrying `Vary`, the discovery `Link` on `/` and the canonical/alternate pair for the prerendered twins, then, per configured pattern, a rewrite on `Accept: text/markdown` and one on the agent User-Agent list. Prerendered pages negotiate at the edge this way, before the CDN cache sees the request, and the table stays O(patterns), never O(pages).

Full q-value precedence is not expressible in a matcher (Vercel runs RE2), so only the outright refusal `text/markdown;q=0` is covered at the edge. The known divergence: the matcher reads `Accept` by substring, so a prerendered page asked for with a low-q `text/markdown` next to a preferred `text/html` is rewritten to markdown, where the origin ranks per RFC 9110 and serves the HTML.

### Other hosts

The Nitro middleware runs everywhere, dev included. Caveat: Nitro serves prerendered files ahead of user handlers, so on a built server an already-prerendered page bypasses the middleware and stays HTML. For prerendered pages behind a generic CDN, negotiate at the edge with the Vercel preset instead, render those routes on demand, and add the `Vary` header for the raw prefix and `/sitemap.md` in that host's own configuration.

### ISR and cached routes

A cached route rule (`isr`, `swr`, `cache`) keys its cache on the path alone and ignores `Vary`, so rewriting a negotiated page there would let its two representations overwrite each other. For any configured pattern overlapping a cached rule (logged at build time), the module redirects to the raw twin instead of answering in place, at the CDN (a 307 instead of a rewrite) and in the middleware both. A rule narrower than the pattern covering it gets its own redirect pair, so only the cached section is affected.

## Contributing

<details>
  <summary>Local development</summary>

  ```bash
  # Install dependencies
  pnpm install

  # Generate type stubs
  pnpm dev:prepare

  # Develop with the playground
  pnpm dev

  # Build the playground
  pnpm dev:build

  # Run ESLint
  pnpm lint

  # Run type checking
  pnpm typecheck

  # Run Vitest
  pnpm test
  pnpm test:watch
  ```

</details>

## License

[MIT](./LICENSE)

<!-- Badges -->
[npm-version-src]: https://img.shields.io/npm/v/nuxt-agent-discovery/latest.svg?style=flat&colorA=020420&colorB=00DC82
[npm-version-href]: https://npmjs.com/package/nuxt-agent-discovery

[npm-downloads-src]: https://img.shields.io/npm/dm/nuxt-agent-discovery.svg?style=flat&colorA=020420&colorB=00DC82
[npm-downloads-href]: https://npmjs.com/package/nuxt-agent-discovery

[license-src]: https://img.shields.io/npm/l/nuxt-agent-discovery.svg?style=flat&colorA=020420&colorB=00DC82
[license-href]: https://npmjs.com/package/nuxt-agent-discovery

[nuxt-src]: https://img.shields.io/badge/Nuxt-020420?logo=nuxt.js
[nuxt-href]: https://nuxt.com
