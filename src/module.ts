import { existsSync, readdirSync, statSync } from 'node:fs'
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
  useLogger
} from '@nuxt/kit'
import { defu } from 'defu'
import { join } from 'pathe'
import { withLeadingSlash, withoutTrailingSlash } from 'ufo'
import { AGENT_USER_AGENTS, EXCLUDE_PREFIXES } from './defaults'
import { mcpExcludedGroups } from './runtime/shared/defaults'
import { SKILLS_INDEX, SKILLS_PREFIX } from './runtime/shared/paths'
import { isValidRel } from './rels'
import { scanSkills } from './skills'
import { disableContentRawMarkdown, dropContentLlmsFeature, resolveContentSource } from './build/content'
import { setupVercelPreset } from './presets/vercel'
import { formatLinkHeader, hasFileExtension, isRawPath, matchRoute, normalizePathname, patternsOverlap, rawDestination, siteServesRaw, staticPrefix, MARKDOWN_VARY } from './runtime/shared/negotiation'
import type { Nuxt } from '@nuxt/schema'
import type { ModuleHooks as RobotsModuleHooks } from '@nuxtjs/robots'
import type { AgentRoute, DiscoveryLink, NegotiationConfig, SitemapSections, SkillEntry } from './runtime/shared/types'

export type { AgentContentSource, AgentIndex, AgentListEntry, AgentPage, AgentRoute, AgentSectionSelector, DiscoveryLink, NegotiationConfig, SitemapSections, SkillEntry } from './runtime/shared/types'

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
   * Definition groups kept off the public card, by subdirectory under
   * `server/mcp/tools`. Extends the default (`admin`) rather than replacing it.
   */
  excludeGroups?: string[]
}

