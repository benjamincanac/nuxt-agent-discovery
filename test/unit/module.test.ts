import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { nuxtCtx } from '@nuxt/kit'
import module from '../../src/module'
import { AGENT_USER_AGENTS, EXCLUDE_PREFIXES } from '../../src/defaults'
import { vercelMarkdownRoutes } from '../../src/presets/vercel'
import type { ModuleOptions } from '../../src/module'
import type { NegotiationConfig } from '../../src/runtime/shared/types'

const rootDir = fileURLToPath(new URL('../fixtures/custom-source', import.meta.url))

/** The hooks the module calls, without pulling `hookable` in. */
function createHooks() {
  const registry = new Map<string, ((...args: never[]) => unknown)[]>()
  return {
    hook(name: string, callback: (...args: never[]) => unknown) {
      const listeners = registry.get(name) || []
      listeners.push(callback)
      registry.set(name, listeners)
    },
    async callHook(name: string, ...args: never[]) {
      for (const callback of registry.get(name) || []) {
        await callback(...args)
      }
    },
    addHooks() {}
  }
}

/**
 * Enough of a Nuxt instance for `setup()` to run end to end. `_installedModules`
 * carries `@nuxt/content` so the source resolves and the `/sitemap.md` handler
 * is registered, which is the branch that mutates `excludePrefixes`.
 */
function createNuxt(routeRules: Record<string, unknown> = {}) {
  const hooks = createHooks()
  return {
    _version: '4.5.2',
    hooks,
    hook: hooks.hook,
    callHook: hooks.callHook,
    options: {
      rootDir,
      srcDir: rootDir,
      buildDir: `${rootDir}/.nuxt`,
      dir: {},
      // `resolvePath()` reads these when the site points `source` at a file.
      extensions: ['.js', '.mjs', '.ts'],
      modulesDir: [fileURLToPath(new URL('../../node_modules', import.meta.url))],
      modules: [],
      _installedModules: [{ meta: { name: '@nuxt/content' } }],
      _requiredModules: {},
      experimental: {},
      build: { templates: [] },
      nitro: {} as { plugins?: string[], alias?: Record<string, string>, static?: boolean },
      alias: {} as Record<string, string>,
      serverHandlers: [] as { route?: string, handler: string }[],
      routeRules,
      runtimeConfig: { public: {} } as Record<string, unknown> & { public: Record<string, unknown> }
    }
  }
}

type FakeNuxt = ReturnType<typeof createNuxt>

/**
 * One full module setup. `installLate` runs between `setup()` and
 * `modules:done`, which is where Nuxt installs a module's declarative
 * `moduleDependencies`.
 */
async function runModule(options: Partial<ModuleOptions> = {}, routeRules: Record<string, unknown> = {}, installLate?: (nuxt: FakeNuxt) => void): Promise<FakeNuxt> {
  const nuxt = createNuxt(routeRules)
  // `set`, not `callAsync`: unctx only restores an async context in code the
  // Nuxt transform has processed, and this file is plain vitest.
  nuxtCtx.set(nuxt as never, true)
  try {
    await (module as unknown as (options: Partial<ModuleOptions>, nuxt: unknown) => Promise<unknown>)(options, nuxt)
    installLate?.(nuxt)
    await nuxt.hooks.callHook('modules:done' as never)
  } finally {
    nuxtCtx.unset()
  }
  return nuxt
}

/** The same, resolved through to the config the runtime reads. */
async function setupModule(options: Partial<ModuleOptions> = {}, routeRules: Record<string, unknown> = {}): Promise<NegotiationConfig> {
  const nuxt = await runModule(options, routeRules)
  return nuxt.options.runtimeConfig.agentDiscovery as NegotiationConfig
}

