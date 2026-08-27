import { existsSync } from 'node:fs'
import {
  addImports,
  addTypeTemplate,
  addPrerenderRoutes,
  addServerHandler,
  addServerPlugin,
  createResolver,
  defineNuxtModule,
  hasNuxtModule,
  resolvePath,
  tryResolveModule,
  useLogger
} from '@nuxt/kit'
import { defu } from 'defu'
import { join } from 'pathe'
import { withLeadingSlash, withoutTrailingSlash } from 'ufo'
import { AGENT_USER_AGENTS, EXCLUDE_PREFIXES } from './defaults'
import { isValidRel } from './rels'
import { scanSkills } from './skills'
import { setupVercelPreset } from './presets/vercel'
import { formatLinkHeader, hasFileExtension, matchRoute, patternsOverlap, rawDestination, staticPrefix, MARKDOWN_VARY } from './runtime/shared/negotiation'
import type { AgentRoute, DiscoveryLink, NegotiationConfig, SitemapSections, SkillEntry } from './runtime/shared/types'

export type { AgentContentSource, AgentIndex, AgentListEntry, AgentPage, AgentRoute, AgentSectionSelector, DiscoveryLink, NegotiationConfig, SitemapSections, SkillEntry } from './runtime/shared/types'

/** `@nuxt/content`'s llms nitro plugin, by the path its feature registers. */
const CONTENT_LLMS_PLUGIN = /features[\\/]llms[\\/]runtime[\\/]server[\\/]content-llms\.plugin/

export interface McpServerCardOptions {
  /** MCP endpoint the card describes, e.g. `/mcp`. */
  endpoint: string
  name: string
  title?: string
  description?: string
  /** HTML documentation page for the server. */
  documentation?: string
  repository?: string
  license?: string
  version?: string
  /**
   * Definition groups kept off the public card, by the subdirectory they live
   * in under `server/mcp/tools`. Admin tools behind a bearer token are on the
   * server but are not something to advertise.
   */
  excludeGroups?: string[]
}

export interface ModuleOptions {
  /**
   * Canonical site URL. Left empty, it is resolved per-request from the
   * incoming host, which keeps preview deployments correct.
   */
  siteUrl?: string
  /** Site name, used in `sitemap.md` and markdown error bodies. */
  siteName?: string
  /** Prefix the raw markdown representations are served under. */
  rawPrefix?: string
  /**
   * Content adapter feeding the raw markdown route, `sitemap.md` and the
   * `nuxt-llms` bridge. `'auto'` detects `@nuxt/content`; a path points at a
   * file exporting an `AgentContentSource` (build one for comark with
   * `createComarkSource()` from `#agent-discovery/comark`); `false` disables every
   * content-backed feature and leaves negotiation and discovery running
   * against whatever already serves the raw markdown.
   */
  source?: 'auto' | 'content' | false | string
  /**
   * Page patterns markdown is negotiated for. `*` matches one path segment,
   * `**` one or more, so a locale prefix is one pattern and the generated
   * CDN route table stays O(patterns) in page count.
   */
  routes?: (string | AgentRoute)[]
  excludePrefixes?: {
    /** Extra prefixes on top of the defaults. */
    extend?: string[]
    /** Replaces the default list entirely. */
    replace?: string[]
  }
  userAgents?: {
    /** Extra user agents on top of the defaults. */
    extend?: string[]
    /** Replaces the default list entirely. */
    replace?: string[]
  }
  discovery?: {
    /** Emit the discovery `Link` header on `/`. */
    link?: boolean
    /** Serve `/.well-known/api-catalog` (RFC 9727). */
    apiCatalog?: boolean
    /** Advertise `/sitemap.xml` in the discovery links. */
    sitemapXml?: boolean
    /** Serve `/.well-known/mcp/server-card.json` for the given MCP server. */
    mcpServerCard?: false | McpServerCardOptions
    /** Site-specific discovery links: OpenAPI documents, service docs, ... */
    links?: DiscoveryLink[]
  }
  /** Answer errors with a markdown body when the client asked for markdown. */
  errors?: boolean
  sitemap?: {
    /**
     * Serve `/sitemap.md`, a markdown index of every page. Pass an object to
     * control how pages are grouped into sections.
     */
    markdown?: boolean | Partial<SitemapSections>
  }
  robots?: {
    /**
     * Allow the agent user-agent list in `robots.txt`, through
     * `@nuxtjs/robots` when installed, otherwise through a generated
     * `/robots.txt` (skipped when a static one exists).
     */
    aiPolicy?: boolean
    /** `Content-Signal` line for the wildcard group. `false` to omit. */
    contentSignal?: string | false
  }
  /**
   * Agent Skills served under `/.well-known/skills/`, with a generated
   * `index.json`. `false` to disable; otherwise the directory is scanned and
   * the feature turns itself off when it does not exist.
   */
  skills?: false | {
    /** Directory holding one subdirectory per skill, relative to the root. */
    dir?: string
  }
}