export interface ModuleOptions {
  /** Canonical site URL. Resolved from the request host when empty. */
  siteUrl?: string
  /** Site name, used in `sitemap.md` and markdown error bodies. */
  siteName?: string
  /** Prefix the raw markdown representations are served under. */
  rawPrefix?: string
  /**
   * Content adapter feeding the raw markdown route, `sitemap.md` and the
   * `nuxt-llms` bridge. `'auto'` detects `@nuxt/content`, a path points at a
   * file exporting an `AgentContentSource`, `false` disables every
   * content-backed feature and leaves negotiation running against whatever
   * already serves the raw markdown.
   */
  source?: 'auto' | 'content' | false | string
  /** Page patterns markdown is negotiated for. `*` matches one segment, `**` one or more. */
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
  /**
   * Answer a negotiated page with 406 when its `Accept` allows neither
   * representation (RFC 9110). Off by default: a client sending a narrow
   * `Accept` it did not mean would get an error instead of a page.
   */
  notAcceptable?: boolean
  sitemap?: {
    /** Serve `/sitemap.md`. Pass an object to control how pages are grouped into sections. */
    markdown?: boolean | Partial<SitemapSections>
  }
  robots?: {
    /**
     * Allow the agent user-agent list in `robots.txt`, through `@nuxtjs/robots`
     * when installed, otherwise through a generated `/robots.txt`.
     */
    aiPolicy?: boolean
    /** `Content-Signal` line for the wildcard group. `false` to omit. */
    contentSignal?: string | false
    /**
     * `Disallow` lines for the wildcard group. The per-agent `Allow` groups
     * exempt the listed agents from them.
     */
    disallow?: string[]
  }
  /**
   * Agent Skills served under `/.well-known/skills/` with a generated
   * `index.json`. Off when the directory does not exist.
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
  agentDiscoveryRobots?: { contentSignal: string, disallow: string[] }
  agentDiscoverySkills?: { skills: SkillEntry[] }
}

/** What this module puts in `runtimeConfig.public`. */
interface AgentDiscoveryPublicRuntimeConfig {
  agentDiscovery: { siteUrl: string, siteName: string, rawPrefix: string }
}

declare module '@nuxt/schema' {
  interface NuxtHooks {
    /**
     * Lets other modules add discovery links and agent user agents. Fires once,
     * possibly early from the `robots:config` pass of `@nuxtjs/robots`, so
     * register the listener during `setup()` and push onto `links` rather than
     * reading from it.
     */
    'agent-discovery:extend': (registry: { links: DiscoveryLink[], userAgents: string[] }) => void | Promise<void>
  }
  interface RuntimeConfig extends AgentDiscoveryRuntimeConfig {}
  interface PublicRuntimeConfig extends AgentDiscoveryPublicRuntimeConfig {}
}

/**
 * Installed and not disabled. The companion modules return early from `setup()`
 * on `{ enabled: false }`, and `<configKey>: false` disables a module too.
 */
function hasActiveNuxtModule(nuxt: Nuxt, name: string, configKey: string): boolean {
  if (!hasNuxtModule(name, nuxt)) {
    return false
  }
  const moduleOptions = (nuxt.options as unknown as Record<string, false | { enabled?: boolean } | undefined>)[configKey]
  return moduleOptions !== false && moduleOptions?.enabled !== false
}

/** What this module reads off `nuxt.options.i18n`, a subset of the `@nuxtjs/i18n` options. */
interface I18nOptions {
  locales?: (string | { code?: string })[]
  defaultLocale?: string
  strategy?: 'no_prefix' | 'prefix_except_default' | 'prefix' | 'prefix_and_default'
  differentDomains?: boolean
}

/**
 * The locale roots `@nuxtjs/i18n` serves as landing pages, read the way its
 * router does: every locale under `prefix` and `prefix_and_default`, every
 * locale but the default under `prefix_except_default` (its default, where the
 * default locale lives at `/`), none under `no_prefix` or across different
 * domains, where each locale has a root of its own.
 */
function i18nHomepages(nuxt: Nuxt): string[] {
  if (!hasActiveNuxtModule(nuxt, '@nuxtjs/i18n', 'i18n')) {
    return []
  }
  const i18n = (nuxt.options as { i18n?: I18nOptions }).i18n
  const strategy = i18n?.strategy || 'prefix_except_default'
  if (!i18n?.locales?.length || strategy === 'no_prefix' || i18n.differentDomains) {
    return []
  }
  const codes = new Set(i18n.locales.map(locale => typeof locale === 'string' ? locale : locale.code))
  return [...codes]
    .filter((code): code is string => Boolean(code) && (strategy !== 'prefix_except_default' || code !== i18n.defaultLocale))
    .map(code => `/${code}`)
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-agent-discovery',
    configKey: 'agentDiscovery',
    compatibility: {
      nuxt: '>=3.0.0'
    }
  },
  // Optional, so this never installs `@nuxt/content`. Declared because the
  // built-in source reaches into v3 internals (`@nuxt/content/server`,
  // `#content/manifest`, `minimark/stringify`) that a major bump would break
  // silently. Keep in step with `peerDependencies`.
  moduleDependencies: {
    '@nuxt/content': { version: '^3.0.0', optional: true }
  },
  defaults: {
    siteUrl: '',
    siteName: '',
    rawPrefix: '/raw',
    source: 'auto',
    // Arrays merge by concatenation, so the routes default is applied in setup.
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
    notAcceptable: false,
    sitemap: { markdown: true },
    robots: { aiPolicy: true, contentSignal: 'search=yes, ai-train=yes, ai-input=yes' },
    skills: { dir: 'skills' }
  },
  async setup(options, nuxt) {
    const logger = useLogger('nuxt-agent-discovery')
    const { resolve } = createResolver(import.meta.url)

    // Nuxt derives the `runtimeConfig` type from the site's resolved config,
    // which narrows `Record<string, string>` fields to that site's literal
    // keys. Assign through the module's own shape instead.
    const runtimeConfig = nuxt.options.runtimeConfig as unknown as AgentDiscoveryRuntimeConfig & { public: AgentDiscoveryPublicRuntimeConfig }

    const rawPrefix = withoutTrailingSlash(withLeadingSlash(options.rawPrefix || '/raw'))
    // A pattern without a leading slash never matches, so normalize rather than warn.
    const routes: AgentRoute[] = (options.routes?.length ? options.routes : ['/', '/**'])
      .map(route => typeof route === 'string' ? { path: route } : route)
      .map(route => ({ ...route, path: withLeadingSlash(route.path) }))
    // Exact routes this module appends at `modules:done` rather than the site
    // naming them, so a twin of theirs that 404s is skipped, not a build error.
    const detectedRoutes = new Set<string>()
    for (const [name, option] of [['userAgents', options.userAgents], ['excludePrefixes', options.excludePrefixes]] as const) {
      if (option?.replace && option.extend?.length) {
        logger.warn(`\`${name}\` has both \`replace\` and \`extend\`; \`replace\` wins and the extended entries are dropped.`)
      }
    }
    // Copied, not aliased: `agent-discovery:extend` pushes onto the list and a
    // `replace` array may be config shared between apps. The prefixes are
    // deduped too, since they become an alternation in the CDN lookahead.
    const userAgents = options.userAgents?.replace
      ? [...options.userAgents.replace]
      : [...AGENT_USER_AGENTS, ...(options.userAgents?.extend || [])]
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
      notAcceptable: options.notAcceptable === true,
      cachedRoutes: [],
      sitemapSections: {
        expand: (typeof options.sitemap?.markdown === 'object' && options.sitemap.markdown.expand) || [],
        labels: (typeof options.sitemap?.markdown === 'object' && options.sitemap.markdown.labels) || {}
      }
    }

