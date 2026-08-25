import type { H3Event } from 'h3'

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
  updatedAt?: string
}

/**
 * The content adapter seam. The module never serves raw markdown itself, it
 * routes to whatever implements this.
 */
export interface AgentContentSource {
  /** Site-relative routes of every markdown-representable page. */
  routes: (event?: H3Event) => Promise<string[]>
  /** Resolve one route to its markdown representation, `null` when unknown. */
  get: (route: string, event?: H3Event) => Promise<AgentPage | null>
  /**
   * Optional listing with metadata, used by `sitemap.md` and the `nuxt-llms`
   * bridge so they don't have to call `get()` once per page. Falls back to
   * `routes()` + `get()` when absent.
   */
  list?: (event?: H3Event) => Promise<({ route: string } & Partial<AgentPage>)[]>
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
  /** How `sitemap.md` groups pages into sections. */
  sitemapSections: SitemapSections
  /**
   * Route-rule patterns with a response cache (`isr`, `swr`, `cache`) that
   * cannot vary on `Accept`/`User-Agent`. The Nitro middleware skips
   * negotiation there so a markdown response never poisons the cache; the
   * CDN-level rewrites still apply because they run before the cache.
   */
  cachedRoutes: string[]
}
