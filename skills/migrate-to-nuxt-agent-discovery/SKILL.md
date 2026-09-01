---
name: migrate-to-nuxt-agent-discovery
description: Migrate a Nuxt site to the nuxt-agent-discovery module, replacing a hand-rolled markdown negotiation and agent discovery layer (md-rewrite modules, raw markdown routes, api-catalog, sitemap.md, agent robots.txt, llms.txt bridges, the markdown pipeline under MCP tools) with configuration and hooks. Use when adopting the module in a site, or when asked to remove a site's own agent-discovery code.
---

# Migrating a site to nuxt-agent-discovery

Replace a site's hand-rolled agent-discovery layer with the module. The reference migration is [nuxt/ui#6883](https://github.com/nuxt/ui/pull/6883): a negotiation core, a CDN rewrite module, a request middleware, an error handler and six route handlers deleted, replaced by one config block and one Nitro plugin holding three hooks. Almost every file it touches is a deletion.

Read the module's README first. It is the only document that ships with the package and the only one guaranteed to match the installed version.

The shape of the work: **configuration replaces routing code, hooks replace site-specific code, everything else gets deleted.** A migration that keeps a file the module owns is not finished, and one that pushes site knowledge into the module is wrong in the other direction.

## What moves and what stays

| Stays in the site | Moves to the module |
|---|---|
| MDC transformers and any content rewriting | `Accept` and User-Agent negotiation |
| The `llms.txt` content: sections, prose, ordering | The CDN route table and the Nitro middleware |
| MCP tools: names, descriptions, schemas (Step 6 ports the pipeline under them) | `Vary` and `Link` headers |
| Hand-authored OpenAPI paths | The raw markdown route |
| The content backend itself | Markdown error bodies |
| Page structure and route rules | `.well-known/api-catalog`, the MCP server card, `sitemap.md`, the agent `robots.txt` |

`/llms.txt` and `/llms-full.txt` stay owned by `nuxt-llms` throughout. The module feeds them, never registers them.

## Step 1: survey what the site has

Do this before touching anything, and write the inventory down. It is also the deletion list.

```sh
rg -l 'text/markdown|ClaudeBot|GPTBot|api-catalog|llms|Vary' --glob '!node_modules' --glob '!*.lock'
rg -n 'contentRawMarkdown|llms:generate|content:llms' --glob '!node_modules'
rg -n 'isr|swr|cache' nuxt.config.ts
ls public/robots.txt vercel.json 2>/dev/null
```

Record:

- **Content backend**: `@nuxt/content`, comark, or something else. Decides the `source` option.
- **Deploy target**: Vercel gets edge negotiation, everything else gets the middleware only, where a prerendered page keeps serving HTML to agents.
- **Route rules carrying `isr`, `swr` or `cache`**, and which page patterns they cover. The module detects these and switches those patterns to a 307, but you need to know which pages change behaviour.
- **i18n locales**, which become a wildcard segment in a `routes` pattern rather than one pattern per locale.
- **Companion modules**: `@nuxtjs/robots` and `@nuxtjs/sitemap` take over `robots.txt` and `sitemap.xml`, and the module hands off to them automatically.
- **Every existing agent-facing file**: negotiation utils, an `md-rewrite` module, a raw route, `.well-known` routes, `sitemap.md`, a static `public/robots.txt`, `vercel.json` rewrites, an error handler chained in `nitro:config`, a `useCanonical` composable, skills served from `publicAssets`, and any `index.md` handler.
- **Standalone `.md` documents the site serves itself** (`/design.md` and friends). These need `excludePrefixes.extend` or the rewrites will send them to a raw twin that does not exist.

## Step 2: install

```sh
pnpm add -D nuxt-agent-discovery
```

Install the latest release and check the version that resolved: refuse to migrate a site onto 0.1.2 or older. Those versions hang `/llms.txt` and `/` in dev after the first llms request (an oversized `x-nitro-prerender` header the dev proxy drops silently, so the server logs a 200 while the client times out), lose the markdown error handler to any later-registered module that also prepends a Nitro `errorHandler` (evlog does), and serve excluded prefixes from the raw route that every listing denies. Current releases send the hint header only during prerender, re-sort the handler at `nitro:init`, and answer 404 on the raw route.