    // An exact route whose `raw` destination negotiates back into the
    // middleware proxies itself forever, directly or through other routes.
    // Walk the runtime chain on normalized pathnames; revisiting one is the loop.
    const nextHop = (pathname: string): string | undefined => {
      if (isRawPath(config, pathname) || excludePrefixes.some(prefix => pathname.startsWith(prefix))) {
        return undefined
      }
      const base = pathname.endsWith('.md') ? pathname.slice(0, -3) : pathname
      if (base.length <= 1 || (base === pathname && hasFileExtension(base))) {
        return undefined
      }
      const matched = matchRoute(routes, base)
      return matched ? normalizePathname(rawDestination(config, matched, base)) : undefined
    }
    for (const route of routes) {
      if (!route.raw || route.path.includes('*')) {
        continue
      }
      const visited = new Set<string>()
      let hop = nextHop(normalizePathname(route.raw))
      while (hop) {
        if (visited.has(hop)) {
          throw new Error(`[nuxt-agent-discovery] \`routes\`: the \`raw\` destination \`${route.raw}\` for \`${route.path}\` negotiates back to itself. Point it under \`${rawPrefix}\`, or exclude it through \`excludePrefixes\`.`)
        }
        visited.add(hop)
        hop = nextHop(hop)
      }
    }

    // The discovery-link registry, assembled at `modules:done`.
    // `agent-discovery:extend` fires once, from whichever consumer needs it
    // first: `@nuxtjs/robots` snapshots the user agents from its own
    // `modules:done`, which runs before ours when it is listed first. Hook
    // contributions are appended after the module's own links either way.
    const links: DiscoveryLink[] = []
    const hookLinks: DiscoveryLink[] = []
    let extended: Promise<void> | undefined
    const extendRegistry = () => extended ??= nuxt.callHook('agent-discovery:extend', { links: hookLinks, userAgents })

    /* ------------------------------- source ------------------------------- */

    let sourcePath: string | undefined
    let builtinContentSource = false
    let minimarkStringify: string | undefined
    if (options.source === 'content' || (options.source === 'auto' && hasNuxtModule('@nuxt/content'))) {
      const contentSource = await resolveContentSource(nuxt, resolve)
      sourcePath = contentSource.sourcePath
      minimarkStringify = contentSource.minimarkStringify
      builtinContentSource = true
    } else if (options.source === 'comark') {
      throw new Error('[nuxt-agent-discovery] comark sites construct their content instance themselves, so pass a source file instead: `source: \'~~/server/utils/agent-source\'`, exporting `createComarkSource(() => getContent())` from `#agent-discovery/comark`.')
    } else if (typeof options.source === 'string' && options.source !== 'auto') {
      sourcePath = await resolvePath(options.source)
    }

    // `@nuxtjs/mcp-toolkit` is detected, never depended on: the alias starts
    // on the stub and `modules:done` swaps it.
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
    // Also aliased app-side so a single-tsconfig site can typecheck a server
    // route importing `#agent-discovery`.
    nuxt.options.alias = defu(nuxt.options.alias, aliases)

    const staticBuild = Boolean(nuxt.options.nitro?.static) || (nuxt.options as { _generate?: boolean })._generate === true

    // Every companion module is detected at `modules:done`: one pulled in
    // through `moduleDependencies` (as `@nuxtjs/seo` does) installs after
    // every listed module's `setup()`. Nitro resolves the alias table later
    // still, so swapping the entry here lands.
    nuxt.hook('modules:done', () => {
      // Under `nuxt generate` the toolkit registers none of its virtual
      // modules, and aliasing the real re-export then fails the Nitro build.
      if (staticBuild || !hasActiveNuxtModule(nuxt, '@nuxtjs/mcp-toolkit', 'mcp')) {
        return
      }

      const definitions = resolve('./runtime/server/mcp/definitions')
      const nitroAlias = nuxt.options.nitro.alias ||= {}
      nitroAlias['#agent-discovery/mcp'] = definitions
      nuxt.options.alias['#agent-discovery/mcp'] = definitions
    })

    /* ------------------------------- handlers ----------------------------- */