describe('module setup: shared defaults', () => {
  it('never mutates the module-level defaults, however many instances run', async () => {
    const first = await setupModule()
    const second = await setupModule()

    // `/sitemap.md` is pushed onto the negotiation config once per instance.
    // Before the copy it landed on `EXCLUDE_PREFIXES` itself, so the second
    // Nuxt instance in the same process started from a polluted default.
    expect(EXCLUDE_PREFIXES).toEqual(['/_', '/api/', '/mcp', '/.well-known/'])
    expect(EXCLUDE_PREFIXES).toHaveLength(4)

    for (const config of [first, second]) {
      expect(config.excludePrefixes).toEqual(['/_', '/api/', '/mcp', '/.well-known/', '/sitemap.md'])
    }
    expect(first.excludePrefixes).not.toBe(second.excludePrefixes)
  })

  it('does not leak a site-specific exclusion into the next instance', async () => {
    const configured = await setupModule({ excludePrefixes: { extend: ['/openapi.json'] } })
    const plain = await setupModule()

    expect(configured.excludePrefixes).toContain('/openapi.json')
    // Exactly the defaults, so a second `/sitemap.md` cannot creep in either.
    expect(plain.excludePrefixes).toEqual([...EXCLUDE_PREFIXES, '/sitemap.md'])
  })

  it('appends what a site extends instead of concatenating the defaults twice', async () => {
    const config = await setupModule({ excludePrefixes: { extend: ['/api/', '/openapi.json'] } })

    // `/api/` is already a default. The whole default list used to be appended
    // to the site's, which doubled every alternative of the generated CDN
    // lookahead and left a site no way to drop one.
    expect(config.excludePrefixes).toEqual([...EXCLUDE_PREFIXES, '/openapi.json', '/sitemap.md'])
  })

  it('drops the defaults entirely for a `replace` list', async () => {
    const config = await setupModule({ excludePrefixes: { replace: ['/_'] } })

    expect(config.excludePrefixes).toEqual(['/_', '/sitemap.md'])
  })

  it('copies a `userAgents.replace` list rather than working on the site\'s array', async () => {
    const replace = ['ClaudeBot', 'GPTBot']
    const config = await setupModule({ userAgents: { replace } })

    expect(config.userAgents).toEqual(replace)
    expect(config.userAgents).not.toBe(replace)
  })

  it('leaves the default user agent list alone when a site extends it', async () => {
    const before = [...AGENT_USER_AGENTS]
    const config = await setupModule({ userAgents: { extend: ['MyBot'] } })

    expect(config.userAgents).toEqual([...before, 'MyBot'])
    expect(AGENT_USER_AGENTS).toEqual(before)
  })
})

describe('module setup: cached routes', () => {
  // The `routes` a site lists page patterns with, plus the ISR rules a Vercel
  // site puts on the documents it generates.
  const routes = ['/', '/tools', '/tools/**', '/compare', '/compare/**']
  const routeRules = {
    '/llms.txt': { isr: 3600 },
    '/llms-full.txt': { isr: 3600 },
    '/sitemap.xml': { isr: 3600 },
    '/tools': { isr: 3600 },
    '/tools/**': { isr: 3600 }
  }

  // Which route-rule shapes Nitro actually turns into a response cache. Pinned
  // because it is otherwise folklore about `deprecateSWR` and
  // `normalizeRouteRules`, and because guessing wrong in either direction is a
  // bug: a missed cache gets a rewrite that poisons it, a false positive costs
  // a redirect where a rewrite would have done.
  it('reads a route rule the way Nitro reads it', async () => {
    const cached = async (rule: Record<string, unknown>) => {
      const config = await setupModule({ routes: ['/docs/**'] }, { '/docs/**': rule })
      return config.cachedRoutes.includes('/docs/**')
    }

    expect(await cached({ isr: 3600 })).toBe(true)
    expect(await cached({ isr: true })).toBe(true)
    expect(await cached({ swr: 60 })).toBe(true)
    expect(await cached({ cache: { maxAge: 60 } })).toBe(true)
    // `deprecateSWR` turns `static` into `isr: !static`, so this really is ISR.
    expect(await cached({ static: false })).toBe(true)

    expect(await cached({ isr: false })).toBe(false)
    expect(await cached({ swr: false })).toBe(false)
    expect(await cached({ static: true })).toBe(false)
    expect(await cached({ prerender: true })).toBe(false)
    // An opt-out, which `'cache' in rule` used to read as a cache.
    expect(await cached({ cache: false })).toBe(false)
    // The Vercel builder skips a falsy `isr` outright, and `normalizeRouteRules`
    // only configures a cache for a truthy `swr`, so neither is one.
    expect(await cached({ isr: 0 })).toBe(false)
    expect(await cached({ swr: 0 })).toBe(false)
  })

  it('only lists a rule the routes actually negotiate', async () => {
    const config = await setupModule({ routes }, routeRules)

    // `/llms.txt` overlaps `/` under `patternsOverlap`, because everything is
    // under `/`, but no pattern matches it: it is a document, not a page.
    expect(config.cachedRoutes).toEqual(['/tools', '/tools/**'])
  })

  it('never redirects a cached document to a raw twin that does not exist', async () => {
    const config = await setupModule({ routes }, routeRules)
    const locations = vercelMarkdownRoutes(config).map(route => route.headers?.Location || '')

    expect(locations.some(location => location.startsWith('/raw/llms'))).toBe(false)
    expect(locations.some(location => location.startsWith('/raw/sitemap'))).toBe(false)
    expect(locations.filter(Boolean)).toEqual(['/raw/tools.md', '/raw/tools.md', '/raw/tools/$1.md', '/raw/tools/$1.md'])
  })

  it('drops a dotted rule under the default catch-all pattern too', async () => {
    // `/**` does match `/llms.txt`, so `matchRoute` alone is not enough: a
    // dotted last segment is an asset, the same rule the runtime applies.
    const config = await setupModule({ routes: ['/', '/**'] }, routeRules)

    expect(config.cachedRoutes).not.toContain('/llms.txt')
    expect(config.cachedRoutes).not.toContain('/sitemap.xml')
    expect(config.cachedRoutes).toEqual(['/tools', '/tools/**'])
  })
})