Add `'nuxt-agent-discovery'` to `modules`. Order does not matter for anything listed in `modules`, which the module reads directly. `@nuxtjs/robots`, `@nuxtjs/sitemap` and `@nuxtjs/mcp-toolkit` are detected later still, at `modules:done`, so a site getting them through `@nuxtjs/seo` is covered too. `@nuxt/content` and `nuxt-llms` are read during setup, so a content module pulled in as another module's dependency rather than listed is not seen: set `agentDiscovery.source` explicitly if the build warns that no content source resolved.

## Step 3: configure

Start from the site's page structure, not from its page list.

```ts
agentDiscovery: {
  siteUrl: SITE_URL,
  siteName: 'Nuxt UI',
  routes: [
    { path: '/', raw: '/raw/index.md' },
    '/docs/**'
  ]
}
```

- **`routes`** is the decision that matters. One pattern per negotiated tree, `*` for a single segment (a locale), `**` for a subtree. The generated route table is O(patterns), so a site that enumerates pages here has misunderstood the option. Pages outside the patterns keep serving HTML to agents, which is the right answer for marketing pages, pricing, and anything without a markdown representation.
- **`raw`** is only honoured on exact patterns. Use it for `/` when the landing page is a Vue page rather than a document.
- **`excludePrefixes.extend`** gets every standalone `.md` route and any API surface the defaults do not already cover. `replace` is only for dropping a default. An excluded path is not a page anywhere: it never negotiates, no listing includes it, and the raw route answers 404 for it. Server code opts back in per call with `includeExcluded` on `getAgentDocument()` and `listAgentPages()`, nothing else does. State it that way in the PR too, since "only negotiation is affected" is a wrong claim.
- **`discovery.links`** carries what only the site knows: its OpenAPI document, its docs entry point, recovery links for error bodies (`header: false` keeps them out of the `Link` header). Rels are validated against the IANA registry and an invented one fails the build. Sites migrating off `rel="llms"`, `rel="llms-full"`, `rel="mcp"` or `rel="design"` do not need replacements: `llms.txt` and `llms-full.txt` are pushed into the registry by the module, the MCP endpoint belongs in `discovery.mcpServerCard`, and a design document is `describedby` or `related`.
- **`sitemap.markdown`** takes `expand` and `labels` to control grouping. `expand: ['/docs']` turns one Docs section into one section per area.
- **`skills.dir`** replaces serving a skills directory through `publicAssets`, and generates the index from the files on disk.
- **`robots.disallow`** carries the `Disallow` lines a static `public/robots.txt` usually exists for, so the static file can always go. Wildcard group only: the per-agent `Allow` groups deliberately exempt the named agents, so what search engines skip stays reachable for them. A site adopting `@nuxtjs/robots` instead puts its disallows in that module's config, and this one contributes the agent groups and the `Content-Signal` line through `robots:config`, deduplicating the disallows. When `@nuxtjs/robots` arrives, grep the site's utils first: an auto-imported util named `isBot` silently shadows its composable.
- Leave `siteUrl` empty only if the site resolves its canonical URL per request. Prerendered documents bake it in.

## Step 4: pick the content source

- **`@nuxt/content`**: nothing to do, `source: 'auto'` detects it.
- **comark**: write the accessor, since comark sites construct their own content instance. `source: 'comark'` throws on purpose.

```ts
// server/utils/agent-source.ts
import { createComarkSource } from '#agent-discovery/comark'

export default createComarkSource(() => getProdContent())
```

- **Anything else**: a file default-exporting `defineAgentContentSource({ routes, get })`. Implement `list()` too when the backend can return metadata in one call, since `sitemap.md` and the `llms.txt` bridge otherwise fall back to a `get()` per page, and `firstLeaf()` so a section URL redirects to its first document instead of 404ing. A custom adapter rendering straight to markdown must call `absolutizeMarkdownLinks()` itself.

## Step 5: port the site-specific code to hooks

Everything the site knows and the module cannot. This is where a hand-rolled raw route's extras go.