    // Kept so `siteRawRoutes` can tell this handler from a site-registered one.
    const rawHandler = resolve('./runtime/server/routes/raw')
    if (sourcePath) {
      addServerHandler({ route: `${rawPrefix}/**`, handler: rawHandler })
      if (options.sitemap?.markdown) {
        addServerHandler({ route: '/sitemap.md', handler: resolve('./runtime/server/routes/sitemap.md') })
      }
    }
    if (options.discovery?.apiCatalog) {
      addServerHandler({ route: '/.well-known/api-catalog', handler: resolve('./runtime/server/routes/api-catalog') })
    }
    if (options.discovery?.mcpServerCard) {
      runtimeConfig.agentDiscoveryMcp = {
        ...options.discovery.mcpServerCard,
        excludeGroups: [...mcpExcludedGroups(options.discovery.mcpServerCard.excludeGroups)]
      }
      addServerHandler({ route: '/.well-known/mcp/server-card.json', handler: resolve('./runtime/server/routes/mcp-server-card') })
    }

    // `source: false` means something else serves the raw markdown. `'auto'`
    // resolving to nothing means no adapter at all, and rewriting every page
    // to a prefix nothing serves would answer agents with a 404.
    const negotiates = Boolean(sourcePath) || options.source === false
    if (!negotiates) {
      logger.warn('No content source resolved, so markdown negotiation is off. Install `@nuxt/content`, point `agentDiscovery.source` at a file exporting an `AgentContentSource`, or set `source: false` if another route already serves the raw markdown.')
    }

    if (negotiates) {
      addServerHandler({ middleware: true, handler: resolve('./runtime/server/middleware/negotiate') })
    }

    if (options.errors) {
      const errorHandler = resolve('./runtime/server/error')
      nuxt.hook('nitro:config', (nitroConfig) => {
        const handlers = nitroConfig.errorHandler
          ? (Array.isArray(nitroConfig.errorHandler) ? nitroConfig.errorHandler : [nitroConfig.errorHandler])
          : []
        nitroConfig.errorHandler = [errorHandler, ...handlers]
      })
      // Prepending is not enough: a module registered later whose
      // `nitro:config` hook also prepends lands ahead (evlog does, and ends
      // agent errors as JSON). Re-sort once every hook has run; the markdown
      // handler passes other requests through, so going first costs nothing.
      nuxt.hook('nitro:init', (nitro) => {
        const handlers = nitro.options.errorHandler as unknown
        if (Array.isArray(handlers)) {
          const index = handlers.indexOf(errorHandler)
          if (index > 0) {
            handlers.splice(index, 1)
            handlers.unshift(errorHandler)
          }
        }
      })
    }

    addImports({ name: 'useCanonical', from: resolve('./runtime/app/composables/useCanonical') })

