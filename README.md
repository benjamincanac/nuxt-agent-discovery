# nuxt-agent-discovery

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![License][license-src]][license-href]
[![Nuxt][nuxt-src]][nuxt-href]

Markdown content negotiation, CDN-level rewrites, and discovery documents for AI agents on Nuxt documentation sites.

## Features

- `Accept` / User-Agent content negotiation with real q-value parsing (RFC 9110 precedence), so `text/plain` and `q=0` are handled correctly and `text/html` outranks markdown when a client prefers it
- Vercel Build Output rewrites so prerendered pages negotiate at the edge, before the CDN cache ever sees the request, with a route table that stays O(patterns), never O(pages)
- A universal Nitro middleware giving the same behavior in dev and on every other host
- Correct `Vary` and `Link` headers, including on responses served straight from the CDN rewrite table
- A raw markdown route driven by a pluggable content adapter: `@nuxt/content` built in, `comark` through a factory, or your own
- A `nuxt-llms` bridge: `/llms.txt` and `/llms-full.txt` stay owned by `nuxt-llms`, this module never registers them, but their links get rewritten to the `/raw` twins and the raw route survives a content-backend swap
- Markdown error bodies with recovery links for agents hitting a 404 or other error
- `/.well-known/api-catalog` (RFC 9727) and an optional MCP server card
- `/sitemap.md`, a markdown index of every page, grouped into sections you control
- Agent Skills served under `/.well-known/skills/`, with the index generated from the directory on disk instead of hand-maintained
- `robots.txt` AI policy generated from the same user-agent list negotiation matches, so the two can't drift apart
- A `useCanonical()` composable for canonical and markdown-alternate `<link>` tags
- An `agent-discovery:extend` hook so other modules can add discovery links and user agents
- Link relations validated against the IANA registry, so an invented `rel="llms"` fails the build

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
- `Vary: Accept, User-Agent` on negotiated routes and on `/`
- a `Link` header on `/` advertising the discovery resources
- `/.well-known/api-catalog`
- `/sitemap.md`
- `/robots.txt` allowing the same agent list (only when no static one exists and `@nuxtjs/robots` isn't installed)
- a markdown body instead of an HTML error page when an agent hits a 404

## How negotiation decides

In this order:

1. An explicit `.md` twin URL is always a markdown request, whatever the headers say.
2. `Accept: text/markdown` with a q-value that `text/html` doesn't outrank (wildcards like `*/*` never count as asking).
3. A known agent User-Agent, matched by substring against the shared list.

Exclusions never negotiate: `/_`, `/api/`, `/mcp`, `/.well-known/`, the raw prefix itself, and any path whose last segment is dotted (assets, `_payload.json`, images).

Errors follow the same idea but browsers are protected: a `fetch()` call of any mode keeps the HTML or JSON error it was written against (`Sec-Fetch-Mode` other than `navigate`), and an explicit `Accept: text/html` or `application/json` is honored. Everything else, curl, an empty `Accept`, a navigation, gets the markdown error body.

## Configuration

```ts
export default defineNuxtConfig({
  agentDiscovery: {
    siteUrl: '',                 // '' resolves per-request / from `site.url` / `llms.domain`
    siteName: '',
    rawPrefix: '/raw',
    source: 'auto',               // 'auto' | 'content' | false | path to an AgentContentSource
    routes: ['/', '/**'],
    excludePrefixes: ['/_', '/api/', '/mcp', '/.well-known/'],
    userAgents: { extend: [] },   // or { replace: [...] }
    discovery: {
      link: true,
      apiCatalog: true,
      sitemapXml: true,
      mcpServerCard: false,
      links: []
    },
    errors: true,
    sitemap: { markdown: true },
    robots: { aiPolicy: true, contentSignal: 'search=yes, ai-train=yes, ai-input=yes' },
    skills: { dir: 'skills' }
  }
})
```

- **`siteUrl`** Canonical site URL, resolved in this order when left empty: the `site.url` module option, then `llms.domain`, then, per request, the incoming host. Prerendered documents bake the URL in, so it's settled once at build time when it can be; request-time responses still fall back to the request origin.
- **`siteName`** Used in `sitemap.md` and markdown error bodies.
- **`rawPrefix`** Where raw markdown representations live. Defaults to `/raw`.
- **`source`** `'auto'` detects `@nuxt/content`. `'content'` forces it. `false` disables every content-backed feature (the raw route, `sitemap.md`, the `nuxt-llms` bridge) and leaves negotiation and discovery running against whatever already serves the raw markdown. Anything else is a path to a file exporting an `AgentContentSource` as its default export, which is how a comark site or a custom backend plugs in (see [Content sources](#content-sources)). `source: 'comark'` throws, pointing you at the factory instead, since comark sites construct their own content instance.
- **`routes`** Page patterns markdown is negotiated for, as strings or `{ path, raw }` objects. `*` matches one path segment, `**` matches one or more, so a locale prefix or an entire nested tree is one pattern and the generated CDN route table stays O(patterns), never O(pages). `raw` overrides the raw destination and is only honored on exact (non-wildcard) patterns, e.g. `{ path: '/', raw: '/raw/index.md' }`; wildcard patterns always resolve to `rawPrefix + path + '.md'`.
- **`excludePrefixes`** Path prefixes that never negotiate and keep their normal JSON/HTML errors. Also add any standalone `.md` document the site serves with its own handler (a `/design.md`, for example): inside a wildcard pattern it would otherwise be rewritten to its `rawPrefix` twin. The module does this itself for `/sitemap.md`.
- **`userAgents.extend`** Extra user agents appended to the defaults (18 agents, from `ai.robots.txt`: ClaudeBot, GPTBot, PerplexityBot, and others, see `src/defaults.ts`). **`userAgents.replace`** replaces the list entirely.
- **`discovery.link`** Emit the discovery `Link` header on `/`.
- **`discovery.apiCatalog`** Serve `/.well-known/api-catalog` (RFC 9727).
- **`discovery.sitemapXml`** Add a `Link` entry pointing at `/sitemap.xml`. This module doesn't generate that file, bring your own sitemap module.
- **`discovery.mcpServerCard`** Given an `McpServerCardOptions` object (`endpoint`, `name`, and optionally `title`, `description`, `documentation`, `repository`, `license`, `version`), serves `/.well-known/mcp/server-card.json`. `false` to disable.
- **`discovery.links`** Site-specific discovery links: OpenAPI documents, service docs, anything else worth advertising. Rels are validated against the IANA registry, an invented one fails the build. Other modules can push into the same list through the `agent-discovery:extend` hook.
- **`errors`** Chains a markdown error handler ahead of any existing Nitro `errorHandler`, answering with a markdown body carrying recovery links when the request prefers it.
- **`sitemap.markdown`** Serve `/sitemap.md`, a markdown index of every page, from the content adapter. Pass an object to control the grouping: `expand` lists path prefixes whose children each get their own section (`['/docs']` turns one "Docs" section into "Components", "Composables", ... while `/blog/**` stays a single "Blog"), and `labels` overrides the heading derived from a segment. Top-level pages share one "Pages" section.
- **`skills`** Agent Skills served under `/.well-known/skills/`. Each subdirectory of `dir` holding a `SKILL.md` with `name` and `description` frontmatter becomes a skill; its files are listed from disk into a generated `/.well-known/skills/index.json`, so the index can never fall behind the files actually served. Names are validated against the Agent Skills spec. `false` to disable; the feature turns itself off when the directory does not exist. Skills are pushed into the discovery registry, so they reach the api-catalog and the error-body recovery links.
- **`robots.aiPolicy`** Feeds the shared user-agent list into `@nuxtjs/robots` when it's installed. Otherwise generates `/robots.txt`, skipped (with a warning) if a static `public/robots.txt` already exists.
- **`robots.contentSignal`** The `Content-Signal` line added to the wildcard group. `false` to omit it.

## Content sources

**`'auto'` / `@nuxt/content`** (default when the module is installed): queries every `type: 'page'` collection with `queryCollection()` and stringifies with `minimark/stringify`, resolved from `@nuxt/content` itself rather than from this module, so the stringifier is always the one that produced the tree. It also drops the `<style>` node syntax highlighters append, which carries per-document CSS variables that mean nothing in markdown. Mirrors the raw markdown route `@nuxt/content` registers itself when `nuxt-llms` is present, including the related links appended from a page's `links` frontmatter, so nothing changes for agents when this module takes over. A site that needs to transform MDC components into plain markdown can hook `agent-discovery:document` before the tree is stringified:

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

**Custom**, any other source file, exporting an `AgentContentSource` as its default export. `defineAgentContentSource()` from `#agent-discovery` is an identity helper for typing it:

```ts
// server/utils/agent-source.ts
import { defineAgentContentSource } from '#agent-discovery'

export default defineAgentContentSource({
  async routes() {
    return ['/']
  },
  async get(route) {
    if (route !== '/') return null
    return { markdown: '# Hello', title: 'Hello' }
  }
})
```

`routes()` lists every markdown-representable route, `get()` resolves one to its markdown. An optional `list()` returns routes with metadata in one call, used by `sitemap.md` and the `nuxt-llms` bridge to avoid a `get()` per page; both fall back to `routes()` + `get()` when it's absent.

## Extending

Two Nitro hooks and one helper let a site contribute what only it knows, without the module depending on its tooling.

**`agent-discovery:mcp-server-card`** enriches the served card with live tools, resources and prompts:

```ts
// server/plugins/agent-discovery.ts
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('agent-discovery:mcp-server-card', async (event, card) => {
    const { tools } = await listMcpDefinitions({ event })
    card.tools = tools.map(tool => ({ name: tool.name, description: tool.description }))
  })
})
```

**`renderAgentResources()`** renders the discovery registry as a markdown block, for sites that hand-write an agent-facing homepage. It is the same list the `Link` header and the api-catalog are built from, so a resource can't be advertised in one place and missed in another:

```ts
import { renderAgentResources } from '#agent-discovery'

export default defineEventHandler(event => `# Docs\n\n${renderAgentResources(event)}`)
```

**`agentDiscoveryOpenApi()`** returns the discovery layer as OpenAPI fragments, for sites publishing an `openapi.json`. These paths are identical across every site running this module by construction, so hand-writing them means restating the route config where it can drift:

```ts
const discovery = agentDiscoveryOpenApi(event)

return {
  openapi: '3.1.0',
  info: { title: 'Example', version },
  tags: [...discovery.tags, ...myTags],
  paths: { ...discovery.paths, ...myPaths },
  components: { ...discovery.components, schemas: { ...discovery.components.schemas, ...mySchemas } }
}
```

Spreading your own values last means any generated path can be replaced with a richer, site-specific description.

**`agent-discovery:document`** transforms a page before it is stringified, covered under [Content sources](#content-sources).

## Companion modules

Detected automatically, never a dependency:

- **`@nuxtjs/robots`** takes over `robots.txt`, and the shared user-agent list is contributed through its `robots:config` hook instead of this module registering a competing route. `robots.contentSignal` rides along on the wildcard group, so the directive survives the handoff.
- **`@nuxtjs/sitemap`** owns `sitemap.xml`, and the raw markdown prefix is added to its `exclude`. The raw twins are alternate representations of pages already in the sitemap, not pages of their own, so listing them separately would be wrong on every site that pairs the two.

## Deployment

### Vercel

On the `vercel` preset (skipped in dev), a Nitro `compiled` hook patches `.vercel/output/config.json` directly, the Build Output API v3, not `vercel.json`, prepending routes ahead of the ones Nitro emits from `routeRules`.

The first route sets `Vary: Accept, User-Agent` across every configured pattern (and its `.md` twin, for exact patterns) with `continue: true`. That flag matters: Nitro emits its own header routes from `routeRules` *after* these rewrites and without `continue`, so without it `Vary` would never reach a request that gets rewritten straight to a prerendered `/raw/**.md` file off the CDN. A `Link` route on `/` carries the same `continue: true` for the same reason, the homepage's own `routeRules` entry never runs once a request is rewritten.

Then, per route pattern, negotiated rewrites: a `has` matcher on `Accept: text/markdown`, another on the agent User-Agent list, each with `check: true` so Vercel looks the destination up on the filesystem first, which is where the prerendered raw files live, before falling through to the origin. The table stays O(route patterns): one set of rewrites per configured pattern, not one per page, however many pages the site has.

### Other hosts

The Nitro middleware runs everywhere, dev included, covering `.md` twin URLs, `Accept: text/markdown`, and known agent User-Agents, and answers unknown pages with a markdown 404. Caveat: Nitro serves prerendered files ahead of user handlers, so on a built server an already-prerendered page is served straight off disk and bypasses the middleware entirely, staying HTML. Only never-prerendered pages and explicit `.md` URLs reach it. For prerendered pages sitting behind a generic CDN, negotiate at the edge with the Vercel preset instead, or render those routes on demand (SSR or serverless) rather than prerendering them.

### ISR and cached routes

A `routeRules` entry with `isr`, `swr`, or `cache` can't vary its response on `Accept` or `User-Agent`, so the middleware auto-disables request-time negotiation for any configured route that overlaps one (logged at build time). The CDN-level rewrites still apply there, since they run before the cache.

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