```ts
// server/plugins/agent-discovery.ts
export default defineNitroPlugin((nitroApp) => {
  // The MDC transform the old raw route called itself, now applied to the
  // minimark tree before it is stringified.
  nitroApp.hooks.hook('agent-discovery:document', async (event, page) => {
    await transformMDC(event, page as any)
  })

  // The module already lists what `@nuxtjs/mcp-toolkit` reports. This is for
  // what the toolkit cannot know, and it runs last, so append rather than assign.
  nitroApp.hooks.hook('agent-discovery:mcp-server-card', (event, card) => {
    card.tools = [...(card.tools ?? []), { name: 'external', description: 'Served elsewhere.' }]
  })

  // The generated `/raw/index.md`, when the landing page is a Vue page and the
  // adapter has no `/` entry to read a title and description off.
  nitroApp.hooks.hook('agent-discovery:index', (event, index) => {
    index.title = 'Example'
    index.description = 'What the site is'
    index.body.push('...')
  })
})
```

Three helpers replace hand-written equivalents:

- `renderAgentResources(event)` renders the discovery registry as a markdown block, for a hand-written agent homepage.
- `agentDiscoveryOpenApi(event)` returns the discovery layer as OpenAPI fragments. Spread the site's own paths last so they win.
- `rawUrl(event, href)` resolves a page URL to its markdown twin from the same route config, for links the site builds itself inside `llms:generate` hooks.

A site that rewrote its own `llms.txt` links to raw twins can delete that code: the module rewrites every same-origin link. What stays is ordering, prose, and sections.

## Step 6: port the MCP tools

