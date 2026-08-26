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
import { formatLinkHeader, matchRoute, patternsOverlap, rawDestination, staticPrefix, MARKDOWN_VARY } from './runtime/shared/negotiation'
import type { AgentRoute, DiscoveryLink, NegotiationConfig, SitemapSections, SkillEntry } from './runtime/shared/types'

export type { AgentContentSource, AgentPage, AgentRoute, DiscoveryLink, NegotiationConfig, SitemapSections, SkillEntry } from './runtime/shared/types'

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
   * `createComarkSource()` from `#agent-discovery`); `false` disables every
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
  /** Path prefixes that never negotiate and keep their JSON/HTML errors. */
  excludePrefixes?: string[]
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

declare module '@nuxt/schema' {
  interface NuxtHooks {
    /** Lets other modules add discovery links and agent user agents. */
    'agent-discovery:extend': (registry: { links: DiscoveryLink[], userAgents: string[] }) => void | Promise<void>
  }
  interface RuntimeConfig {
    agentDiscovery: NegotiationConfig
    agentDiscoveryMcp?: McpServerCardOptions
    agentDiscoveryRobots?: { contentSignal: string }
    agentDiscoverySkills?: { skills: SkillEntry[] }
  }
  interface PublicRuntimeConfig {
    agentDiscovery: { siteUrl: string, siteName: string, rawPrefix: string }
  }
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-agent-discovery',
    configKey: 'agentDiscovery',
    compatibility: {
      nuxt: '>=3.0.0'
    }
  },
  defaults: {
    siteUrl: '',
    siteName: '',
    rawPrefix: '/raw',
    source: 'auto',
    // Option arrays merge by concatenation, so the routes default is applied
    // in setup instead: a site defining its own patterns replaces it.
    routes: [],
    excludePrefixes: EXCLUDE_PREFIXES,
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

    const rawPrefix = withoutTrailingSlash(withLeadingSlash(options.rawPrefix || '/raw'))
    const routes: AgentRoute[] = (options.routes?.length ? options.routes : ['/', '/**'])
      .map(route => typeof route === 'string' ? { path: route } : route)
    const userAgents = options.userAgents?.replace || [...AGENT_USER_AGENTS, ...(options.userAgents?.extend || [])]

    // Mutated until `modules:done`, then read by the runtime and the presets.
    const config: NegotiationConfig = {
      siteUrl: (options.siteUrl || '').replace(/\/$/, ''),
      siteName: options.siteName || '',
      rawPrefix,
      routes,
      userAgents,
      excludePrefixes: options.excludePrefixes || EXCLUDE_PREFIXES,
      links: [],
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
        logger.warn('Could not resolve `minimark/stringify` from `@nuxt/content`; falling back to this module\'s own copy. Raw markdown may differ from what `@nuxt/content` produces.')
      }
    } else if (options.source === 'comark') {
      throw new Error('[nuxt-agent-discovery] comark sites construct their content instance themselves, so pass a source file instead: `source: \'~~/server/utils/agent-source\'`, exporting `createComarkSource(() => getContent())` from `#agent-discovery/comark`.')
    } else if (typeof options.source === 'string' && options.source !== 'auto') {
      sourcePath = await resolvePath(options.source)
    }

    const aliases = {
      '#agent-discovery/source': sourcePath || resolve('./runtime/server/sources/none'),
      '#agent-discovery/comark': resolve('./runtime/server/sources/comark'),
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

    /* ------------------------------- handlers ----------------------------- */

    if (sourcePath) {
      addServerHandler({ route: `${rawPrefix}/**`, handler: resolve('./runtime/server/routes/raw') })
      if (options.sitemap?.markdown) {
        addServerHandler({ route: '/sitemap.md', handler: resolve('./runtime/server/routes/sitemap.md') })
        // Not a page twin: without this, a catch-all route pattern would
        // rewrite it to `${rawPrefix}/sitemap.md` at the edge and in the
        // middleware, shadowing the handler.
        config.excludePrefixes.push('/sitemap.md')
      }
    }
    if (options.discovery?.apiCatalog) {
      addServerHandler({ route: '/.well-known/api-catalog', handler: resolve('./runtime/server/routes/api-catalog') })
    }
    if (options.discovery?.mcpServerCard) {
      nuxt.options.runtimeConfig.agentDiscoveryMcp = options.discovery.mcpServerCard
      addServerHandler({ route: '/.well-known/mcp/server-card.json', handler: resolve('./runtime/server/routes/mcp-server-card') })
    }

    addServerHandler({ middleware: true, handler: resolve('./runtime/server/middleware/negotiate') })

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
     * Adds body blocks to the generated \`/raw/index.md\`, for a site whose
     * landing page is a Vue page rather than a document.
     */
    'agent-discovery:index': (event: H3Event, body: string[]) => void | Promise<void>
    /** Enriches the served MCP server card with live tools, resources and prompts. */
    'agent-discovery:mcp-server-card': (event: H3Event, card: Record<string, unknown>) => void | Promise<void>
  }
}

export {}
`,
      write: true
    }, { node: true }).dst

    nuxt.options.nitro.typescript = defu(nuxt.options.nitro.typescript, { tsConfig: { include: [hookTypes] } })

    /* ------------------------------- robots ------------------------------- */

    if (options.robots?.aiPolicy) {
      if (hasNuxtModule('@nuxtjs/robots')) {
        // Feed the shared user-agent list into the robots module instead of
        // competing for the `/robots.txt` route.
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
      } else if (existsSync(join(nuxt.options.rootDir, nuxt.options.dir?.public || 'public', 'robots.txt'))) {
        logger.warn('A static `public/robots.txt` exists, so the AI robots policy is not applied to it. Align its agent list with `agentDiscovery.userAgents` or remove the file.')
      } else {
        nuxt.options.runtimeConfig.agentDiscoveryRobots = {
          contentSignal: options.robots.contentSignal || ''
        }
        addServerHandler({ route: '/robots.txt', handler: resolve('./runtime/server/routes/robots.txt') })
      }
    }

    /* ------------------------------- sitemap ------------------------------ */

    if (hasNuxtModule('@nuxtjs/sitemap')) {
      // The raw markdown twins are alternate representations of pages already
      // in the sitemap, not pages of their own, so they must never be listed
      // as separate URLs. Every site that pairs a sitemap module with a raw
      // markdown route needs this, so the module does it rather than leaving
      // each one to remember.
      const sitemapOptions = nuxt.options as { sitemap?: { exclude?: string[] } }
      sitemapOptions.sitemap = defu(sitemapOptions.sitemap, { exclude: [`${rawPrefix}/**`] })
    }

    /* ------------------------------- skills ------------------------------- */

    const skillsDir = join(nuxt.options.rootDir, (options.skills && options.skills.dir) || 'skills')
    const skills: SkillEntry[] = options.skills === false ? [] : await scanSkills(skillsDir, logger)

    if (skills.length) {
      logger.info(`Found ${skills.length} agent skill${skills.length > 1 ? 's' : ''}: ${skills.map(skill => skill.name).join(', ')}`)
      nuxt.options.runtimeConfig.agentDiscoverySkills = { skills }

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
      const llmsOptions = nuxt.options as { llms?: Record<string, unknown> }
      llmsOptions.llms = { ...llmsOptions.llms, contentRawMarkdown: false }
    }

    nuxt.hook('modules:done', async () => {
      // Prerendered documents bake the site URL in, so resolve it from the
      // site config or the llms domain when not set explicitly. Request-time
      // responses still fall back to the incoming host.
      if (!config.siteUrl) {
        const siteOptions = nuxt.options as { site?: { url?: string }, llms?: { domain?: string } }
        config.siteUrl = (siteOptions.site?.url || siteOptions.llms?.domain || '').replace(/\/$/, '')
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
      if (options.discovery?.sitemapXml) {
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
      config.links.push(...links)

      /* ----------------------------- route rules ---------------------------- */

      const headerRules: Record<string, { headers: Record<string, string> }> = {}
      for (const route of routes) {
        headerRules[route.path] = { headers: { Vary: MARKDOWN_VARY } }
        if (!route.path.includes('*') && route.path !== '/') {
          headerRules[`${route.path}.md`] = { headers: { Vary: MARKDOWN_VARY } }
        }
      }
      headerRules[`${rawPrefix}/**`] = { headers: { Vary: MARKDOWN_VARY } }
      if (options.discovery?.link !== false && config.links.length) {
        headerRules['/'] = { headers: { Vary: MARKDOWN_VARY, Link: formatLinkHeader(config.links) } }
      }
      nuxt.options.routeRules = defu(nuxt.options.routeRules, headerRules)

      // A cached response cannot vary on Accept/User-Agent, so request-time
      // negotiation is disabled there. The CDN rewrites still cover those
      // pages because they run before the cache.
      for (const [key, rule] of Object.entries(nuxt.options.routeRules || {})) {
        if (!rule || !(rule.isr || rule.swr || 'cache' in rule)) {
          continue
        }
        // Excluded prefixes never negotiate, so their caches are safe.
        if (config.excludePrefixes.some(prefix => staticPrefix(key).startsWith(prefix)) || staticPrefix(key).startsWith(`${rawPrefix}/`)) {
          continue
        }
        if (routes.some(route => patternsOverlap(key, route.path))) {
          config.cachedRoutes.push(key)
          logger.info(`Route rule \`${key}\` has a response cache: request-time markdown negotiation is disabled there, and the CDN routes redirect to the raw markdown instead of rewriting.`)
        }
      }

      /* ---------------------------- runtime config --------------------------- */

      nuxt.options.runtimeConfig.agentDiscovery = config
      nuxt.options.runtimeConfig.public.agentDiscovery = {
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

    nuxt.hook('nitro:init', (nitro) => {
      setupVercelPreset(nitro, config)
    })
  }
})