/** What this module puts in `runtimeConfig`. */
interface AgentDiscoveryRuntimeConfig {
  agentDiscovery: NegotiationConfig
  agentDiscoveryMcp?: McpServerCardOptions
  agentDiscoveryRobots?: { contentSignal: string }
  agentDiscoverySkills?: { skills: SkillEntry[] }
}

/** What this module puts in `runtimeConfig.public`. */
interface AgentDiscoveryPublicRuntimeConfig {
  agentDiscovery: { siteUrl: string, siteName: string, rawPrefix: string }
}

declare module '@nuxt/schema' {
  interface NuxtHooks {
    /** Lets other modules add discovery links and agent user agents. */
    'agent-discovery:extend': (registry: { links: DiscoveryLink[], userAgents: string[] }) => void | Promise<void>
  }
  interface RuntimeConfig extends AgentDiscoveryRuntimeConfig {}
  interface PublicRuntimeConfig extends AgentDiscoveryPublicRuntimeConfig {}
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-agent-discovery',
    configKey: 'agentDiscovery',
    compatibility: {
      nuxt: '>=3.0.0'
    }
  },
  /**
   * `@nuxt/content` is optional, so this never installs it: with
   * `optional: true` Nuxt validates the version when the package is there and
   * skips the entry entirely when it is not.
   *
   * Worth declaring because this module reaches into v3 internals rather than a
   * public API, and every one of those failures is silent. It imports
   * `@nuxt/content/server` and `#content/manifest`, resolves `minimark/stringify`
   * out of the installed copy, and removes the llms feature's nitro plugin by
   * matching the path it registers. A major bump moves any of those and the
   * site keeps building, with `llms.txt` quietly carrying duplicate sections.
   *
   * Deliberately duplicates the `peerDependencies` range, which a package
   * manager only warns about: keep the two in step when bumping. Nothing else
   * gets an entry here, because every other integration fails loudly enough
   * that the install-time warning is the right amount of noise.
   */
  moduleDependencies: {
    '@nuxt/content': { version: '^3.0.0', optional: true }
  },
  defaults: {
    siteUrl: '',
    siteName: '',
    rawPrefix: '/raw',
    source: 'auto',
    // Option arrays merge by concatenation, so the routes default is applied
    // in setup instead: a site defining its own patterns replaces it.
    routes: [],
    excludePrefixes: { extend: [] },
    userAgents: { extend: [] },
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
  },
  async setup(options, nuxt) {
    const logger = useLogger('nuxt-agent-discovery')
    const { resolve } = createResolver(import.meta.url)

    // Nuxt generates the `runtimeConfig` type from the site's own resolved
    // config, so a `Record<string, string>` like `sitemapSections.labels` comes
    // back with that site's literal keys and stops accepting the type this
    // module declares. Assign through the module's own shape instead, which
    // still checks every value. Only bites a site with this module linked from
    // source, where its `src` is type-checked along with the app.
    const runtimeConfig = nuxt.options.runtimeConfig as unknown as AgentDiscoveryRuntimeConfig & { public: AgentDiscoveryPublicRuntimeConfig }

    const rawPrefix = withoutTrailingSlash(withLeadingSlash(options.rawPrefix || '/raw'))
    // Normalized, not validated: a pattern without a leading slash can never
    // match a pathname, and silently emitted a prerender entry of
    // `/rawabout.md`. The intent is unambiguous, so there is nothing to warn
    // about.
    const routes: AgentRoute[] = (options.routes?.length ? options.routes : ['/', '/**'])
      .map(route => typeof route === 'string' ? { path: route } : route)
      .map(route => ({ ...route, path: withLeadingSlash(route.path) }))
    // Copied, not aliased. `agent-discovery:extend` lets a site push onto this
    // list, and a `replace` array comes straight from the site's config, which
    // in a monorepo can be one const imported by two apps.
    // `replace` wins, and saying both is the one case here where the intent is
    // genuinely unclear, so it is the one worth a warning.
    for (const [name, option] of [['userAgents', options.userAgents], ['excludePrefixes', options.excludePrefixes]] as const) {
      if (option?.replace && option.extend?.length) {
        logger.warn(`\`${name}\` has both \`replace\` and \`extend\`; \`replace\` wins and the extended entries are dropped.`)
      }
    }

    const userAgents = options.userAgents?.replace
      ? [...options.userAgents.replace]
      : [...AGENT_USER_AGENTS, ...(options.userAgents?.extend || [])]
    // Same shape, same copy, and deduped on top: this list becomes an
    // alternation in the generated CDN lookahead, so a site spelling out a
    // default it also extends would double it there for nothing.
    const excludePrefixes = [...new Set(options.excludePrefixes?.replace
      ? options.excludePrefixes.replace
      : [...EXCLUDE_PREFIXES, ...(options.excludePrefixes?.extend || [])])]

    // Mutated until `modules:done`, then read by the runtime and the presets.
    const config: NegotiationConfig = {
      siteUrl: (options.siteUrl || '').replace(/\/$/, ''),
      siteName: options.siteName || '',
      rawPrefix,
      routes,
      userAgents,
      excludePrefixes,
      links: [],
      linkHeader: options.discovery?.link !== false,
      cachedRoutes: [],
      sitemapSections: {
        expand: (typeof options.sitemap?.markdown === 'object' && options.sitemap.markdown.expand) || [],
        labels: (typeof options.sitemap?.markdown === 'object' && options.sitemap.markdown.labels) || {}
      }
    }

    /* ------------------------------- source ------------------------------- */

    let sourcePath: string | undefined
    let builtinContentSource = false
    let minimarkStringify: string | undefined
    if (options.source === 'content' || (options.source === 'auto' && hasNuxtModule('@nuxt/content'))) {
      sourcePath = resolve('./runtime/server/sources/content')
      builtinContentSource = true
      // `minimark` is the tree format `@nuxt/content` stores and serializes
      // with, not a format this module owns: comark sources render through
      // `comark/render` and custom sources bring their own. So the stringifier
      // has to be the one that produced the tree. Resolved from this module's
      // own dependencies it would pin a version that can disagree with the
      // content backend's, and a major bump changes the markdown of every page
      // (attribute serialization, code-fence meta, ...). Resolve it from
      // `@nuxt/content` instead, so the two can never drift.
      const contentEntry = await tryResolveModule('@nuxt/content', nuxt.options.modulesDir)
      minimarkStringify = contentEntry ? await tryResolveModule('minimark/stringify', [contentEntry]) : undefined
      if (!minimarkStringify) {
        // Points at the cause rather than the symptom: reached with
        // `source: 'content'` on a site that has no `@nuxt/content` at all,
        // where the next failure is an unresolvable `@nuxt/content/server`.
        logger.warn(contentEntry
          ? 'Could not resolve `minimark/stringify` from `@nuxt/content`, so raw markdown may differ from what it produces.'
          : 'The content source is enabled but `@nuxt/content` could not be resolved. Install it, or set `agentDiscovery.source` to a file exporting an `AgentContentSource`.')
      }
    } else if (options.source === 'comark') {
      throw new Error('[nuxt-agent-discovery] comark sites construct their content instance themselves, so pass a source file instead: `source: \'~~/server/utils/agent-source\'`, exporting `createComarkSource(() => getContent())` from `#agent-discovery/comark`.')
    } else if (typeof options.source === 'string' && options.source !== 'auto') {
      sourcePath = await resolvePath(options.source)
    }

    // The MCP server card lists whatever the site's MCP server exposes, which
    // only `@nuxtjs/mcp-toolkit` knows. Detected, never depended on, the same
    // way `@nuxtjs/robots` and `@nuxtjs/sitemap` are. Starts on the stub, and
    // the detection below swaps it.
    const aliases = {
      '#agent-discovery/source': sourcePath || resolve('./runtime/server/sources/none'),
      '#agent-discovery/comark': resolve('./runtime/server/sources/comark'),
      '#agent-discovery/mcp': resolve('./runtime/server/mcp/none'),
      '#agent-discovery': resolve('./runtime/server/utils/agent-discovery')
    }
    nuxt.options.nitro.alias = defu(nuxt.options.nitro.alias, {
      ...(minimarkStringify ? { 'minimark/stringify': minimarkStringify } : {}),
      ...aliases
    })
    // Also aliased app-side, purely so a site whose `tsconfig.json` extends the
    // app config (the common single-tsconfig setup) can typecheck a server
    // route importing `#agent-discovery`. Nitro is what actually resolves it.
    nuxt.options.alias = defu(nuxt.options.alias, aliases)

    // Detection waits for `modules:done` for the same reason the companion
    // modules do: `@nuxtjs/seo`-style declarative `moduleDependencies` are
    // installed after every listed module's `setup()`, so deciding here would
    // read a toolkit installed that way as absent and serve a card listing no
    // tools at all, silently. Nitro resolves the alias table well after this
    // hook, so swapping the entry now still lands.
    nuxt.hook('modules:done', () => {
      // `hasNuxtModule` alone is not enough: the toolkit's own setup returns
      // early when it is disabled or running under `nuxt generate`, registering
      // none of the `#nuxt-mcp-toolkit/*` virtual modules its listing API
      // imports. Aliasing the real re-export in that state fails the Nitro
      // build on an unresolvable id, so the same three conditions are mirrored
      // here.
      // `mcp: false` is how Nuxt disables a module by its config key, and it is
      // not the same as `mcp: { enabled: false }`: optional chaining reads the
      // first as `undefined !== false`, which passed this guard and left the
      // card aliased to a toolkit that registered nothing.
      const mcpOptions = (nuxt.options as { mcp?: false | { enabled?: boolean } }).mcp
      const mcpToolkit = hasNuxtModule('@nuxtjs/mcp-toolkit')
        && mcpOptions !== false
        && mcpOptions?.enabled !== false
        && !nuxt.options.nitro?.static
        && (nuxt.options as { _generate?: boolean })._generate !== true
      if (!mcpToolkit) {
        return
      }

      const definitions = resolve('./runtime/server/mcp/definitions')
      const nitroAlias = nuxt.options.nitro.alias ||= {}
      nitroAlias['#agent-discovery/mcp'] = definitions
      nuxt.options.alias['#agent-discovery/mcp'] = definitions
    })

    /* ------------------------------- handlers ----------------------------- */

    if (sourcePath) {
      addServerHandler({ route: `${rawPrefix}/**`, handler: resolve('./runtime/server/routes/raw') })
      if (options.sitemap?.markdown) {
        addServerHandler({ route: '/sitemap.md', handler: resolve('./runtime/server/routes/sitemap.md') })
      }
    }
    if (options.discovery?.apiCatalog) {
      addServerHandler({ route: '/.well-known/api-catalog', handler: resolve('./runtime/server/routes/api-catalog') })
    }
    if (options.discovery?.mcpServerCard) {
      runtimeConfig.agentDiscoveryMcp = options.discovery.mcpServerCard
      addServerHandler({ route: '/.well-known/mcp/server-card.json', handler: resolve('./runtime/server/routes/mcp-server-card') })
    }

    // `source: false` is a site saying something else already serves the raw
    // markdown, so negotiation still runs against it. `'auto'` resolving to
    // nothing is a site that installed the module and has no adapter: rewriting
    // every page to a prefix nothing serves would answer agents with a 404 on
    // pages that render fine in HTML, which is worse than not installing it.
    const negotiates = Boolean(sourcePath) || options.source === false
    if (!negotiates) {
      logger.warn('No content source resolved, so markdown negotiation is off. Install `@nuxt/content`, point `agentDiscovery.source` at a file exporting an `AgentContentSource`, or set `source: false` if another route already serves the raw markdown.')
    }

    if (negotiates) {
      addServerHandler({ middleware: true, handler: resolve('./runtime/server/middleware/negotiate') })
    }

    nuxt.hook('nitro:config', (nitroConfig) => {
      if (options.errors) {
        const handlers = nitroConfig.errorHandler
          ? (Array.isArray(nitroConfig.errorHandler) ? nitroConfig.errorHandler : [nitroConfig.errorHandler])
          : []
        nitroConfig.errorHandler = [resolve('./runtime/server/error'), ...handlers]
      }
    })

    addImports({ name: 'useCanonical', from: resolve('./runtime/app/composables/useCanonical') })

    // The Nitro runtime hooks, declared where a site's server code can see
    // them. Without this every `nitroApp.hooks.hook('agent-discovery:*')` call
    // needs a cast, which is a poor API to document.
    const hookTypes = addTypeTemplate({
      filename: 'agent-discovery/hooks.d.ts',
      getContents: () => `
import type { H3Event } from 'h3'
import type { AgentIndex } from ${JSON.stringify(resolve('./runtime/shared/types'))}

declare module 'nitropack/types' {
  interface NitroRuntimeHooks {
    /**
     * Transforms a page before the content adapter stringifies it. The second
     * argument is whatever the adapter works on: a minimark tree for
     * \`@nuxt/content\`, the backend's own document elsewhere.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    'agent-discovery:document': (event: H3Event, page: any) => void | Promise<void>
    /**
     * Fills in the generated \`/raw/index.md\`, for a site whose landing page is
     * a Vue page rather than a document. Set \`title\` and \`description\`, which
     * reach the frontmatter, and push markdown blocks onto \`body\`.
     */
    'agent-discovery:index': (event: H3Event, index: AgentIndex) => void | Promise<void>
    /** Enriches the served MCP server card with live tools, resources and prompts. */
    'agent-discovery:mcp-server-card': (event: H3Event, card: Record<string, unknown>) => void | Promise<void>
    /**
     * Adds to \`sitemap.md\` before it is rendered, for the pages a content
     * adapter cannot know about. Keyed by section, in the order they appear.
     */
    'agent-discovery:sitemap': (event: H3Event, sections: Map<string, { title: string, href: string }[]>) => void | Promise<void>
  }
}

export {}
`,
      write: true
    }, { node: true }).dst

    nuxt.options.nitro.typescript = defu(nuxt.options.nitro.typescript, { tsConfig: { include: [hookTypes] } })

    /* ------------------------------- robots ------------------------------- */

    if (options.robots?.aiPolicy) {
      // Feed the shared user-agent list into the robots module instead of
      // competing for the `/robots.txt` route.
      //
      // Registered whether or not `@nuxtjs/robots` is installed, since the
      // hook simply never fires without it. Waiting for detection would be too
      // late: that module calls `robots:config` from its own `modules:done`,
      // which runs before ours whenever it is listed first.
      //
      // Through its hook, not `nuxt.options.robots`: that module reads its
      // options during its own setup, so a site listing it first (which
      // `@nuxtjs/sitemap` asks for) would silently get none of this.
      const contentSignal = options.robots.contentSignal
      const onRobotsConfig = nuxt.hook as unknown as (
        name: 'robots:config',
        cb: (config: { groups: { userAgent: string[], allow: string[], disallow: string[], comment: string[], contentSignal?: string[] }[] }) => void
      ) => void
      onRobotsConfig('robots:config', (robotsConfig) => {
        // `Content-Signal` belongs on the wildcard group, which this module's
        // own `robots.txt` route emits too. Without it the directive would be
        // lost the moment a site adds `@nuxtjs/robots`.
        if (contentSignal) {
          for (const group of robotsConfig.groups) {
            if (group.userAgent.includes('*')) {
              group.contentSignal = [contentSignal]
            }
          }
        }
        robotsConfig.groups.push(...userAgents.map(userAgent => ({
          userAgent: [userAgent],
          allow: ['/'],
          disallow: [],
          comment: []
        })))
      })

      // Whether to serve `/robots.txt` ourselves is decided at `modules:done`,
      // not here: `@nuxtjs/seo` pulls `@nuxtjs/robots` in through Nuxt's
      // declarative `moduleDependencies`, which are installed after this
      // `setup()` runs. `hasNuxtModule` says no at this point, and the handler
      // we would register is dead code behind theirs.
      nuxt.hook('modules:done', () => {
        if (hasNuxtModule('@nuxtjs/robots')) {
          return
        }
        // The name check above covers the modules we know. Anything else
        // serving that route wins it at runtime, and ours would be dead code
        // whose agent groups never reach a crawler, so say so rather than
        // registering it.
        if (nuxt.options.serverHandlers.some(handler => handler.route === '/robots.txt')) {
          logger.warn('Another module already serves `/robots.txt`, so the AI robots policy is not applied to it. Contribute the `agentDiscovery.userAgents` list through that module instead.')
          return
        }
        if (existsSync(join(nuxt.options.rootDir, nuxt.options.dir?.public || 'public', 'robots.txt'))) {
          logger.warn('A static `public/robots.txt` exists, so the AI robots policy is not applied to it. Align its agent list with `agentDiscovery.userAgents` or remove the file.')
          return
        }
        runtimeConfig.agentDiscoveryRobots = { contentSignal: contentSignal || '' }
        addServerHandler({ route: '/robots.txt', handler: resolve('./runtime/server/routes/robots.txt') })
      })
    }

    /* ------------------------------- sitemap ------------------------------ */

    // The raw markdown twins are alternate representations of pages already in
    // the sitemap, not pages of their own, so they must never be listed as
    // separate URLs. Every site that pairs a sitemap module with a raw markdown
    // route needs this, so the module does it rather than leaving each one to
    // remember.
    //
    // Through the module's runtime hook rather than `sitemap.exclude`:
    // `@nuxtjs/sitemap` resolves its options during its own setup and bakes
    // them into a virtual module, so mutating `nuxt.options.sitemap` afterwards
    // does nothing unless the site happens to list this module first. Detection
    // waits for `modules:done` for the `moduleDependencies` reason above.
    nuxt.hook('modules:done', () => {
      if (hasNuxtModule('@nuxtjs/sitemap')) {
        addServerPlugin(resolve('./runtime/server/plugins/sitemap'))
      }
    })

    /* ------------------------------- skills ------------------------------- */

    const skillsDir = join(nuxt.options.rootDir, (options.skills && options.skills.dir) || 'skills')
    const skills: SkillEntry[] = options.skills === false ? [] : await scanSkills(skillsDir, logger)

    if (skills.length) {
      logger.info(`Found ${skills.length} agent skill${skills.length > 1 ? 's' : ''}: ${skills.map(skill => skill.name).join(', ')}`)
      runtimeConfig.agentDiscoverySkills = { skills }

      nuxt.hook('nitro:config', (nitroConfig) => {
        nitroConfig.serverAssets ||= []
        nitroConfig.serverAssets.push({ baseName: 'agentSkills', dir: skillsDir })
      })

      addServerHandler({ route: '/.well-known/skills/index.json', handler: resolve('./runtime/server/routes/skills-index') })
      addServerHandler({ route: '/.well-known/skills/**', handler: resolve('./runtime/server/routes/skills-files') })
      addPrerenderRoutes([
        '/.well-known/skills/index.json',
        ...skills.flatMap(skill => skill.files.map(file => `/.well-known/skills/${skill.name}/${file}`))
      ])
    }

    /* ---------------------------- nuxt-llms bridge ------------------------- */

    const hasLlms = hasNuxtModule('nuxt-llms')
    if (hasLlms && sourcePath) {
      // This module serves the raw markdown route from the adapter, so the
      // route survives a content-backend swap. Works whichever module runs
      // first: `@nuxt/content` normalizes `contentRawMarkdown` into runtime
      // config at `modules:done`, and its handler is dropped below.
      const llmsOptions = nuxt.options as unknown as { llms?: Record<string, unknown> }
      llmsOptions.llms = { ...llmsOptions.llms, contentRawMarkdown: false }
    }

    nuxt.hook('modules:done', async () => {
      // Prerendered documents bake the site URL in, so resolve it from the
      // site config or the llms domain when not set explicitly. Request-time
      // responses still fall back to the incoming host.
      const siteOptions = nuxt.options as { site?: { url?: string, name?: string }, llms?: { domain?: string } }
      if (!config.siteUrl) {
        config.siteUrl = (siteOptions.site?.url || siteOptions.llms?.domain || '').replace(/\/$/, '')
      }
      // Falls back the same way `siteUrl` does, so a site that already told
      // `@nuxtjs/seo` its name does not repeat it here.
      if (!config.siteName) {
        config.siteName = siteOptions.site?.name || ''
      }

      // Every helper here treats `siteUrl` as an origin: `rawUrl()` compares
      // against `new URL(siteUrl).origin`, then concatenates the raw path onto
      // the configured value, so a path would end up in the middle of the URL.
      // Failing at build is better than shipping documents whose every link is
      // silently wrong.
      if (config.siteUrl) {
        // Parsed defensively: `site.url` is commonly written without a scheme,
        // and `new URL('example.com')` throws a bare `Invalid URL` that names
        // neither the option nor this module.
        let parsed: URL | undefined
        try {
          parsed = new URL(config.siteUrl)
        } catch {
          parsed = undefined
        }
        if (!parsed) {
          throw new Error(`[nuxt-agent-discovery] \`siteUrl\` is not a valid URL (${config.siteUrl}). Give it a scheme, as in \`https://example.com\`.`)
        }
        if (parsed.pathname !== '/') {
          throw new Error(`[nuxt-agent-discovery] \`siteUrl\` must be an origin, but it carries a path (${config.siteUrl}). Serving the site under a base path is not supported yet.`)
        }
      }

      // Prerendered documents bake this in, and the prerenderer sends no host
      // header, so an empty value here becomes `http://localhost` in every
      // canonical URL and every absolutized link of the built output.
      if (!config.siteUrl && nuxt.options.nitro.static) {
        logger.warn('No `siteUrl`: set it, or `site.url`, or `llms.domain`. Prerendered documents resolve it from the request, which is `localhost` at build time.')
      }

      if (hasLlms && sourcePath) {
        // `@nuxt/content` installs its llms feature from inside its own setup,
        // so the supported off switch (`nuxt.options['content.llms'] = false`,
        // the literal key its `configKey` declares) is already too late unless
        // this module happens to be listed first. Drop what the feature
        // registered instead, which does not depend on module order:
        //
        // - the raw markdown handler, because this module serves that route
        //   from the adapter so it survives a content-backend swap
        // - the nitro plugin, because it builds `llms.txt` sections and renders
        //   `llms-full.txt` through a second markdown pipeline (`toHast` plus
        //   `@nuxtjs/mdc`), which disagrees with what `/raw/**.md` returns and
        //   has no comark equivalent. Both now come from the adapter.
        //
        // Reversible upstream: gating that `installModule` on `@nuxt/content`'s
        // own `options.llms !== false` would make `content: { llms: false }`
        // work and let all of this go.
        const handlers = nuxt.options.serverHandlers
        for (let i = handlers.length - 1; i >= 0; i--) {
          const handler = handlers[i]!
          if (handler.route === '/raw/**:slug.md' && String(handler.handler).includes('llms')) {
            handlers.splice(i, 1)
          }
        }

        // At `nitro:config` rather than here: `@nuxt/content` does not await
        // that `installModule`, so the plugin is registered by a floating
        // promise with no ordering guarantee against `modules:done`. It has
        // always landed in time in practice, but `nitro:config` fires later and
        // receives the same array, so there is nothing to gain by relying on it.
        nuxt.hook('nitro:config', (nitroConfig) => {
          const plugins = nitroConfig.plugins || []
          const index = plugins.findIndex(plugin => CONTENT_LLMS_PLUGIN.test(String(plugin)))
          if (index !== -1) {
            plugins.splice(index, 1)
            return
          }

          // Only a feature that actually ran must have left a plugin behind. A
          // site setting `nuxt.options['content.llms'] = false` itself, or a
          // future `@nuxt/content` without the feature, is not a problem.
          const feature = (nuxt.options._installedModules || []).find(module => module.meta?.configKey === 'content.llms')
          if (feature && !(feature.meta as { disabled?: boolean } | undefined)?.disabled) {
            logger.warn('`@nuxt/content`\'s llms plugin is installed but could not be found to remove it, so `llms.txt` may come out with duplicate sections. Please report this with the `@nuxt/content` version.')
          }
        })

        addServerPlugin(resolve('./runtime/server/plugins/llms'))
      }

      /* ------------------------------ registry ----------------------------- */

      const links: DiscoveryLink[] = []
      // Advertised only when something serves it. This module does not generate
      // `sitemap.xml`, so keying on the option alone meant a zero-config site
      // pointed agents, the api-catalog and `robots.txt` at a 404. A site that
      // serves its own can register it through `discovery.links`.
      if (options.discovery?.sitemapXml !== false && hasNuxtModule('@nuxtjs/sitemap')) {
        links.push({ href: '/sitemap.xml', rel: 'sitemap', type: 'application/xml', title: 'Sitemap (XML)' })
      }
      if (sourcePath && options.sitemap?.markdown) {
        links.push({ href: '/sitemap.md', rel: 'sitemap', type: 'text/markdown', title: 'Sitemap (Markdown): every page on the site' })
      }
      if (options.discovery?.apiCatalog) {
        links.push({ href: '/.well-known/api-catalog', rel: 'api-catalog', type: 'application/linkset+json', title: 'API catalog: every service document this site publishes' })
      }
      if (options.discovery?.mcpServerCard) {
        const card = options.discovery.mcpServerCard
        const endpoint = card.endpoint.startsWith('/') ? `${config.siteUrl}${card.endpoint}` : card.endpoint
        links.push({ href: '/.well-known/mcp/server-card.json', rel: 'service-desc', type: 'application/json', title: `MCP server card: MCP endpoint at ${endpoint}`, anchor: card.endpoint })
        // The endpoint itself, so an agent reading the resources block or the
        // error body can reach it without fetching the card first.
        links.push({ href: card.endpoint, rel: 'service', title: 'MCP endpoint (streamable HTTP)', header: false })
        if (card.documentation) {
          links.push({ href: card.documentation, rel: 'service-doc', type: 'text/html', anchor: card.endpoint, header: false })
        }
      }
      if (hasLlms) {
        const llms = (nuxt.options as { llms?: { full?: unknown } }).llms
        links.push(
          { href: '/llms.txt', rel: 'describedby', type: 'text/plain', title: 'llms.txt: index of the documentation for LLMs' },
          { href: '/llms.txt', rel: 'service-desc', type: 'text/plain', anchor: '/', header: false }
        )
        if (llms?.full) {
          links.push(
            { href: '/llms-full.txt', rel: 'describedby', type: 'text/plain', title: 'llms-full.txt: the full documentation as a single file' },
            { href: '/llms-full.txt', rel: 'service-desc', type: 'text/plain', anchor: '/', header: false }
          )
        }
      }
      if (skills.length) {
        links.push({ href: '/.well-known/skills/index.json', rel: 'index', type: 'application/json', title: 'Agent skills index: every skill published by this site' })
        // The skills themselves stay out of the `Link` header, which
        // advertises the discovery documents rather than every resource.
        for (const skill of skills) {
          links.push({ href: `/.well-known/skills/${skill.name}/SKILL.md`, rel: 'service-doc', type: 'text/markdown', title: `Agent skill: ${skill.name}`, anchor: '/', header: false })
        }
      }
      if (matchRoute(routes, '/')) {
        links.push({ href: '/', rel: 'alternate', type: 'text/markdown' })
      }
      links.push(...(options.discovery?.links || []))

      await nuxt.callHook('agent-discovery:extend', { links, userAgents })

      for (const link of links) {
        if (!isValidRel(link.rel)) {
          throw new Error(`[nuxt-agent-discovery] \`rel="${link.rel}"\` (${link.href}) is not an IANA-registered link relation. Use a registered rel or an absolute URI extension relation.`)
        }
      }
      // Layer configs concatenate, so a layer and the app both declaring
      // `/llms.txt` would double it in the `Link` header, the api-catalog and
      // every error body. First one wins, which keeps the layer's ordering.
      const seen = new Set<string>()
      config.links.push(...links.filter(link => !seen.has(`${link.rel} ${link.href}`) && seen.add(`${link.rel} ${link.href}`)))

      // `/sitemap.md` is not a page twin: without this a catch-all route
      // pattern rewrites it to `${rawPrefix}/sitemap.md` at the edge and in the
      // middleware, shadowing whatever serves it, and the request 404s.
      //
      // Keyed on the registered link, not on this module owning the route. A
      // site that serves its own `/sitemap.md` with `sitemap.markdown` off and
      // registers it through `discovery.links` needs the exclusion just as
      // much, and was left broken by the narrower check.
      if (config.links.some(link => link.href === '/sitemap.md') && !config.excludePrefixes.includes('/sitemap.md')) {
        config.excludePrefixes.push('/sitemap.md')
      }

      /* ----------------------------- route rules ---------------------------- */

      // Only the `Link` header, and only on `/`. `Vary` used to be written here
      // too, once per configured pattern, which under the default `/**` became
      // a `routeRules` entry matching every path on the site: assets, the API,
      // `/llms.txt`, `/robots.txt`. A route rule cannot express an exclusion,
      // so the header now comes from the negotiation middleware, which already
      // knows exactly which paths have two representations.
      if (config.linkHeader && config.links.length) {
        nuxt.options.routeRules = defu(nuxt.options.routeRules, {
          '/': { headers: { Vary: MARKDOWN_VARY, Link: formatLinkHeader(config.links) } }
        })
      }

      // A cached response cannot vary on Accept/User-Agent, so request-time
      // negotiation is disabled there. The CDN rewrites still cover those
      // pages because they run before the cache.
      for (const [key, rule] of Object.entries(nuxt.options.routeRules || {})) {
        // Every shape Nitro turns into a response cache, read the way Nitro
        // reads it. `isr: 0` and `swr: 0` are not one: the Vercel builder skips
        // a falsy `isr` outright and `normalizeRouteRules` only configures a
        // cache for a truthy `swr`, so no cached asset is ever written. A bare
        // `'cache' in rule` counted `cache: false`, an opt-out, as a cache.
        // `static` is the legacy Vercel spelling that `deprecateSWR` turns into
        // `isr: !static`, so `static: false` is a real ISR route no other key
        // here names; it is inert under `future.nativeSWR`, which errs towards
        // a redirect and is the safe direction.
        const cached = rule && (rule.isr || rule.swr || rule.cache
          || ('static' in rule && !(rule as { static?: boolean | number }).static))
        if (!cached) {
          continue
        }
        // Excluded prefixes never negotiate, so their caches are safe.
        if (config.excludePrefixes.some(prefix => staticPrefix(key).startsWith(prefix)) || staticPrefix(key).startsWith(`${rawPrefix}/`)) {
          continue
        }
        // The question is whether the path negotiates at all, which for an
        // exact rule is `matchRoute`, not `patternsOverlap`: overlap puts
        // every path under a `/` pattern, so a non-page rule like
        // `/llms.txt` joined the list and the CDN gave it a 307 to a
        // `/raw/llms.txt.md` that does not exist. A dotted last segment is an
        // asset either way, the same rule `negotiatedRawPath` applies.
        const negotiable = key.includes('*')
          ? routes.some(route => patternsOverlap(key, route.path))
          : Boolean(matchRoute(routes, key)) && !hasFileExtension(key)
        if (negotiable) {
          config.cachedRoutes.push(key)
          logger.info(`Route rule \`${key}\` has a response cache: request-time markdown negotiation is disabled there, and the CDN routes redirect to the raw markdown instead of rewriting.`)
        }
      }

      /* ---------------------------- runtime config --------------------------- */

      runtimeConfig.agentDiscovery = config
      runtimeConfig.public.agentDiscovery = {
        siteUrl: config.siteUrl,
        siteName: config.siteName,
        rawPrefix
      }
    })

    /* ------------------------------ prerender ------------------------------ */

    if (builtinContentSource) {
      for (const route of routes) {
        if (!route.path.includes('*')) {
          addPrerenderRoutes(rawDestination(config, route, route.path))
        }
      }
      if (options.sitemap?.markdown) {
        addPrerenderRoutes('/sitemap.md')
      }
    }

    /* ------------------------------- presets ------------------------------- */

    if (negotiates) {
      nuxt.hook('nitro:init', (nitro) => {
        setupVercelPreset(nitro, config)
      })
    }
  }
})