    // Declares the Nitro runtime hooks so a site's server code needs no cast.
    const hookTypes = addTypeTemplate({
      filename: 'agent-discovery/hooks.d.ts',
      getContents: () => `
import type { H3Event } from 'h3'
import type { AgentIndex } from ${JSON.stringify(resolve('./runtime/shared/types'))}

declare module 'nitropack/types' {
  interface NitroRuntimeHooks {
    /**
     * Transforms a page before the content adapter stringifies it. The page is
     * whatever the adapter works on, a minimark tree for \`@nuxt/content\`.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    'agent-discovery:document': (event: H3Event, page: any) => void | Promise<void>
    /**
     * Fills in the generated \`/raw/index.md\` for a site whose landing page is
     * a Vue page. Set \`title\` and \`description\`, push markdown blocks onto \`body\`.
     */
    'agent-discovery:index': (event: H3Event, index: AgentIndex) => void | Promise<void>
    /** Enriches the served MCP server card with live tools, resources and prompts. */
    'agent-discovery:mcp-server-card': (event: H3Event, card: Record<string, unknown>) => void | Promise<void>
    /**
     * Adds to \`sitemap.md\` before it is rendered. Keys are the first path
     * segment of the grouped routes (\`docs\`, \`blog\`, \`pages\` for top-level
     * ones), with \`sitemap.markdown.labels\` applied at render.
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
      // Fed into `@nuxtjs/robots` through its hook rather than
      // `nuxt.options.robots`, which that module reads during its own setup.
      // Registered unconditionally: the hook never fires without the module,
      // and it fires from that module's `modules:done`, before ours when it is
      // listed first.
      const contentSignal = options.robots.contentSignal
      const disallow = options.robots.disallow || []
      // Typed with the hook signature `@nuxtjs/robots` exports so a group shape
      // change fails this build. The cast only covers the hook name.
      const onRobotsConfig = nuxt.hook as unknown as (
        name: 'robots:config',
        cb: RobotsModuleHooks['robots:config']
      ) => void
      onRobotsConfig('robots:config', async (robotsConfig) => {
        // The groups snapshot the user-agent list, so extend it first.
        await extendRegistry()
        // `Content-Signal` and `disallow` go on the wildcard group, as in this
        // module's own `robots.txt` route. The agent groups stay allow-only:
        // a UA-specific group exempts its agent from the wildcard rules.
        for (const group of robotsConfig.groups) {
          const groupAgents = Array.isArray(group.userAgent) ? group.userAgent : [group.userAgent]
          if (!groupAgents.includes('*')) {
            continue
          }
          if (contentSignal) {
            group.contentSignal = [contentSignal]
          }
          if (disallow.length) {
            const existing = Array.isArray(group.disallow) ? group.disallow : (group.disallow ? [group.disallow] : [])
            group.disallow = [...existing, ...disallow.filter(path => !existing.includes(path))]
          }
        }
        robotsConfig.groups.push(...userAgents.map(userAgent => ({
          userAgent: [userAgent],
          allow: ['/'],
          disallow: [],
          comment: []
        })))
      })

      nuxt.hook('modules:done', () => {
        // A disabled robots module registers no `/robots.txt` route.
        if (hasActiveNuxtModule(nuxt, '@nuxtjs/robots', 'robots')) {
          return
        }
        if (nuxt.options.serverHandlers.some(handler => handler.route === '/robots.txt')) {
          logger.warn('Another module already serves `/robots.txt`, so the AI robots policy is not applied to it. Contribute the `agentDiscovery.userAgents` list through that module instead.')
          return
        }
        if (existsSync(join(nuxt.options.rootDir, nuxt.options.dir?.public || 'public', 'robots.txt'))) {
          logger.warn('A static `public/robots.txt` exists, so the AI robots policy is not applied to it. Align its agent list with `agentDiscovery.userAgents` or remove the file.')
          return
        }
        runtimeConfig.agentDiscoveryRobots = { contentSignal: contentSignal || '', disallow }
        addServerHandler({ route: '/robots.txt', handler: resolve('./runtime/server/routes/robots.txt') })
      })
    }

    /* ------------------------------- sitemap ------------------------------ */

    // The raw twins are alternate representations, not pages, so they must
    // stay out of `sitemap.xml`. Through the runtime hook rather than
    // `sitemap.exclude`, which `@nuxtjs/sitemap` bakes into a virtual module
    // during its own setup.
    nuxt.hook('modules:done', () => {
      if (hasActiveNuxtModule(nuxt, '@nuxtjs/sitemap', 'sitemap')) {
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

      addServerHandler({ route: SKILLS_INDEX, handler: resolve('./runtime/server/routes/skills-index') })
      addServerHandler({ route: `${SKILLS_PREFIX}**`, handler: resolve('./runtime/server/routes/skills-files') })
      addPrerenderRoutes([
        SKILLS_INDEX,
        ...skills.flatMap(skill => skill.files.map(file => `${SKILLS_PREFIX}${skill.name}/${file}`))
      ])
    }

    /* ---------------------------- nuxt-llms bridge ------------------------- */

    const hasLlms = hasNuxtModule('nuxt-llms')
    if (hasLlms && sourcePath) {
      disableContentRawMarkdown(nuxt)
    }

    // Route-rule patterns with a response cache that a negotiated pattern
    // reaches; the CDN redirects there instead of rewriting. Collected three
    // times because rules keep arriving: at `modules:done` from
    // `nuxt.options.routeRules`, at `nitro:build:before` from Nitro's own
    // table (the only place a rule added in `nitro:config` lands), and when
    // the Vercel preset emits its table (for a page-level
    // `defineRouteRules({ isr })`). Rebuilt from scratch on every pass so a
    // rule flipped back to `{ isr: false }` drops off.
    const collectCachedRoutes = (routeRules?: Record<string, { isr?: unknown, swr?: unknown, cache?: unknown, static?: unknown } | undefined>) => {
      const previous = config.cachedRoutes.splice(0, config.cachedRoutes.length)
      for (const [key, rule] of Object.entries(routeRules || {})) {
        // Read the way Nitro reads it: `isr: 0` and `swr: 0` are not caches,
        // `cache: false` is an opt-out, and the legacy `static: false` is ISR.
        const cached = rule && (rule.isr || rule.swr || rule.cache
          || ('static' in rule && !(rule as { static?: boolean | number }).static))
        if (!cached) {
          continue
        }
        // Excluded prefixes never negotiate, so their caches are safe.
        if (config.excludePrefixes.some(prefix => staticPrefix(key).startsWith(prefix)) || staticPrefix(key).startsWith(`${rawPrefix}/`)) {
          continue
        }
        // For an exact rule the question is whether the path negotiates, not
        // whether it overlaps a pattern: `/llms.txt` overlaps `/**` but is not a page.
        const negotiable = key.includes('*')
          ? routes.some(route => patternsOverlap(key, route.path))
          : Boolean(matchRoute(routes, key)) && !hasFileExtension(key)
        if (negotiable) {
          config.cachedRoutes.push(key)
          if (!previous.includes(key)) {
            logger.info(`Route rule \`${key}\` has a response cache: request-time markdown negotiation is disabled there, and the CDN routes redirect to the raw markdown instead of rewriting.`)
          }
        }
      }
      for (const key of previous) {
        if (!config.cachedRoutes.includes(key)) {
          logger.info(`Route rule \`${key}\` no longer has a response cache: the CDN routes rewrite it again instead of redirecting.`)
        }
      }
    }

    nuxt.hook('modules:done', async () => {
      // Prerendered documents bake the site URL in, so resolve it from the
      // site config or the llms domain. Request-time responses still fall
      // back to the incoming host.
      const siteOptions = nuxt.options as { site?: { url?: string, name?: string }, llms?: { domain?: string } }
      if (!config.siteUrl) {
        config.siteUrl = (siteOptions.site?.url || siteOptions.llms?.domain || '').replace(/\/$/, '')
      }
      if (!config.siteName) {
        config.siteName = siteOptions.site?.name || ''
      }

      // `siteUrl` is used as an origin everywhere, so a path in it would
      // corrupt every link. `site.url` is commonly written without a scheme,
      // and `new URL()` then throws a bare `Invalid URL`.
      if (config.siteUrl) {
        let parsed: URL
        try {
          parsed = new URL(config.siteUrl)
        } catch {
          throw new Error(`[nuxt-agent-discovery] \`siteUrl\` is not a valid URL (${config.siteUrl}). Give it a scheme, as in \`https://example.com\`.`)
        }
        if (parsed.pathname !== '/') {
          throw new Error(`[nuxt-agent-discovery] \`siteUrl\` must be an origin, but it carries a path (${config.siteUrl}). Serving the site under a base path is not supported yet.`)
        }
      }

      // The prerenderer sends no host header, so an empty value becomes
      // `http://localhost` in every prerendered URL.
      if (!config.siteUrl && nuxt.options.nitro.static) {
        logger.warn('No `siteUrl`: set it, or `site.url`, or `llms.domain`. Prerendered documents resolve it from the request, which is `localhost` at build time.')
      }

      // This plugin builds `llms.txt` from the adapter, replacing the llms
      // feature of `@nuxt/content`.
      if (hasLlms && sourcePath) {
        dropContentLlmsFeature(nuxt)
        addServerPlugin(resolve('./runtime/server/plugins/llms'))
      }

      /* ------------------------------ homepages ----------------------------- */

      // On an i18n site `/` only redirects and the landing documents live at the
      // locale roots, which is where `llms.txt` sends agents, so those count as
      // homepages too: negotiated as an exact route where no pattern covers
      // them already, their twin prerendered and wrapped with the resources
      // block like `/raw/index.md` either way. Detected here like the other
      // companions, so a site pulling `@nuxtjs/i18n` in through a layer is covered.
      const homepages = i18nHomepages(nuxt)
      for (const homepage of homepages) {
        if (!matchRoute(routes, homepage)) {
          routes.push({ path: homepage })
          detectedRoutes.add(homepage)
        }
      }
      if (homepages.length) {
        config.homepages = homepages
      }

      /* ------------------------------ registry ----------------------------- */

      // Advertised only when something serves it: this module does not
      // generate `sitemap.xml`.
      if (options.discovery?.sitemapXml !== false && hasActiveNuxtModule(nuxt, '@nuxtjs/sitemap', 'sitemap')) {
        links.push({ href: '/sitemap.xml', rel: 'sitemap', type: 'application/xml', title: 'Sitemap (XML)' })
      }
      if (sourcePath && options.sitemap?.markdown) {
        links.push({ href: '/sitemap.md', rel: 'sitemap', type: 'text/markdown', title: 'Sitemap (Markdown): every page on the site' })
      }
      // Advertised only once something would be in it: the catalog lists the
      // `service-desc`/`service-doc` links carrying an `anchor`. Registered
      // after the hook so contributed links count.
      const catalogLink: DiscoveryLink = { href: '/.well-known/api-catalog', rel: 'api-catalog', type: 'application/linkset+json', title: 'API catalog: every service document this site publishes' }
      if (options.discovery?.mcpServerCard) {
        const card = options.discovery.mcpServerCard
        const endpoint = card.endpoint.startsWith('/') ? `${config.siteUrl}${card.endpoint}` : card.endpoint
        links.push({ href: '/.well-known/mcp/server-card.json', rel: 'service-desc', type: 'application/json', title: `MCP server card: MCP endpoint at ${endpoint}`, anchor: card.endpoint })
        // The endpoint itself, reachable without fetching the card first.
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
        links.push({ href: SKILLS_INDEX, rel: 'index', type: 'application/json', title: 'Agent skills index: every skill published by this site' })
        // Only the index goes in the `Link` header.
        for (const skill of skills) {
          links.push({ href: `${SKILLS_PREFIX}${skill.name}/SKILL.md`, rel: 'service-doc', type: 'text/markdown', title: `Agent skill: ${skill.name}`, anchor: '/', header: false })
        }
      }
      if (matchRoute(routes, '/')) {
        links.push({ href: '/', rel: 'alternate', type: 'text/markdown' })
      }
      links.push(...(options.discovery?.links || []))

      await extendRegistry()
      links.push(...hookLinks)

      if (options.discovery?.apiCatalog && links.some(link => link.anchor && (link.rel === 'service-desc' || link.rel === 'service-doc'))) {
        links.unshift(catalogLink)
      }

      // Layer configs concatenate, so a layer and the app both declaring
      // `/llms.txt` would double it. First one wins.
      const seen = new Set<string>()
      for (const link of links) {
        if (!isValidRel(link.rel)) {
          throw new Error(`[nuxt-agent-discovery] \`rel="${link.rel}"\` (${link.href}) is not an IANA-registered link relation. Use a registered rel or an absolute URI extension relation.`)
        }
        const key = `${link.rel} ${link.href}`
        if (!seen.has(key)) {
          seen.add(key)
          config.links.push(link)
        }
      }

      // `/sitemap.md` is not a page twin: without this a catch-all pattern
      // rewrites it under `rawPrefix`. Keyed on the registered link rather than
      // on this module owning the route, so a site serving its own through
      // `discovery.links` gets the exclusion too.
      if (config.links.some(link => link.href === '/sitemap.md') && !config.excludePrefixes.includes('/sitemap.md')) {
        config.excludePrefixes.push('/sitemap.md')
      }

      /* ----------------------------- route rules ---------------------------- */

      // Only the `Link` header, and only on `/`. A `Vary` route rule under
      // `/**` would hit every path on the site and a route rule cannot express
      // an exclusion, so `Vary` comes from the middleware.
      if (config.linkHeader && config.links.length) {
        nuxt.options.routeRules = defu(nuxt.options.routeRules, {
          '/': { headers: { Vary: MARKDOWN_VARY, Link: formatLinkHeader(config.links) } }
        })
      }

      // A cached response cannot vary on Accept/User-Agent, so request-time
      // negotiation is off there. The CDN rewrites run before the cache.
      collectCachedRoutes(nuxt.options.routeRules)

      /* ---------------------------- runtime config --------------------------- */

      runtimeConfig.agentDiscovery = config
      runtimeConfig.public.agentDiscovery = {
        siteUrl: config.siteUrl,
        siteName: config.siteName,
        rawPrefix
      }
    })

