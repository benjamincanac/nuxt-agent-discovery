---
name: migrate-to-agent-discovery
description: Migrate a Nuxt site to the nuxt-agent-discovery module, replacing a hand-rolled markdown negotiation and agent discovery layer (md-rewrite modules, raw markdown routes, api-catalog, sitemap.md, agent robots.txt, llms.txt bridges) with configuration and hooks. Use when adopting the module in a site, or when asked to remove a site's own agent-discovery code.
---

# Migrating a site to nuxt-agent-discovery

Replace a site's hand-rolled agent-discovery layer with the module. The reference migration is [nuxt/ui#6883](https://github.com/nuxt/ui/pull/6883): 350 lines added, 1486 deleted, and everything site-specific kept behind hooks.

Read the module's README first, and `.claude/DESIGN.md` in the module repo when a decision needs the reasoning behind it.

The shape of the work: **configuration replaces routing code, hooks replace site-specific code, everything else gets deleted.** A migration that keeps a file the module owns is not finished, and one that pushes site knowledge into the module is wrong in the other direction.

## What moves and what stays

| Stays in the site | Moves to the module |
|---|---|
| MDC transformers and any content rewriting | `Accept` and User-Agent negotiation |
| The `llms.txt` content: sections, prose, ordering | The CDN route table and the Nitro middleware |
| Site-specific MCP tools | `Vary` and `Link` headers |
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
- **Standalone `.md` documents the site serves itself** (`/design.md` and friends). These need `excludePrefixes` or the rewrites will send them to a raw twin that does not exist.

## Step 2: install

```sh
pnpm add -D nuxt-agent-discovery
```

Add `'nuxt-agent-discovery'` to `modules`. Order does not matter: the module detects `@nuxt/content`, `nuxt-llms`, `@nuxtjs/robots` and `@nuxtjs/sitemap` at `modules:done`.

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
- **`excludePrefixes`** gets every standalone `.md` route and any API surface not already covered by the defaults.
- **`discovery.links`** carries what only the site knows: its OpenAPI document, its docs entry point, recovery links for error bodies (`header: false` keeps them out of the `Link` header). Rels are validated against the IANA registry and an invented one fails the build. Sites migrating off `rel="llms"`, `rel="llms-full"`, `rel="mcp"` or `rel="design"` do not need replacements: `llms.txt` and `llms-full.txt` are pushed into the registry by the module, the MCP endpoint belongs in `discovery.mcpServerCard`, and a design document is `describedby` or `related`.
- **`sitemap.markdown`** takes `expand` and `labels` to control grouping. `expand: ['/docs']` turns one Docs section into one section per area.
- **`skills.dir`** replaces serving a skills directory through `publicAssets`, and generates the index from the files on disk.
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

  // The module serves a static card; only the site knows what its endpoint exposes.
  nitroApp.hooks.hook('agent-discovery:mcp-server-card', async (event, card) => {
    const { tools } = await listMcpDefinitions({ event })
    card.tools = tools.map(t => ({ name: t.name, description: t.description }))
  })

  // Prose for the generated `/raw/index.md`, when the landing page is a Vue page.
  nitroApp.hooks.hook('agent-discovery:index', (event, body) => {
    body.push('...')
  })
})
```

Three helpers replace hand-written equivalents:

- `renderAgentResources(event)` renders the discovery registry as a markdown block, for a hand-written agent homepage.
- `agentDiscoveryOpenApi(event)` returns the discovery layer as OpenAPI fragments. Spread the site's own paths last so they win.
- `rawUrl(event, href)` resolves a page URL to its markdown twin from the same route config, for links the site builds itself inside `llms:generate` hooks.

A site that rewrote its own `llms.txt` links to raw twins can delete that code: the module rewrites every same-origin link. What stays is ordering, prose, and sections.

## Step 6: delete the old layer

| Delete | Replaced by |
|---|---|
| `modules/md-rewrite.ts`, `vercel.json` negotiation routes | the vercel preset in the module |
| `server/utils/markdownNegotiation.ts` and friends | the negotiation core |
| `server/middleware/markdown.ts` | the module's middleware |
| `server/error.ts` plus the `nitro:config` errorHandler chaining in `nuxt.config` | `errors: true` |
| `server/routes/raw/[...slug].md.get.ts` | the module's raw route |
| `server/routes/.well-known/api-catalog.get.ts`, `.well-known/mcp/server-card.json.get.ts` | `discovery.apiCatalog`, `discovery.mcpServerCard` |
| `server/routes/sitemap.md.get.ts` | `sitemap.markdown` |
| `public/robots.txt`, hand-maintained agent lists | `robots.aiPolicy` |
| `skills/index.json`, `publicAssets` entries for skills | `skills.dir` |
| `app/composables/useCanonical.ts` | the module's composable |
| `routeRules` entries setting `Vary` or the discovery `Link` | emitted by the module |
| llms link-rewriting helpers | the llms bridge |

Two that are easy to miss: the `Vary`/`Link` `routeRules` block, which now conflicts with what the module emits, and the `nitro:config` hook chaining the error handler, which the module does itself.

Keep a hand-written `/raw/index.md` handler only when the site wants full control of that document. Otherwise delete it and use the `agent-discovery:index` hook.

## Step 7: verify

Locally first:

```sh
pnpm dev
curl -sS -D - -H 'Accept: text/markdown' http://localhost:3000/docs/... | head -20
curl -sS -D - -A ClaudeBot http://localhost:3000/ | head -20
curl -sS http://localhost:3000/sitemap.md | head
curl -sS http://localhost:3000/.well-known/api-catalog | jq .
curl -sS -A ClaudeBot http://localhost:3000/nope | head
```

Then build, and read the log rather than skimming it. The module warns when a cached route rule overlaps a negotiated pattern, when a static `robots.txt` shadows the generated one, and throws on an invented link rel. Compare the prerendered route count against the old build.

Then deploy a preview and run the `agent-discovery-preview` skill against it. Local checks cannot exercise `Vary`, the `Link` header or the CDN rewrites, which is where the interesting failures live.

## Gotchas

- **Never register `/llms.txt` or `/llms-full.txt`.** The module refuses to, and a site that adds its own collides with `nuxt-llms`.
- `@nuxt/content` installs its llms feature, and therefore `/raw/**:slug.md`, only when `nuxt-llms` is present. The module sets `llms.contentRawMarkdown: false` and takes over both the route and the link rewriting, so the raw route survives a later backend swap.
- On a cached page the module redirects instead of rewriting, and disables request-time negotiation in production. Dev keeps negotiating.
- Off Vercel, Nitro serves prerendered files ahead of user handlers, so a prerendered page stays HTML for agents. Either render those routes on demand or accept that agents reach markdown through the `.md` URL.
- Paths whose last segment is dotted never negotiate, which is what keeps `_payload.json` and images out.
- A markdown document is read detached from its site, so relative links have to be absolutised. The `@nuxt/content` adapter does it; a custom one has to call `absolutizeMarkdownLinks()`.

## Deliverable

One PR per site. The description should say what was deleted, what became configuration, what stayed behind a hook, and which behaviour changed for agents (usually: more user agents honoured, `Vary` now correct, markdown errors, and negotiation working in dev). Link the preview check results.
