import type { H3Event } from 'h3'

// Mirrored by the `agent-discovery/hooks.d.ts` template in `module.ts`, which
// is what a consuming site sees. This copy is what type-checks the module's own
// source; keep the two in step.
declare module 'nitropack/types' {
  interface NitroRuntimeHooks {
    /**
     * Transforms a page before the content adapter stringifies it. `page` is
     * whatever the adapter works on, a minimark tree for `@nuxt/content` and
     * the backend's own document elsewhere, so it is deliberately `any`: this
     * module cannot know the shape, and a site should not have to cast to
     * hand it to its own transformer.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    'agent-discovery:document': (event: H3Event, page: any) => void | Promise<void>
    /**
     * Fills in the generated `/raw/index.md`, for a site whose landing page is
     * a Vue page rather than a document. Set `title` and `description`, which
     * reach the frontmatter, and push markdown blocks onto `body`.
     */
    'agent-discovery:index': (event: H3Event, index: AgentIndex) => void | Promise<void>
    /** Enriches the served MCP server card with live tools, resources and prompts. */
    'agent-discovery:mcp-server-card': (event: H3Event, card: Record<string, unknown>) => void | Promise<void>
    /**
     * Adds to `sitemap.md` before it is rendered. The map is keyed by section,
     * in the order the sections appear.
     */
    'agent-discovery:sitemap': (event: H3Event, sections: Map<string, { title: string, href: string }[]>) => void | Promise<void>
  }
}

/**
 * A page pattern the module negotiates markdown for.
 *
 * `path` accepts `*` (one segment) and `**` (one or more segments), so a
 * locale prefix is one wildcard segment in a single pattern and the generated
 * route table stays O(patterns), never O(pages).
 */
export interface AgentRoute {
  path: string
  /**
   * Explicit raw markdown destination, required for exact paths whose `.md`
   * twin is not `path + '.md'` (the homepage: `{ path: '/', raw: '/raw/index.md' }`).
   * Defaults to `rawPrefix + path + '.md'`.
   */
  raw?: string
}

/**
 * A discovery resource, declared once and emitted everywhere: the `Link`
 * header on `/`, the `.well-known/api-catalog` linkset, the recovery links in
 * markdown error bodies and the "Resources for Agents" block.
 */
export interface DiscoveryLink {
  /** Site-relative (`/llms.txt`) or absolute href. */
  href: string
  /**
   * IANA-registered link relation (or an absolute URI for an extension
   * relation, per RFC 8288). Invented rels like `llms` fail the build.
   */
  rel: string
  type?: string
  /** Human/agent readable label, used in error bodies and resource listings. */
  title?: string
  /**
   * Anchor for the api-catalog linkset (RFC 9727), site-relative or absolute.
   * Only `service-desc` and `service-doc` links carrying an anchor are grouped
   * into the catalog.
   */
  anchor?: string
  /** Whether the link is emitted in the `Link` header on `/`. Default `true`. */
  header?: boolean
}

/** How `sitemap.md` groups pages into sections. */
export interface SitemapSections {
  /**
   * Path prefixes whose children each get their own section, instead of the
   * whole prefix being one. `['/docs']` turns a single "Docs" section into
   * "Components", "Composables", ... while `/blog/**` stays one "Blog".
   */
  expand: string[]
  /** Label overrides, keyed by the path segment the section groups. */
  labels: Record<string, string>
}

/** One Agent Skill published by the site, as listed in the skills index. */
export interface SkillEntry {
  name: string
  description: string
  /** Files the skill is made of, relative to its directory. `SKILL.md` first. */
  files: string[]
}

/** What a content adapter returns for one route. */
export interface AgentPage {
  markdown: string
  title?: string
  description?: string
  /**
   * Last modification date. Adapters may supply it, and sites do, but nothing
   * in the module reads it yet; it is reserved for freshness signals such as
   * a sitemap `lastmod`.
   */
  updatedAt?: string
}

