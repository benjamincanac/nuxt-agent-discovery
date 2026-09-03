import type { H3Event } from 'h3'

// Mirrored by the `agent-discovery/hooks.d.ts` template in `module.ts`, which is
// what a consuming site sees. Keep the two in step.
declare module 'nitropack/types' {
  interface NitroRuntimeHooks {
    /**
     * Transforms a page before the content adapter stringifies it. `page` is the
     * backend's own document, a minimark tree for `@nuxt/content`, so it is `any`.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    'agent-discovery:document': (event: H3Event, page: any) => void | Promise<void>
    /**
     * Fills in the generated `/raw/index.md`. Set `title` and `description`, which
     * reach the frontmatter, and push markdown blocks onto `body`.
     */
    'agent-discovery:index': (event: H3Event, index: AgentIndex) => void | Promise<void>
    /** Enriches the served MCP server card with live tools, resources and prompts. */
    'agent-discovery:mcp-server-card': (event: H3Event, card: Record<string, unknown>) => void | Promise<void>
    /**
     * Adds to `sitemap.md` before it is rendered, in section order. Keys are the
     * raw path segment a section groups, before `sitemapSections.labels` applies.
     */
    'agent-discovery:sitemap': (event: H3Event, sections: Map<string, { title: string, href: string }[]>) => void | Promise<void>
  }
}

/**
 * A page pattern the module negotiates markdown for. `path` accepts `*` (one
 * segment) and `**` (one or more), so the route table stays O(patterns).
 */
export interface AgentRoute {
  path: string
  /**
   * Explicit raw markdown destination, for an exact path whose `.md` twin is not
   * `path + '.md'` (`{ path: '/', raw: '/raw/index.md' }`). Defaults to
   * `rawPrefix + path + '.md'`.
   */
  raw?: string
}

/**
 * A discovery resource, emitted in the `Link` header on `/`, the
 * `.well-known/api-catalog` linkset, markdown error bodies and the resources block.
 */
export interface DiscoveryLink {
  /** Site-relative (`/llms.txt`) or absolute href. */
  href: string
  /** IANA-registered relation, or an absolute URI for an extension relation per RFC 8288. Invented rels fail the build. */
  rel: string
  type?: string
  /** Human/agent readable label, used in error bodies and resource listings. */
  title?: string
  /** Anchor for the api-catalog linkset (RFC 9727). Only `service-desc` and `service-doc` links carrying one reach it. */
  anchor?: string
  /** Whether the link is emitted in the `Link` header on `/`. Default `true`. */
  header?: boolean
}

/** How `sitemap.md` groups pages into sections. */
export interface SitemapSections {
  /** Path prefixes whose children each get their own section. `['/docs']` splits "Docs" into "Components", "Composables". */
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
  /** Last modification date. Adapters may supply it, nothing reads it yet. */
  updatedAt?: string
}

/**
 * The generated `/raw/index.md`, handed to `agent-discovery:index` for a site
 * whose landing page is a Vue page. `title` arrives pre-filled from `siteName`
 * or the host, and anything the hook leaves alone is dropped from frontmatter.
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
  /** Group this page belongs to, the `llms.txt` section title when the site declares none. `sitemap.md` groups by path. */
  section?: string
}

/**
 * A `llms.sections` entry, handed to `list()` verbatim. Each adapter picks out
 * the keys it declares and returns `null` for a selector that isn't its own.
 */
export type AgentSectionSelector = Record<string, unknown>

/** The content adapter seam. The module never serves raw markdown itself, it routes to whatever implements this. */
export interface AgentContentSource {
  /**
   * Every markdown-representable page. With a `selector`, a `llms.sections` entry
   * handed over verbatim, return only the pages it names, or `null` when it is not
   * one this adapter understands. Left out, every listing comes out empty.
   */
  list?: (selector: AgentSectionSelector | undefined, event: H3Event) => Promise<AgentListEntry[] | null>
  /** Resolve one route to its markdown representation, `null` when unknown. */
  get: (route: string, event: H3Event) => Promise<AgentPage | null>
  /** The first page under a section path, for a URL naming a directory. The raw route redirects to that page's twin. */
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
   * Whether the discovery `Link` header is emitted on `/`. Carried here because
   * the deploy presets emit that header themselves and only see this config.
   */
  linkHeader: boolean
  /** How `sitemap.md` groups pages into sections. */
  sitemapSections: SitemapSections
  /**
   * Route-rule patterns with a response cache (`isr`, `swr`, `cache`) that cannot
   * vary on `Accept`/`User-Agent`. The Nitro middleware skips negotiation there so
   * a markdown response never poisons the cache. CDN rewrites run first and apply.
   */
  cachedRoutes: string[]
  /**
   * Whether a negotiated page answers 406 to an `Accept` that allows neither of
   * its representations. Off unless the site asks for it, since it breaks any
   * client sending a narrow `Accept` it did not mean.
   */
  notAcceptable: boolean
  /**
   * Route patterns of the handlers the site serves under the raw prefix itself,
   * as Nitro registers them (`/raw/:name.md`). Prerendering and crawler hints skip
   * a twin one of them matches, so a twin backed by live data is never frozen.
   */
  ownRawRoutes?: string[]
  /**
   * Whether the deployed CDN route table injects the canonical/alternate `Link`
   * pair on the raw markdown twins. The raw handler skips its own copy where the
   * table covers the URL, or the pair goes out twice.
   */
  cdnLinkPairs?: boolean
}
