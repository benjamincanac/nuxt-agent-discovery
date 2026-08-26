import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { nuxtCtx } from '@nuxt/kit'
import module from '../../src/module'
import { AGENT_USER_AGENTS, EXCLUDE_PREFIXES } from '../../src/defaults'
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
function createNuxt() {
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
      nitro: {},
      alias: {},
      serverHandlers: [],
      routeRules: {},
      runtimeConfig: { public: {} } as Record<string, unknown> & { public: Record<string, unknown> }
    }
  }
}

/** One full module setup, resolved through to the config the runtime reads. */
async function setupModule(options: Partial<ModuleOptions> = {}): Promise<NegotiationConfig> {
  const nuxt = createNuxt()
  // `set`, not `callAsync`: unctx only restores an async context in code the
  // Nuxt transform has processed, and this file is plain vitest.
  nuxtCtx.set(nuxt as never, true)
  try {
    await (module as unknown as (options: Partial<ModuleOptions>, nuxt: unknown) => Promise<unknown>)(options, nuxt)
    await nuxt.hooks.callHook('modules:done' as never)
  } finally {
    nuxtCtx.unset()
  }
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