describe('module setup: companion modules', () => {
  /** What Nuxt does with `@nuxtjs/seo`'s declarative `moduleDependencies`. */
  const installLate = (name: string) => (nuxt: FakeNuxt) => {
    nuxt.options._installedModules.push({ meta: { name } })
  }

  const robots = { robots: { aiPolicy: true, contentSignal: 'search=yes' } }

  it('serves `/robots.txt` itself when nothing else does', async () => {
    const nuxt = await runModule(robots)

    expect(nuxt.options.runtimeConfig.agentDiscoveryRobots).toEqual({ contentSignal: 'search=yes' })
    expect(nuxt.options.serverHandlers.some(handler => handler.route === '/robots.txt')).toBe(true)
  })

  it('leaves `/robots.txt` to a companion installed after `setup()`', async () => {
    // `@nuxtjs/seo` pulls `@nuxtjs/robots` in through `moduleDependencies`, so
    // it is invisible during this module's `setup()`. Registering a handler
    // then is dead code: the robots module wins the route at runtime, and its
    // `robots.txt` carries none of the agent groups.
    const nuxt = await runModule(robots, {}, installLate('@nuxtjs/robots'))

    expect(nuxt.options.runtimeConfig.agentDiscoveryRobots).toBeUndefined()
    expect(nuxt.options.serverHandlers.some(handler => handler.route === '/robots.txt')).toBe(false)
  })

  it('contributes to `robots:config` whenever that module ends up installed', async () => {
    // Registered in `setup()`, before detection can say either way: the robots
    // module fires this from its own `modules:done`, which runs first when a
    // site lists it first.
    const nuxt = await runModule(robots, {}, installLate('@nuxtjs/robots'))
    const config = { groups: [{ userAgent: ['*'], allow: [], disallow: [''], comment: [] }] }
    await nuxt.hooks.callHook('robots:config' as never, config as never)

    expect(config.groups[0]).toMatchObject({ userAgent: ['*'], contentSignal: ['search=yes'] })
    expect(config.groups.map(group => group.userAgent[0])).toContain('ClaudeBot')
  })

  it('excludes the raw twins through the sitemap module\'s own hook', async () => {
    // Not `nuxt.options.sitemap.exclude`: `@nuxtjs/sitemap` reads its options
    // during its own setup, so that only lands when a site happens to list
    // this module first.
    const nuxt = await runModule({}, {}, installLate('@nuxtjs/sitemap'))
    const plugins = nuxt.options.nitro.plugins || []

    expect(plugins.some(plugin => String(plugin).includes('plugins/sitemap'))).toBe(true)
  })

  it('warns instead of registering a dead `/robots.txt` behind another module', async () => {
    const nuxt = await runModule(robots, {}, (nuxt) => {
      nuxt.options.serverHandlers.push({ route: '/robots.txt', handler: '/somewhere/robots.ts' })
    })

    expect(nuxt.options.runtimeConfig.agentDiscoveryRobots).toBeUndefined()
    expect(nuxt.options.serverHandlers.filter(handler => handler.route === '/robots.txt')).toHaveLength(1)
  })

  it('adds no sitemap plugin when that module is not installed', async () => {
    const nuxt = await runModule()

    expect((nuxt.options.nitro.plugins || []).some(plugin => String(plugin).includes('plugins/sitemap'))).toBe(false)
  })

  it('resolves the MCP definitions for a toolkit installed after `setup()`', async () => {
    // Same `moduleDependencies` timing as the robots case. Deciding during
    // `setup()` left the alias on the stub, so the card went out listing no
    // tools rather than failing, which is the worse of the two.
    const nuxt = await runModule({}, {}, installLate('@nuxtjs/mcp-toolkit'))

    expect(nuxt.options.nitro.alias?.['#agent-discovery/mcp']).toContain('mcp/definitions')
    expect(nuxt.options.alias['#agent-discovery/mcp']).toContain('mcp/definitions')
  })

  it('keeps the MCP stub when the toolkit is not installed', async () => {
    const nuxt = await runModule()

    expect(nuxt.options.nitro.alias?.['#agent-discovery/mcp']).toContain('mcp/none')
  })

  it('keeps the MCP stub when the toolkit is installed but disabled', async () => {
    // It registers none of the virtual modules the definitions re-export
    // imports in that state, so aliasing them would fail the Nitro build.
    const nuxt = await runModule({}, {}, (nuxt) => {
      installLate('@nuxtjs/mcp-toolkit')(nuxt)
      Object.assign(nuxt.options, { mcp: { enabled: false } })
    })

    expect(nuxt.options.nitro.alias?.['#agent-discovery/mcp']).toContain('mcp/none')
  })
})

