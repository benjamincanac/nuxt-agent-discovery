# nuxt-agent-discovery

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![License][license-src]][license-href]
[![Nuxt][nuxt-src]][nuxt-href]

Markdown content negotiation, CDN-level rewrites, and discovery documents for AI agents on Nuxt documentation sites.

## Features

- `Accept` / User-Agent content negotiation with real q-value parsing (RFC 9110 precedence), so `q=0` is a refusal and `text/html` outranks markdown when a client prefers it
- Vercel Build Output routes so pages negotiate at the edge, before the CDN cache ever sees the request, with a route table that stays O(patterns), never O(pages): a rewrite where the page is prerendered, a 307 where a response cache would key on the path alone
- A universal Nitro middleware giving the same behavior in dev and on every other host
- Correct `Vary` and `Link` headers, on both halves of a negotiated page and on responses served straight from the CDN rewrite table
- A raw markdown route driven by a pluggable content adapter: `@nuxt/content` built in, `comark` through a factory, or your own
- A `nuxt-llms` bridge: `/llms.txt` and `/llms-full.txt` stay owned by `nuxt-llms`, this module never registers them, but their sections, links and full document all come from the content adapter, so a page reads the same whichever backend serves it and whichever URL an agent fetches it from
- Markdown error bodies with recovery links for agents hitting a 404 or other error
- `/.well-known/api-catalog` (RFC 9727) and an optional MCP server card, which lists what the site's MCP server actually exposes when it runs `@nuxtjs/mcp-toolkit`
- `listAgentPages()`, `getAgentDocument()` and `extractSections()`, the three pieces an MCP docs tool is built from, so a site's tools return exactly what its raw markdown URLs do
- `/sitemap.md`, a markdown index of every page, grouped into sections you control
- A generated `/raw/index.md` for sites whose landing page is a Vue page rather than a document, built from the discovery registry
- Agent Skills served under `/.well-known/skills/`, with the index generated from the directory on disk instead of hand-maintained
- `robots.txt` AI policy generated from the same user-agent list negotiation matches, so the two can't drift apart
- A `useCanonical()` composable for canonical and markdown-alternate `<link>` tags, and a `rawUrl()` helper resolving a page URL to its markdown twin from the same route config
- An `agent-discovery:extend` hook so other modules can add discovery links and user agents
- Link relations validated against the IANA registry, plus `sitemap`, which every crawler understands and nothing has registered, so an invented `rel="llms"` fails the build

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

Zero-config works when `@nuxt/content` and `nuxt-llms` are already installed: the content source is auto-detected and every page (`/**`) negotiates markdown.

What you get out of the box:

