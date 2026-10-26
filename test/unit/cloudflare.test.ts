import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Nitro } from 'nitropack'
import { cloudflareRunWorkerFirst, isCloudflareWorkerPreset, setupCloudflarePreset } from '../../src/presets/cloudflare'
import { encodeAgentRoute, isNegotiablePath } from '../../src/runtime/shared/negotiation'
import type { NegotiationConfig } from '../../src/runtime/shared/types'

const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn() }))

vi.mock('@nuxt/kit', async importOriginal => ({
  ...await importOriginal<typeof import('@nuxt/kit')>(),
  useLogger: () => logger
}))

function createConfig(routes: string[] = ['/', '/**']): NegotiationConfig {
  return {
    siteUrl: 'https://example.com',
    siteName: 'Example',
    rawPrefix: '/raw',
    routes: routes.map(path => ({ path })),
    userAgents: ['ClaudeBot', 'GPTBot'],
    excludePrefixes: ['/_', '/api/', '/mcp', '/.well-known/'],
    links: [],
    linkHeader: true,
    cachedRoutes: [],
    sitemapSections: { expand: [], labels: {} },
    notAcceptable: false
  }
}

/**
 * The Workers Static Assets router: a `!/` rule hands the request to the
 * assets, then any other match runs the Worker. `*` matches anything, `/`
 * included (workers-shared, `generateStaticRoutingRuleMatcher`).
 */
function runsWorkerFirst(rules: string[], pathname: string): boolean {
  const matches = (rule: string) => new RegExp(`^${rule.split('*').map(part => part.replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&')).join('.*')}$`).test(pathname)
  if (rules.some(rule => rule.startsWith('!') && matches(rule.slice(1)))) {
    return false
  }
  return rules.some(rule => !rule.startsWith('!') && matches(rule))
}

/** What wrangler refuses to deploy (workers-shared, `parseStaticRouting`). */
function wranglerRefuses(rules: string[]): string[] {
  const refused: string[] = []
  if (rules.length > 100) {
    refused.push(`${rules.length} rules`)
  }
  for (const group of [rules.filter(rule => !rule.startsWith('!')), rules.filter(rule => rule.startsWith('!'))]) {
    for (const [index, rule] of group.entries()) {
      if (rule.length > 100 || group.indexOf(rule) !== index) {
        refused.push(rule)
      }
      for (const other of group) {
        if (rule.endsWith('*') && other !== rule && other.startsWith(rule.slice(0, -1))) {
          refused.push(`${other} under ${rule}`)
        }
      }
    }
  }
  return refused
}

describe('cloudflareRunWorkerFirst', () => {
  it('sends every negotiated page to the Worker, and hands the fingerprinted assets back', () => {
    const rules = cloudflareRunWorkerFirst(createConfig(), { assetBases: ['/_nuxt/'] })

    expect(rules).toEqual(['/*', '!/_nuxt/*'])
    expect(runsWorkerFirst(rules, '/')).toBe(true)
    expect(runsWorkerFirst(rules, '/docs/guide/')).toBe(true)
    expect(runsWorkerFirst(rules, '/_nuxt/entry.js')).toBe(false)
  })

  it('cuts a pattern at its first wildcard segment', () => {
    // No rule covers `/_nuxt/`, so there is nothing to hand back.
    expect(cloudflareRunWorkerFirst(createConfig(['/', '/docs/**', '/blog/*/comments']), { assetBases: ['/_nuxt/'] }))
      .toEqual(['/', '/docs/*', '/blog/*'])
  })

  it('gives an exact route the trailing-slash twin the asset layer redirects to', () => {
    expect(cloudflareRunWorkerFirst(createConfig(['/about', '/faq/']))).toEqual(['/about', '/about/', '/faq', '/faq/'])
  })

  it('matches the percent-encoded path the router reads', () => {
    expect(cloudflareRunWorkerFirst(createConfig(['/docs/café', '/blog/été/**']))).toEqual(['/docs/caf%C3%A9', '/docs/caf%C3%A9/', '/blog/%C3%A9t%C3%A9/*'])
  })

  it('writes the rules below `app.baseURL`', () => {
    expect(cloudflareRunWorkerFirst(createConfig(), { baseURL: '/base/', assetBases: ['/base/_nuxt/'] }))
      .toEqual(['/base', '/base/*', '!/base/_nuxt/*'])
  })

  it('keeps the site\'s own rules, less those wrangler would refuse next to these', () => {
    expect(cloudflareRunWorkerFirst(createConfig(), { assetBases: ['/_nuxt/'], current: ['/api/*', '!/api/public/*', '!/_nuxt/*'] }))
      .toEqual(['/*', '!/api/public/*', '!/_nuxt/*'])
    expect(cloudflareRunWorkerFirst(createConfig(['/docs/**']), { current: ['/docs/*', '/admin'] }))
      .toEqual(['/docs/*', '/admin'])
  })

  const configs = [
    ['/', '/**'],
    ['/', '/docs/**', '/docs'],
    ['/en', '/fr', '/en/**', '/fr/**', '/guide/*/intro'],
    ['/about', '/about/team', '/about/**', '/docs/café']
  ]

  it.each(configs)('gives wrangler a list it accepts (%#)', (...routes) => {
    expect(wranglerRefuses(cloudflareRunWorkerFirst(createConfig(routes), { assetBases: ['/_nuxt/'] }))).toEqual([])
  })

  it.each(configs)('runs the Worker first on every page the patterns negotiate (%#)', (...routes) => {
    const config = createConfig(routes)
    const rules = cloudflareRunWorkerFirst(config, { assetBases: ['/_nuxt/'] })
    const pages = ['/', '/about', '/about/', '/about/team', '/docs', '/docs/guide', '/docs/a/b/', '/docs/café', '/en', '/fr/', '/en/x', '/guide/v2/intro', '/blog/post']

    for (const page of pages.filter(page => isNegotiablePath(config, page))) {
      expect(runsWorkerFirst(rules, encodeAgentRoute(page)), page).toBe(true)
    }
  })
})