describe('module setup: sitemap.md exclusion', () => {
  const link = { href: '/sitemap.md', rel: 'sitemap', type: 'text/markdown', title: 'Sitemap' }

  it('excludes the path when the site serves `/sitemap.md` itself', async () => {
    // `sitemap.markdown` off, the route served by the site's own handler and
    // advertised through `discovery.links`. Without the exclusion the
    // negotiation middleware reads it as the `.md` twin of a page called
    // `/sitemap`, rewrites to `/raw/sitemap.md` and 404s.
    const config = await setupModule({ sitemap: { markdown: false }, discovery: { links: [link] } })

    expect(config.excludePrefixes).toContain('/sitemap.md')
  })

  it('still excludes it when the module owns the route', async () => {
    const config = await setupModule()

    expect(config.excludePrefixes.filter(prefix => prefix === '/sitemap.md')).toHaveLength(1)
  })

  it('leaves `/sitemap` negotiable when nothing serves a markdown sitemap', async () => {
    // No link, so a real page at `/sitemap` keeps its `.md` twin.
    const config = await setupModule({ sitemap: { markdown: false } })

    expect(config.excludePrefixes).not.toContain('/sitemap.md')
  })

  it('does not add it twice when the site already listed it', async () => {
    const config = await setupModule({ excludePrefixes: { replace: ['/_', '/sitemap.md'] } })

    expect(config.excludePrefixes.filter(prefix => prefix === '/sitemap.md')).toHaveLength(1)
  })
})

describe('module setup: content source', () => {
  it('points a site at the comark factory instead of guessing an instance', async () => {
    // A comark instance is per-site state: its sources, plugins, cache and,
    // in production, the commit it is pinned to. There is no instance the
    // module could construct, so the option is a dead end with directions
    // rather than a silent fallback to the `@nuxt/content` adapter.
    await expect(runModule({ source: 'comark' })).rejects.toThrow(/createComarkSource/)
  })

  it('aliases the comark factory whatever source a site configured', async () => {
    // Aliased unconditionally: the factory is imported by the site's own
    // adapter file, which the module resolves as an opaque path.
    const nuxt = await runModule({ source: '~~/server/agent-source' })

    expect(nuxt.options.nitro.alias?.['#agent-discovery/comark']).toMatch(/sources[\\/]comark$/)
    expect(nuxt.options.nitro.alias?.['#agent-discovery/source']).toMatch(/agent-source$/)
  })
})