- `/raw/**.md`, the raw markdown route, served from whichever content source is detected
- `Accept: text/markdown` or an explicit `<path>.md` URL returns markdown for any negotiated route; a known agent User-Agent (ClaudeBot, GPTBot, PerplexityBot, ...) gets markdown without an `Accept` header
- `Vary: Accept, User-Agent` on both halves of a negotiated page: the HTML one, and the markdown one it rewrites or redirects to. A `.md` twin, `/raw/**` and `/sitemap.md` answer markdown to every client, but they are where a negotiated page sends one, so they carry the header too. Assets, the API surface and the other discovery documents never do
- a `Link` header on `/` advertising the discovery resources
- `/.well-known/api-catalog`
- `/sitemap.md`
- `/robots.txt` allowing the same agent list (only when no static one exists and `@nuxtjs/robots` isn't installed)
- a markdown body instead of an HTML error page when an agent hits a 404

## How negotiation decides

In this order:

1. An explicit `.md` twin URL is always a markdown request, whatever the headers say.
2. `Accept: text/markdown` with a q-value that `text/html` doesn't outrank. A wildcard on its own never counts as asking, so `*/*` and `text/*` keep HTML.
3. `Accept` refusing `text/html` outright while a wildcard permits markdown, as in `text/html;q=0, */*`. The client ruled out the only other representation there is, so HTML would hand it the one thing it said it couldn't read. Narrow by construction: a browser and a `fetch()` both rate HTML through their own wildcard, so neither ever lands here.
4. A known agent User-Agent, matched by substring against the shared list.

Exclusions never negotiate: `/_`, `/api/`, `/mcp`, `/.well-known/`, the raw prefix itself, and any path whose last segment is dotted (assets, `_payload.json`, images).

Errors follow the same idea but browsers are protected: a `fetch()` call of any mode keeps the HTML or JSON error it was written against (`Sec-Fetch-Mode` other than `navigate`), and an explicit `Accept: text/html` or `application/json` is honored unless the client is a known agent, which outranks it. Everything else, curl, an empty `Accept`, a navigation, gets the markdown error body.

An `Accept` that allows neither representation gets the HTML page anyway, unless the site turns on [strict content negotiation](#strict-content-negotiation).

### Strict content negotiation

A negotiated page has exactly two representations, HTML and markdown, so an `Accept` allowing neither is a 406 per RFC 9110. `notAcceptable: true` makes the module answer one, at the origin and at the Vercel edge both.

It's off by default because the strictly correct answer breaks clients that send a narrow `Accept` without meaning it, and a page that used to render turning into an error is a bad trade for a site that isn't chasing the RFC. Turn it on knowing that:

- browsers (`*/*;q=0.8`) and `fetch()` (`*/*`) rate both representations through the wildcard and are never refused
- a navigation (`Sec-Fetch-Mode: navigate`) and a known agent User-Agent are never refused either, the same protections the markdown error bodies have
- `Accept: text/markdown;q=0` on its own is a 406, on the same reading that makes `Accept: application/xml` one: a quality of zero is a refusal, and refusing both leaves nothing to send
- an `Accept` carrying no media range at all is ignored rather than refused, so a proxy mangling the header can't take a page down
- the body lists the two representations, in whichever format the client's error rules resolve to: markdown for an agent or curl, JSON for a browser `fetch()`

Only the pages negotiate, so only the pages can refuse them all. A `.md` twin, `/raw/**`, the assets and the discovery documents have one representation each and are served whatever the header says.

At the edge the guards are Build Output matchers rather than the q-value ranking, so a representation offered and then refused at `q=0` still reads as offered there and the page is served where the origin would answer 406. That's the same known divergence the `text/markdown;q=0` rewrite matcher has, in the same fail-safe direction.

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
      sitemapXml: true,               // only when `@nuxtjs/sitemap` is installed
      mcpServerCard: false,
      links: []
    },
    errors: true,
    notAcceptable: false,
    sitemap: { markdown: true },
    robots: { aiPolicy: true, contentSignal: 'search=yes, ai-train=yes, ai-input=yes' },
    skills: { dir: 'skills' }
  }
})
```

- **`siteUrl`** Canonical site URL, resolved in this order when left empty: the `site.url` module option, then `llms.domain`, then, per request, the incoming host. Prerendered documents bake the URL in, so it's settled once at build time when it can be; request-time responses still fall back to the request origin.
- **`siteName`** Used in `sitemap.md` and the generated `/raw/index.md`. Falls back to the `site.name` module option, the same way `siteUrl` falls back to `site.url`.
- **`rawPrefix`** Where raw markdown representations live. Defaults to `/raw`.
- **`source`** `'auto'` detects `@nuxt/content`. `'content'` forces it. `false` disables every content-backed feature (the raw route, `sitemap.md`, the `nuxt-llms` bridge) and leaves negotiation and discovery running against whatever already serves the raw markdown. Anything else is a path to a file exporting an `AgentContentSource` as its default export, which is how a comark site or a custom backend plugs in (see [Content sources](#content-sources)). `source: 'comark'` throws, pointing you at the factory instead, since comark sites construct their own content instance.
- **`routes`** Page patterns markdown is negotiated for, as strings or `{ path, raw }` objects. `*` matches one path segment, `**` matches one or more, so a locale prefix or an entire nested tree is one pattern and the generated CDN route table stays O(patterns), never O(pages). `raw` overrides the raw destination and is only honored on exact (non-wildcard) patterns, e.g. `{ path: '/', raw: '/raw/index.md' }`; wildcard patterns always resolve to `rawPrefix + path + '.md'`.
- **`excludePrefixes.extend`** Extra path prefixes on top of the defaults (`/_`, `/api/`, `/mcp`, `/.well-known/`). Excluded paths never negotiate and keep their normal JSON/HTML errors. Add any standalone `.md` document the site serves with its own handler (a `/design.md`, for example): inside a wildcard pattern it would otherwise be rewritten to its `rawPrefix` twin. The module does this itself for `/sitemap.md` whenever that link is registered, whether it serves the route or the site does through `discovery.links`. **`excludePrefixes.replace`** replaces the list entirely, which is how a default gets dropped.
- **`userAgents.extend`** Extra user agents appended to the defaults (18 agents, from `ai.robots.txt`: ClaudeBot, GPTBot, PerplexityBot, and others, see `src/defaults.ts`). **`userAgents.replace`** replaces the list entirely.
- **`discovery.link`** Emit the discovery `Link` header on `/`.
- **`discovery.apiCatalog`** Serve `/.well-known/api-catalog` (RFC 9727).
- **`discovery.sitemapXml`** Advertise `/sitemap.xml` in the discovery links, which also puts the `Sitemap:` line in the generated `robots.txt`. On by default but only when `@nuxtjs/sitemap` is installed, since this module doesn't generate that file and pointing agents at a 404 is worse than saying nothing. A site serving its own registers it through `discovery.links`.
- **`discovery.mcpServerCard`** Given an `McpServerCardOptions` object (`endpoint`, `name`, and optionally `title`, `description`, `documentation`, `repository`, `license`, `version`), serves `/.well-known/mcp/server-card.json`. `false` to disable.
- **`discovery.links`** Site-specific discovery links: OpenAPI documents, service docs, anything else worth advertising. Rels are validated against the IANA registry, an invented one fails the build. Other modules can push into the same list through the `agent-discovery:extend` hook.
- **`errors`** Chains a markdown error handler ahead of any existing Nitro `errorHandler`, answering with a markdown body carrying recovery links when the request prefers it.
- **`notAcceptable`** Answer a negotiated page with 406 when the request's `Accept` allows neither of its two representations, which is what RFC 9110 asks for. Off by default, and worth reading [Strict content negotiation](#strict-content-negotiation) before turning it on.
- **`sitemap.markdown`** Serve `/sitemap.md`, a markdown index of every page, from the content adapter. Anything under `excludePrefixes` is left out, which is how a site keeps a legacy docs version out of the index and out of negotiation with one setting, and `agent-discovery:sitemap` is where a site adds the pages an adapter cannot know about. Pass an object to control the grouping: `expand` lists path prefixes whose children each get their own section (`['/docs']` turns one "Docs" section into "Components", "Composables", ... while `/blog/**` stays a single "Blog"), and `labels` overrides the heading derived from a segment. Top-level pages share one "Pages" section.
- **`skills`** Agent Skills served under `/.well-known/skills/`. Each subdirectory of `dir` holding a `SKILL.md` with a `description` in its frontmatter becomes a skill, taking its name from the directory unless the frontmatter sets one; its files are listed from disk into a generated `/.well-known/skills/index.json`, so the index can never fall behind the files actually served. Names are validated against the Agent Skills spec. `false` to disable; the feature turns itself off when the directory does not exist. Skills are pushed into the discovery registry, so they reach the api-catalog and the error-body recovery links.
- **`robots.aiPolicy`** Feeds the shared user-agent list into `@nuxtjs/robots` when it's installed. Otherwise generates `/robots.txt`, skipped (with a warning) if a static `public/robots.txt` already exists.
- **`robots.contentSignal`** The `Content-Signal` line added to the wildcard group. `false` to omit it.

## Routes

| Route | Registered when |
| --- | --- |
| `/raw/**.md` | a content source resolves, under whatever `rawPrefix` is set to |
| `/sitemap.md` | a content source resolves and `sitemap.markdown` is on |
| `/.well-known/api-catalog` | `discovery.apiCatalog` |
| `/.well-known/mcp/server-card.json` | `discovery.mcpServerCard` is an object |
| `/.well-known/skills/index.json` and `/.well-known/skills/**` | at least one valid skill is found |
| `/robots.txt` | `robots.aiPolicy`, and neither `@nuxtjs/robots` nor a static `public/robots.txt` |

`/llms.txt` and `/llms-full.txt` are not in there, and there's no option to add them. They belong to `nuxt-llms`, which every site already configures, so a second module claiming the route would be last-write-wins with no detection.

With the built-in `@nuxt/content` source, the raw twin of every exact route pattern and `/sitemap.md` are prerendered. Skill files are prerendered whatever the source. With `nuxt-llms` installed, the bridge also hands Nitro's crawler every twin that `llms.txt` links, on any source, so those are prerendered too. A twin that nothing links and no exact pattern names is rendered per request.

### The raw route

`/raw/**.md` answers `text/markdown; charset=utf-8`, with `Vary: Accept, User-Agent` and a `Link` header carrying the page's `rel="canonical"` and its `rel="alternate"; type="text/html"`. The body opens on frontmatter:

```md
---
title: "Getting Started"
description: "Install the module and negotiate a first page."
canonical_url: "https://example.com/docs/getting-started"
---
```

`canonical_url` is always there. `title` and `description` are left out when the page has none, rather than emitted empty, since an empty key reads as a value the page set to nothing on purpose.

Then the page markdown, with every same-origin link absolutized. When `/sitemap.md` is served, a `## Sitemap` section is appended pointing at it.

`Vary` is on every response here, the 302 below included, even though this URL answers markdown to every client. It's where a negotiated page sends one: on a cached pattern the CDN answers `Accept: text/markdown` with a 307, so this is the response the client keeps and the one a shared cache stores. Without the header on it, whatever follows the hop lands on a URL with two representations behind it and nothing saying so. `/sitemap.md` carries it for the same reason.

A path naming a section rather than a page, `/raw/docs.md` where there is no `docs` index document, redirects 302 to the section's first document when the adapter implements `firstLeaf()`. Anything else missing answers a real 404, so an agent can tell an unknown URL from an empty one. The body is the markdown error, reporting the page path the client asked for rather than the raw one.

`/` is the exception. With no `/` entry in the adapter, `/raw/index.md` falls through to a generated landing page instead of 404ing, see [`agent-discovery:index`](#extending).

## Content sources

**`'auto'` / `@nuxt/content`** (default when the module is installed): queries every `type: 'page'` collection with `queryCollection()` and stringifies with `minimark/stringify`, resolved from `@nuxt/content` itself rather than from this module, so the stringifier is always the one that produced the tree. It also drops the `<style>` node syntax highlighters append, which carries per-document CSS variables that mean nothing in markdown. A document whose body doesn't open on an `h1` gets one from its `title`, with the `description` as a blockquote under it. Mirrors the raw markdown route `@nuxt/content` registers itself when `nuxt-llms` is present, including the related links appended from a page's `links` frontmatter, so nothing changes for agents when this module takes over. A site that needs to transform MDC components into plain markdown can hook `agent-discovery:document` before the tree is stringified:

```ts
// server/plugins/agent-discovery.ts
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('agent-discovery:document', async (event, page) => {
    // mutate page.body.value (a minimark tree) in place
  })
})
```

**comark**, via `createComarkSource()`, with `comark` installed. comark sites construct their own content instance (its sources, plugins, cache and, in production, the commit it is pinned to), so there is none the module could build for you. Pass an accessor:

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

It produces the same document the `@nuxt/content` adapter does for prose, which is what makes swapping backend close to a one-file change. Same rendering format, the `# title` / `> description` lead added only when the body doesn't already open on an `h1`, the related links from `links` frontmatter appended the same way, site-relative links absolutized on the tree, and a highlighter's `<style>` node dropped rather than rendered (comark declares `removeLastStyle` and doesn't implement it). `test/e2e/shared.ts` holds all three adapters to the same expected bytes.

**Components are the exception.** comark and minimark serialize a component block with different blank lines around its children, so `::callout` renders as `<callout type="warning">\nCareful.\n</callout>` through comark and `<callout type="warning">\n\nCareful.\n\n\n\n</callout>` through `@nuxt/content`. The content is the same and both parse the same; only the whitespace differs, and it compounds when components nest. Diff a page carrying components before pointing a comark site at this, rather than taking the prose equivalence as covering it. `test/unit/comark.test.ts` pins the current difference so a change in either stringifier shows up here rather than during a migration.

`agent-discovery:document` fires here too. The `page` it receives is comark's own `ContentFile`, so a transformer mutates `page.nodes` rather than `page.body.value`.

**Custom**, any other source file, exporting an `AgentContentSource` as its default export. `defineAgentContentSource()` from `#agent-discovery` is an identity helper for typing it:

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

`list()` returns every markdown-representable page, `get()` resolves one to its markdown. Both take the request event as their last argument, which is how they reach the site URL and whatever request-scoped state the backend needs.

- **`list(selector, event)`** is what `sitemap.md`, `listAgentPages()` and the `nuxt-llms` bridge read, so it is worth returning the metadata you already have: a `title` and `description` per entry, and a `section` label that becomes the section title in `llms.txt` when the site declares no sections of its own. With a `selector`, a `llms.sections` entry handed over verbatim, return only the pages it names, or `null` when the selector isn't one you understand.
- **`firstLeaf(route, event)`** is optional. It returns the first page under a section path, so a URL naming a directory rather than a page (`/raw/getting-started.md` with no index document) redirects to its first document instead of 404ing, the same as the HTML page does.

Site-relative links are absolutized for you. A markdown document is read detached from the site it came from, so a relative href in it points nowhere; the module rewrites whatever `get()` returns, leaving fenced blocks and inline code spans alone. The built-in adapters also rewrite their document tree before rendering, which is how they catch the links inside MDC component props, and running both is harmless because the pass only touches a destination that is still relative.

### llms.txt sections

The module removes `@nuxt/content`'s llms feature and generates `llms.txt` from the adapter instead. That feature rendered `llms-full.txt` through a second markdown pipeline (`toHast` plus `@nuxtjs/mdc`) which disagreed with what `/raw/**.md` returned for the same page, forced sites to register their MDC transform on two different hooks, and had no equivalent for any other backend. Sections and documents both come from `source.list()` and `source.get()` now.

Existing `llms.sections` config keeps working: each section is handed to the adapter, which reads the keys it declares.

- `@nuxt/content`: `contentCollection` and `contentFilters`, the two keys the removed feature owned
- comark: `navigation`, a navigation path whose subtree the section lists
- custom adapters: whatever they choose to recognise

A section that already carries its own `links` is left alone, and every same-origin link, hand-written or resolved, is rewritten to its `/raw/**.md` twin. Declare no sections at all and pages are grouped by the `section` label the adapter returns.

A section whose selector no adapter recognises, and that has no description of its own, is dropped rather than left as a dangling heading, which is what config that outlived a backend swap turns into. When nothing links `/`, an `Overview` section pointing at the landing page goes in first, since a site whose homepage is a Vue page has no `/` entry to resolve.

#### Request-time backends

`nuxt-llms` prerenders `/llms.txt` and `/llms-full.txt` unconditionally, so on a backend that resolves content per request (comark reading from GitHub, a CMS) both documents are frozen at build time and go stale when the content moves without a redeploy. That is [nuxt-llms#24](https://github.com/nuxtlabs/nuxt-llms/issues/24). Until it lands, opt the two routes out yourself:

```ts
export default defineNuxtConfig({
  nitro: {
    prerender: {
      ignore: ['/llms.txt', '/llms-full.txt']
    }
  }
})
```

A `routeRules` entry of `{ prerender: false }` on both routes does the same thing. Reach for `ignore` when the site is ISR end to end and has no prerendering to speak of, and for the route rule when you want to pair it with a cache.

The module doesn't do this for you: it would turn both documents dynamic for every custom source, including the ones whose content is as static as `@nuxt/content`'s.

## Extending

A few Nitro hooks and helpers let a site contribute what only it knows, without the module depending on its tooling.

**`agent-discovery:mcp-server-card`** adds to the served card. With `@nuxtjs/mcp-toolkit` installed the module already fills in `capabilities` and lists the server's tools, resources and prompts, so this is for what the toolkit can't know. The hook runs last, so assigning to `card.tools` replaces that list rather than adding to it:

```ts
// server/plugins/agent-discovery.ts
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('agent-discovery:mcp-server-card', (event, card) => {
    card.tools = [...(card.tools ?? []), { name: 'external', description: 'Served elsewhere.' }]
  })
})
```

Tools in a group the card shouldn't advertise, `server/mcp/tools/admin/*.ts`, are left out. `discovery.mcpServerCard.excludeGroups` adds to that list rather than replacing it, so naming your own private group keeps `admin` excluded.

**`renderAgentResources()`** renders the discovery registry as a markdown block, for sites that hand-write an agent-facing homepage. It is the same list the `Link` header and the api-catalog are built from, so a resource can't be advertised in one place and missed in another. Pass `{ heading }` to change the default `## Resources for Agents` title:

```ts
import { renderAgentResources } from '#agent-discovery'

export default defineEventHandler(event => `# Docs\n\n${renderAgentResources(event)}`)
```

**`agentDiscoveryOpenApi()`** returns the discovery layer as OpenAPI fragments, for sites publishing an `openapi.json`. These paths are identical across every site running this module by construction, so hand-writing them means restating the route config where it can drift:

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

Covered are the negotiated page patterns and their raw twins, plus every discovery document the site actually serves: `/sitemap.md`, `/sitemap.xml`, `/llms.txt`, `/llms-full.txt`, the api-catalog, the skills index, and, where `discovery.mcpServerCard` declares one, both the server card and the MCP endpoint itself as a JSON-RPC `post`. What earns a path is being in the discovery registry, not being a route this module serves, which is why the sitemap, the llms documents and the MCP endpoint are all in there.

Every operation carries an `operationId`, since that is what client generators turn into a method name. The namespace, so a site knows which names are taken before it picks its own:

| Operation | `operationId` |
| --- | --- |
| A page pattern | `get<PascalRoute>`, and `get<PascalRoute>Markdown` for its raw twin. `/` gives `getHomepage`, a wildcard pattern ends in `Page`, so `/docs/**` gives `getDocsPage` and a locale wildcard in front of it gives `getSegmentDocsPage` |
| `/sitemap.md`, `/sitemap.xml` | `getSitemapMarkdown`, `getSitemapXml` |
| `/llms.txt`, `/llms-full.txt` | `getLlmsTxt`, `getLlmsFullTxt` |
| `/.well-known/api-catalog` | `getApiCatalog` |
| `/.well-known/mcp/server-card.json`, the MCP endpoint | `getMcpServerCard`, `callMcpServer` |
| `/.well-known/skills/index.json` | `getSkillsIndex` |

A page pattern's id only moves when the pattern does, and a discovery document's is the same on every site running this module.

Pass the `paths` you are merging these into, as above, and every `operationId` in them is claimed before one is derived here, so your own operation keeps its name and the generated one takes a numeric suffix. Without it the two namespaces are decided independently and a duplicate is only caught by a linter, if you run one. `reserved: [...]` does the same for a document assembled where the call cannot see it. The order is yours first, then the discovery documents, then the page patterns.

Spreading your own values last means any generated path can be replaced with a richer, site-specific description. That is where anything only the site knows belongs, a custom header its MCP endpoint reads, for instance.

**`agent-discovery:index`** fills in the generated `/raw/index.md`. When the content adapter has no `/` entry, because the landing page is a Vue page rather than a document, the module serves a markdown landing page built from the discovery registry: frontmatter, canonical and alternate links, and the resources block. The hook is where the site adds what only it knows:

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

`title` arrives pre-filled from `siteName` (or the host), `description` starts empty, and anything the hook leaves alone is left out of the frontmatter rather than emitted as `""`. There is no page to read either off in this branch, which is the whole reason it exists: the metadata of a Vue landing page lives wherever the site keeps it.

**`rawUrl()`** resolves a page URL to its markdown twin, through the same route config the CDN rewrites, the middleware and the `llms.txt` bridge resolve. Paths that don't negotiate come back untouched, everything comes back absolute, and the query string is carried over. A site hand-rolling this drifts the moment `routes` changes: a hardcoded `/docs/` prefix keeps rewriting after the config has moved on.

```ts
import { rawUrl } from '#agent-discovery'

rawUrl(event, '/docs/getting-started') // https://example.com/raw/docs/getting-started.md
rawUrl(event, '/compare?tools=a,b')    // https://example.com/raw/compare.md?tools=a,b
```

The same entry point exports `getAgentSiteUrl(event)`, the configured `siteUrl` falling back to the request origin, and `useAgentDiscoveryConfig(event)` for the resolved module config.

**`useCanonical()`** is the app-side half. It adds a `rel="canonical"` link for the current route, and a `rel="alternate"; type="text/markdown"` one when you pass it a markdown path. The raw route sets the same pair as a `Link` header on its own responses.

```vue
<script setup lang="ts">
const route = useRoute()

useCanonical(() => `${route.path}.md`)
</script>
```

**`agent-discovery:sitemap`** adds to `/sitemap.md` before it renders. The content adapter only knows the pages it holds, so a hand-written route, a Vue-rendered showcase or a design document has no other way into the index an agent reads first. Sections are keyed by their heading, in order:

```ts
// server/plugins/agent-discovery.ts
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('agent-discovery:sitemap', (event, sections) => {
    sections.set('Design', [{ title: 'Design system', href: 'https://example.com/design.md' }])
  })
})
```

**`agent-discovery:document`** transforms a page before it is stringified, covered under [Content sources](#content-sources).

## Agent tooling

Sites running an MCP server all write the same three pieces underneath their tools: list the pages, read one page's markdown, narrow it to a section. Doing that against `queryCollection()` ties the tool to one content backend, and re-deriving the raw URL drifts from the CDN rewrites the first time `rawPrefix` or `routes` changes. All three are exported from `#agent-discovery`, backed by the same content adapter and the same route config as everything else.

The module ships no tools of its own. Descriptions are prompt engineering each site tunes, and tool names collide.

```ts
// server/mcp/tools/list-pages.ts
import { listAgentPages } from '#agent-discovery'

export default defineMcpTool({
  description: 'List the documentation pages.',
  inputSchema: { search: z.string().optional() },
  handler: async ({ search }) => listAgentPages(useEvent(), { search })
})
```

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

- **`listAgentPages(event, { search, prefix })`** returns every page with its title, description, section, page URL and raw markdown URL, skipping anything under `excludePrefixes`. `search` keeps pages matching every whitespace-separated term across title, path and description.
- **`getAgentDocument(event, route, { sections })`** returns the exact bytes `/raw/<route>.md` serves, frontmatter and sitemap footer included, resolved in-process. `null` for a route with no markdown, `{ redirect }` for one that names a section rather than a page. Sites do this today by `$fetch`ing their own raw route from inside a serverless function.
- **`extractSections(markdown, titles)`** narrows a document to the `##` sections named, keeping the frontmatter, title and description. Falls back to the whole document when none of them match, since handing back a title alone just makes the agent ask again.

## Companion modules

Detected automatically, never a dependency. Detection happens at `modules:done`, so a site that gets them through `@nuxtjs/seo` rather than listing them itself is covered too: that module installs both through Nuxt's declarative `moduleDependencies`, which land after every listed module's `setup()`.

- **`@nuxtjs/robots`** takes over `robots.txt`, and the shared user-agent list is contributed through its `robots:config` hook instead of this module registering a competing route. `robots.contentSignal` rides along on the wildcard group, so the directive survives the handoff.
- **`@nuxtjs/mcp-toolkit`** owns `/mcp` and the tools. The MCP server card reads what it exposes through `listMcpDefinitions()`, so the card can't advertise a tool the server dropped. Skipped when the toolkit is disabled or running under `nuxt generate`, where it registers nothing to read.
- **`@nuxtjs/sitemap`** owns `sitemap.xml`, and the raw markdown twins are dropped from every sitemap it builds through its `sitemap:input` hook. They are alternate representations of pages already listed, not pages of their own, so listing them separately would be wrong on every site that pairs the two.

## Deployment

### Vercel

On the `vercel` preset (skipped in dev), a Nitro `compiled` hook patches `.vercel/output/config.json` directly, the Build Output API v3, not `vercel.json`, prepending routes ahead of the ones Nitro emits from `routeRules`.

The first route sets `Vary: Accept, User-Agent` across every configured pattern with `continue: true`. That flag matters: Nitro emits its own header routes from `routeRules` *after* these rewrites and without `continue`, so without it `Vary` would never reach a request that gets rewritten straight to a prerendered `/raw/**.md` file off the CDN. It skips anything with a dotted last segment, which keeps it off `/llms.txt`, `/robots.txt`, `/sitemap.xml` and everything in `public/`: those answer the same bytes to every client, and a shared cache keyed per user-agent on them is close to no caching at all.

The second labels the markdown representations that route deliberately leaves out: everything under the raw prefix, the `.md` twins and `/sitemap.md`. Their handlers set the header themselves, but a prerendered file is answered off the filesystem and never reaches one, which is the whole reason this is a CDN route. A `Link` route on `/` carries the same `continue: true` for the same reason, the homepage's own `routeRules` entry never runs once a request is rewritten.

With [`notAcceptable`](#strict-content-negotiation) on, a 406 route follows them, carrying the middleware's guards as `has`/`missing` matchers.

Then, per route pattern, two negotiated routes: a `has` matcher on `Accept: text/markdown` and another on the agent User-Agent list. What they do depends on whether the pattern is cached:

- **Uncached pattern**: a rewrite, with `check: true` so Vercel looks the destination up on the filesystem first, which is where the prerendered raw files live, before falling through to the origin. The page URL is preserved, which is the point of doing this at the CDN rather than redirecting. Where the twin is not prerendered the request reaches the origin with its original path, so the Nitro middleware makes the call.
- **Cached pattern** (see [ISR and cached routes](#isr-and-cached-routes)): a 307 to the raw twin, carrying `Vary` itself.

The explicit `.md` twin stays a rewrite either way: that URL only ever serves markdown, so it has no second variant to worry about.

The `Accept` route also carries a `missing` matcher for `text/markdown;q=0`, so a client that explicitly refuses markdown gets HTML from the edge like it does from the origin. Full q-value precedence is not expressible in a matcher: Vercel runs RE2, which has no lookahead, so `Accept: text/markdown;q=0.1, text/html;q=0.9` is a known divergence. The Nitro middleware ranks those per RFC 9110 and returns HTML, while the edge rewrite still sends markdown. Only the outright refusal (`q=0`) is covered.

`Accept: text/html;q=0, */*` is the same kind of divergence the other way. The matcher looks for a literal `text/markdown` range and there isn't one, so the edge serves HTML while the origin serves markdown. Expressing it would take a second route pair per pattern to test the refusal and the wildcard separately, which is a real cost to the table for a header almost nothing sends.

The table stays O(route patterns): one set of routes per configured pattern, not one per page, however many pages the site has.

### Other hosts

The Nitro middleware runs everywhere, dev included, covering `.md` twin URLs, `Accept: text/markdown`, and known agent User-Agents, and answers unknown pages with a markdown 404. Caveat: Nitro serves prerendered files ahead of user handlers, so on a built server an already-prerendered page is served straight off disk and bypasses the middleware entirely, staying HTML. Only never-prerendered pages and explicit `.md` URLs reach it. For prerendered pages sitting behind a generic CDN, negotiate at the edge with the Vercel preset instead, or render those routes on demand (SSR or serverless) rather than prerendering them.

The same caveat applies to the headers the route handlers set. With the `@nuxt/content` source, `/sitemap.md` and the raw twin of every exact pattern are prerendered, so off Vercel they're served off disk without `Vary`. The Vercel preset labels them at the edge; anywhere else, add the header for the raw prefix and `/sitemap.md` in that host's own configuration.

### ISR and cached routes

A `routeRules` entry with `isr`, `swr`, or `cache` can't vary its response on `Accept` or `User-Agent`: the cache is keyed on the request path alone and ignores `Vary`. Rewriting such a page would let its HTML and markdown variants overwrite each other under the same key, and the next visitor gets whichever landed last.

So for any configured pattern overlapping a cached route rule (logged at build time), the module:

- redirects rather than answering in place in the Nitro middleware, in production. Dev has no response cache, and a site that caches every page would otherwise never negotiate locally
- emits a 307 to the raw twin at the CDN instead of a rewrite, so each URL keeps a single variant and the client resolves the twin before any cache lookup

A rule narrower than the pattern covering it, `routeRules['/docs/**']` under the default `/**`, gets its own redirect pair emitted ahead of that pattern's rewrite, so only the cached section is affected and the rest of the site keeps URL-preserving rewrites. Both strategies come out of the same detection, so a route rule added later moves the routes it covers on its own.

The Nitro middleware applies the same rule off Vercel: on a cached route it redirects rather than answering in place, except for an explicit `.md` URL, which has one variant and is served normally.

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