A site with an MCP server always has a hand-rolled duplicate of the adapter pipeline underneath it: a `fetchPageMarkdown`, a section slicer, a hardcoded site URL, usually in a `server/utils/mcp.ts`. Replace them with the exports from `#agent-discovery` (the README's Agent tooling section) and delete the site util:

- `getAgentDocument(event, path, { sections })` replaces the fetch-and-parse, and returns the exact bytes the raw route serves.
- `listAgentPages(event, { search, prefix })` replaces the hand-written page listing.
- `extractSections(markdown, titles)` replaces the section slicer.
- `getAgentSiteUrl(event)` replaces every hardcoded site URL.

The tools themselves stay in the site. Names, descriptions and schemas are prompt engineering, and the module ships none.

Two wrinkles. A tool that deliberately serves excluded content, say a nightly docs version the site's `excludePrefixes` hides, needs `includeExcluded: true` on both `getAgentDocument()` and `listAgentPages()`, since both skip excluded prefixes by default. And a listing over a dimension the adapter does not model, versions for instance, that must include excluded pages can keep its `queryCollection` for the listing while still reading every document through `getAgentDocument()`.

## Step 7: delete the old layer

| Delete | Replaced by |
|---|---|
| `modules/md-rewrite.ts`, `vercel.json` negotiation routes | the vercel preset in the module |
| `server/utils/markdownNegotiation.ts` and friends | the negotiation core |
| `server/middleware/markdown.ts` | the module's middleware |
| `server/error.ts` plus the `nitro:config` errorHandler chaining in `nuxt.config` | `errors: true` |
| `server/routes/raw/[...slug].md.get.ts` | the module's raw route |
| `server/routes/raw/index.md.get.ts` | `agent-discovery:index` |
| `server/routes/.well-known/api-catalog.get.ts`, `.well-known/mcp/server-card.json.get.ts` | `discovery.apiCatalog`, `discovery.mcpServerCard` |
| `server/routes/sitemap.md.get.ts` | `sitemap.markdown` |
| `public/robots.txt` with its `Disallow` lines, hand-maintained agent lists | `robots.aiPolicy` and `robots.disallow` |
| `skills/index.json`, `publicAssets` entries for skills | `skills.dir` |
| `app/composables/useCanonical.ts` | the module's composable |
| `routeRules` entries setting `Vary` or the discovery `Link` | emitted by the module |
| llms link-rewriting helpers | the llms bridge |
| the markdown pipeline under MCP tools (`server/utils/mcp.ts` and friends) | `getAgentDocument()`, `listAgentPages()`, `extractSections()`, `getAgentSiteUrl()` |

Two that are easy to miss: the `Vary`/`Link` `routeRules` block, which now conflicts with what the module emits, and the `nitro:config` hook chaining the error handler, which the module does itself.

Keep a hand-written `/raw/index.md` handler only when the site wants full control of that document. Otherwise delete it and use the `agent-discovery:index` hook.

## Adopting `@nuxtjs/sitemap` in the same PR

A migration often replaces a hand-rolled `sitemap.xml` route at the same time. The raw twins are dropped from the sitemap by this module's exclude either way, but two `@nuxtjs/sitemap` traps bite hard on exactly the sites this skill targets:

- **Never set `routeRules['/sitemap.xml'] = { prerender: true }`.** During prerender `@nuxtjs/sitemap` resolves its own route against the canonical site URL and ingests the live production sitemap, so every deploy ships a copy of the previous one. The proof on a bitten site: the build artifact is a strict subset of production's entries, old changefreq values included.
- **The `nuxt:prerender` app source lists every prerendered page.** On a versioned docs site that means legacy and nightly versions and unversioned redirect stubs all land in the sitemap. Set `excludeAppSources: true`, point `sitemap.sources` at a small server route querying the content collections, and list the handful of Vue-only pages in `urls`. Content stays the single source of truth.

## Step 8: verify

Locally first:

```sh
pnpm dev
curl -sS -D - -H 'Accept: text/markdown' http://localhost:3000/docs/... | head -20
curl -sS -D - -A ClaudeBot http://localhost:3000/ | head -20
curl -sS http://localhost:3000/sitemap.md | head
curl -sS http://localhost:3000/.well-known/api-catalog | jq .
curl -sS -A ClaudeBot http://localhost:3000/nope | head
```

Then build, and read the log rather than skimming it. The module logs at info when a cached route rule covers a negotiated pattern, so grep for `response cache` rather than for warnings. It warns when no content source resolves, when a static `robots.txt` shadows the generated one, and when `extend` and `replace` are both set, and it throws on an invented link rel or a `siteUrl` carrying a path. Compare the prerendered route count against the old build.

Stale state fakes results at every stage here, three ways. Nuxt's build cache can keep serving a server route whose file was deleted: clear `node_modules/.cache/nuxt` after deleting route files, and remember a CDN's build cache restores it on preview deploys. A built server persists cached functions under `.data` between boots: wipe it, knowing a `@nuxthub` site needs `.data/db` back before it boots. And before trusting any curl against a locally booted `.output/server`, check the PID actually listening on the port (`lsof -iTCP:<port>`): a zombie server from a previous build answers every probe and never sees an on-disk edit.

Then deploy a preview and run the `verify-nuxt-agent-discovery` skill against it. Local checks cannot exercise `Vary`, the `Link` header or the CDN rewrites, which is where the interesting failures live.

## Gotchas

- **Never register `/llms.txt` or `/llms-full.txt`.** The module refuses to, and a site that adds its own collides with `nuxt-llms`.
- `@nuxt/content` installs its llms feature, and therefore `/raw/**:slug.md`, only when `nuxt-llms` is present. The module sets `llms.contentRawMarkdown: false` and takes over both the route and the link rewriting, so the raw route survives a later backend swap.
- On a cached page the module redirects instead of rewriting, and disables request-time negotiation in production. Dev keeps negotiating.
- Off Vercel, Nitro serves prerendered files ahead of user handlers, so a prerendered page stays HTML for agents. Either render those routes on demand or accept that agents reach markdown through the `.md` URL.
- Paths whose last segment is dotted never negotiate, which is what keeps `_payload.json` and images out.
- A markdown document is read detached from its site, so relative links have to be absolutised. The `@nuxt/content` adapter does it; a custom one has to call `absolutizeMarkdownLinks()`.

## Deliverable

One PR per site. The description should say what was deleted, what became configuration, what stayed behind a hook, and which behaviour changed for agents (usually: more user agents honoured, `Vary` now correct, markdown errors, and negotiation working in dev). Link the preview check results.
