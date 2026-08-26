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
      modulesDir: [fileURLToPath(new URL('../../node_modules', import.meta.url))],
      modules: [],
      _installedModules: [{ meta: { name: '@nuxt/content' } }],
      _requiredModules: {},
      experimental: {},
      build: { templates: [] },
      nitro: {} as { plugins?: string[] },
      alias: {},
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
    const configured = await setupModule({ excludePrefixes: ['/_', '/api/', '/mcp', '/.well-known/', '/openapi.json'] })
    const plain = await setupModule()

    expect(configured.excludePrefixes).toContain('/openapi.json')
    // Exactly the defaults, so a second `/sitemap.md` cannot creep in either.
    expect(plain.excludePrefixes).toEqual([...EXCLUDE_PREFIXES, '/sitemap.md'])
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
})