/**
 * The generated `/raw/index.md`, handed to `agent-discovery:index` for a site
 * whose landing page is a Vue page rather than a document.
 *
 * `title` arrives pre-filled from `siteName` (or the host), and everything the
 * hook leaves alone is dropped from the frontmatter rather than emitted empty.
 * The metadata for a landing page like this lives wherever the site keeps it,
 * which is why the module cannot read it itself.
 */
export interface AgentIndex {
  /** Frontmatter `title`, and the document's `# ` heading. */
  title: string
  /** Frontmatter `description`, and the blockquote under the heading. */
  description?: string
  /** Markdown blocks between the heading and the resources list. */
  body: string[]
}

/** One page in a listing: the route plus whatever metadata is cheap to read. */
export interface AgentListEntry extends Partial<AgentPage> {
  route: string
  /**
   * Group this page belongs to, used as the section title in `llms.txt` when
   * the site declares no sections of its own. Adapters that have a natural
   * grouping set it: the navigation tree for comark, the collection for
   * `@nuxt/content`. `sitemap.md` does not read it, it groups by path segment
   * through `sitemapSections`.
   */
  section?: string
}

/**
 * A `llms.sections` entry, handed to `list()` verbatim. The module never reads
 * it: `contentCollection`/`contentFilters` mean something to the `@nuxt/content`
 * adapter and nothing to the others, so each adapter picks out the keys it
 * declares and returns `null` for a selector that isn't its own.
 */
export type AgentSectionSelector = Record<string, unknown>

/**
 * The content adapter seam. The module never serves raw markdown itself, it
 * routes to whatever implements this.
 */
export interface AgentContentSource {
  /**
   * Every markdown-representable page, with whatever metadata the backend has.
   * `sitemap.md`, the `nuxt-llms` bridge and `listAgentPages()` all read it.
   *
   * With a `selector`, a `llms.sections` entry handed over verbatim, return
   * only the pages it names, or `null` when the selector is not one this
   * adapter understands.
   *
   * Optional, for a backend that can resolve a route but cannot enumerate its
   * pages. Every listing then comes out empty: `/sitemap.md` and the `llms.txt`
   * bridge list nothing, while the documents `get()` resolves keep working.
   */
  list?: (selector: AgentSectionSelector | undefined, event: H3Event) => Promise<AgentListEntry[] | null>
  /** Resolve one route to its markdown representation, `null` when unknown. */
  get: (route: string, event: H3Event) => Promise<AgentPage | null>
  /**
   * Optional: the first page under a section path, for a URL that names a
   * directory rather than a page (`/getting-started` with no `index`). The raw
   * route redirects to its markdown twin, mirroring what the HTML page does.
   */
  firstLeaf?: (route: string, event: H3Event) => Promise<string | null>
}

/** Normalized module state shared by build-time presets and the Nitro runtime. */
export interface NegotiationConfig {
  /** Canonical site URL. Empty string means: resolve per-request. */
  siteUrl: string
  siteName: string
  rawPrefix: string
  routes: AgentRoute[]
  userAgents: string[]
  /** Path prefixes that never negotiate and keep their JSON/HTML errors. */
  excludePrefixes: string[]
  links: DiscoveryLink[]
  /**
   * Whether the discovery `Link` header is emitted on `/`. Carried here rather
   * than read off the module options, because the deploy presets emit that
   * header themselves and only ever see this config.
   */
  linkHeader: boolean
  /** How `sitemap.md` groups pages into sections. */
  sitemapSections: SitemapSections
  /**
   * Route-rule patterns with a response cache (`isr`, `swr`, `cache`) that
   * cannot vary on `Accept`/`User-Agent`. The Nitro middleware skips
   * negotiation there so a markdown response never poisons the cache; the
   * CDN-level rewrites still apply because they run before the cache.
   */
  cachedRoutes: string[]
  /**
   * Whether a negotiated page answers 406 to an `Accept` that allows neither
   * of its two representations. Off unless the site asks for it: the strictly
   * correct answer breaks any client sending a narrow `Accept` it did not mean.
   */
  notAcceptable: boolean
}