    /* ------------------------------ prerender ------------------------------ */

    // The route patterns of every handler the site serves under the raw
    // prefix: module-registered handlers (this module's own excepted) and
    // scanned `server/routes` files in every layer, mapped from their filename
    // the way Nitro maps them (`raw/[...slug].md.get.ts` to `/raw/**:slug.md`).
    // Patterns rather than paths, since a wildcard route has no build-time
    // list of twins; the runtime asks `siteServesRaw()` per path.
    const rawSegments = rawPrefix.split('/').filter(Boolean)
    const coversRawPrefix = (pattern: string): boolean => {
      const segments: string[] = []
      for (const segment of pattern.split('/').filter(Boolean)) {
        if (/[:*]/.test(segment)) {
          break
        }
        segments.push(segment)
      }
      return segments.slice(0, rawSegments.length).every((segment, index) => segment === rawSegments[index])
    }
    const scannedRawRoutes = (serverDir: string): string[] => {
      const dir = join(serverDir, 'routes', ...rawSegments)
      if (!existsSync(dir)) {
        return []
      }
      const patterns: string[] = []
      for (const file of readdirSync(dir, { recursive: true }) as string[]) {
        if (!/\.(?:js|mjs|cjs|ts|mts|cts|tsx|jsx)$/.test(file) || !statSync(join(dir, file)).isFile()) {
          continue
        }
        let route = file
          .replace(/\\/g, '/')
          .replace(/\.[a-z]+$/i, '')
          .replace(/\(([^(/]+)\)\//g, '')
          .replace(/\[\.{3}\]/g, '**')
          .replace(/\[\.{3}(\w+)\]/g, '**:$1')
          .replace(/\[([^/\]]+)\]/g, ':$1')
        const suffix = route.match(/(\.(?<method>connect|delete|get|head|options|patch|post|put|trace))?(\.(?<env>dev|prod|prerender))?$/)
        if (suffix?.index !== undefined && suffix[0]) {
          route = route.slice(0, suffix.index)
        }
        // No GET means no twin, and a `.dev` handler is not in the build.
        const method = suffix?.groups?.method
        if ((method && method !== 'get' && method !== 'head') || suffix?.groups?.env === 'dev') {
          continue
        }
        route = route.replace(/\/index$/, '')
        patterns.push(withoutTrailingSlash(`${rawPrefix}/${route}`))
      }
      return patterns
    }
    const siteRawRoutes = (): string[] => {
      const patterns = new Set<string>()
      for (const handler of nuxt.options.serverHandlers) {
        const answersGet = !handler.method || handler.method === 'get' || handler.method === 'head'
        if (handler.handler !== rawHandler && handler.route && answersGet && coversRawPrefix(handler.route)) {
          patterns.add(handler.route)
        }
      }
      const layers = nuxt.options._layers || []
      const serverDirs = new Set([
        (nuxt.options as { serverDir?: string }).serverDir || join(nuxt.options.srcDir, 'server'),
        ...layers.map(layer => layer.config?.serverDir || join(layer.cwd, 'server'))
      ])
      for (const serverDir of serverDirs) {
        for (const pattern of scannedRawRoutes(serverDir)) {
          patterns.add(pattern)
        }
      }
      return [...patterns]
    }

    // Behind a server only the built-in source prerenders; a custom adapter
    // reads content at request time. A static build has no server, so
    // everything advertised is prerendered whatever the source. At
    // `modules:done` so handlers registered by later modules are visible: a
    // twin the site serves itself must not be frozen at build.
    // Twins queued for exact patterns stay build errors when they 404, since
    // the site named them.
    const queuedRawRoutes = new Set<string>()
    nuxt.hook('modules:done', () => {
      config.ownRawRoutes = siteRawRoutes()

      if (sourcePath && (builtinContentSource || staticBuild)) {
        for (const route of routes) {
          if (!route.path.includes('*')) {
            const raw = rawDestination(config, route, route.path)
            if (!siteServesRaw(config, raw)) {
              addPrerenderRoutes(raw)
              // A detected locale root may have no landing document, and its
              // twin then answers a 404 the site never asked to be written.
              if (!detectedRoutes.has(route.path)) {
                queuedRawRoutes.add(raw)
              }
            }
          }
        }
        // A locale root a pattern covers has no exact entry of its own, and its
        // twin is a homepage all the same: queued like `/raw/index.md` rather
        // than left to whether the site prerenders the landing page, and never
        // a build error, since the site named neither.
        for (const homepage of config.homepages || []) {
          const route = detectedRoutes.has(homepage) ? undefined : matchRoute(routes, homepage)
          if (route) {
            const raw = rawDestination(config, route, homepage)
            if (!siteServesRaw(config, raw)) {
              addPrerenderRoutes(raw)
            }
          }
        }
        if (options.sitemap?.markdown) {
          addPrerenderRoutes('/sitemap.md')
        }
      }
    })

    /* ------------------------------- presets ------------------------------- */

    if (negotiates) {
      // Rules another module added in `nitro:config` exist only in Nitro's
      // table, and the runtime config was deep-cloned at `createNitro`, so
      // sync the copy rollup stringifies later.
      nuxt.hook('nitro:build:before', (nitro) => {
        collectCachedRoutes(nitro.options.routeRules)
        const runtime = nitro.options.runtimeConfig.agentDiscovery as NegotiationConfig | undefined
        if (runtime) {
          runtime.cachedRoutes = [...config.cachedRoutes]
        }
      })
      nuxt.hook('nitro:init', (nitro) => {
        // The preset collects once more when it emits its table, late enough
        // to see an inline `defineRouteRules({ isr })`.
        setupVercelPreset(nitro, config, collectCachedRoutes)

        // Every queued twin passes here before Nitro writes it. One the site
        // serves itself is never frozen. One that answered a redirect or a 404
        // is dropped rather than written or reported, except the twins queued
        // for exact patterns, which the site named.
        nitro.hooks.hook('prerender:generate', (route) => {
          if (!isRawPath(config, route.route)) {
            return
          }
          if (siteServesRaw(config, route.route)) {
            route.skip = true
            route.error = undefined
            return
          }
          if (route.error) {
            if (route.error.statusCode === 404 && !queuedRawRoutes.has(route.route)) {
              route.skip = true
              route.error = undefined
            }
            return
          }
          if (!route.contentType?.includes('markdown')) {
            route.skip = true
          }
        })
      })
    }
  }
})