describe('setupCloudflarePreset', () => {
  beforeEach(() => {
    logger.info.mockClear()
    logger.warn.mockClear()
  })

  /** One `cloudflare-module` build: Nitro's `wrangler.json`, when given, then the module's `compiled` hook. */
  async function compile(options: { wrangler?: Record<string, unknown>, runWorkerFirst?: boolean, prerendered?: number, preset?: string, routes?: string[] } = {}) {
    const serverDir = mkdtempSync(join(tmpdir(), 'agent-discovery-cloudflare-'))
    const file = join(serverDir, 'wrangler.json')
    if (options.wrangler) {
      writeFileSync(file, JSON.stringify(options.wrangler))
    }
    const hooks: Record<string, () => Promise<void>> = {}
    const nitro = {
      options: {
        dev: false,
        static: false,
        preset: options.preset || 'cloudflare-module',
        baseURL: '/',
        publicAssets: [{ dir: '/build/client', baseURL: '/_nuxt/', maxAge: 31536000 }, { dir: '/public', fallthrough: true }],
        output: { serverDir }
      },
      hooks: { hook: (name: string, callback: () => Promise<void>) => { hooks[name] = callback } }
    }
    setupCloudflarePreset(nitro as unknown as Nitro, createConfig(options.routes), {
      runWorkerFirst: options.runWorkerFirst ?? true,
      prerendered: () => options.prerendered ?? 1
    })
    await hooks.compiled?.()
    return { hooked: Boolean(hooks.compiled), written: existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as { assets?: { run_worker_first?: unknown } } : undefined }
  }

  const generated = { main: 'index.mjs', assets: { binding: 'ASSETS', directory: '../public' } }

  it('writes the rules into the wrangler config Nitro generated', async () => {
    const { written } = await compile({ wrangler: generated })

    expect(written!.assets).toEqual({ binding: 'ASSETS', directory: '../public', run_worker_first: ['/*', '!/_nuxt/*'] })
  })

  it('merges the rules a site already has, and leaves `true` alone', async () => {
    expect((await compile({ wrangler: { assets: { ...generated.assets, run_worker_first: ['/admin', '!/static/*'] } }, routes: ['/docs/**'] })).written!.assets!.run_worker_first)
      .toEqual(['/admin', '/docs/*', '!/static/*'])
    expect((await compile({ wrangler: { assets: { ...generated.assets, run_worker_first: true } } })).written!.assets!.run_worker_first)
      .toBe(true)
  })

  it('names the rules when Nitro wrote no wrangler config', async () => {
    const { written } = await compile()

    expect(written).toBeUndefined()
    expect(logger.warn).toHaveBeenCalledOnce()
    expect(logger.warn.mock.calls[0]![0]).toContain('"run_worker_first": ["/*","!/_nuxt/*"]')
  })

  it('leaves the config as it is past what wrangler accepts', async () => {
    // Two rules per exact route: 51 of them make 102.
    const { written } = await compile({ wrangler: generated, routes: Array.from({ length: 51 }, (_, index) => `/page-${index}`) })

    expect(written!.assets).toEqual(generated.assets)
    expect(logger.warn.mock.calls[0]![0]).toContain('would need 102 rules')
  })

  it('is opt-in, and says so only when a prerendered page stays HTML', async () => {
    expect((await compile({ wrangler: generated, runWorkerFirst: false })).written).toEqual(generated)
    expect(logger.info).toHaveBeenCalledOnce()

    logger.info.mockClear()
    await compile({ wrangler: generated, runWorkerFirst: false, prerendered: 0 })
    // A site routing the Worker first on its own already negotiates them.
    await compile({ wrangler: { assets: { ...generated.assets, run_worker_first: ['/docs/*'] } }, runWorkerFirst: false })
    expect(logger.info).not.toHaveBeenCalled()
  })

  it('only runs for a Worker in front of Workers Static Assets', async () => {
    expect((await compile({ wrangler: generated, preset: 'cloudflare-pages' })).hooked).toBe(false)
    expect((await compile({ wrangler: generated, preset: 'node-server' })).hooked).toBe(false)
    expect(isCloudflareWorkerPreset('cloudflare-durable')).toBe(true)
    expect(isCloudflareWorkerPreset('cloudflare_module')).toBe(true)
    expect(isCloudflareWorkerPreset('cloudflare-module-legacy')).toBe(false)
  })
})
