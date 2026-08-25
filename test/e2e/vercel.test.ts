import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { MARKDOWN_VARY } from './expected'

interface VercelRoute {
  src?: string
  dest?: string
  headers?: Record<string, string>
  has?: { type: string, key: string, value: string }[]
  check?: boolean
  continue?: boolean
  handle?: string
}

const fixtureDir = fileURLToPath(new URL('../fixtures/basic', import.meta.url))
const nuxi = fileURLToPath(new URL('../../node_modules/.bin/nuxi', import.meta.url))
const outputDir = fileURLToPath(new URL('../fixtures/basic/.vercel/output/', import.meta.url))

/**
 * A route the module unshifted onto the Build Output table: either a
 * `continue: true` header route or a rewrite into the raw markdown prefix.
 * They all sit at the front of `routes`, ahead of Nitro's own entries.
 */
function isModuleRoute(route: VercelRoute): boolean {
  if (route.dest?.startsWith('/raw/')) {
    return true
  }
  return route.continue === true && Boolean(route.headers?.Vary || route.headers?.Link)
}

let routes: VercelRoute[] = []

/**
 * One full `NITRO_PRESET=vercel` build of the `basic` fixture. Building twice
 * would double the slowest part of the suite, so every assertion below reads
 * the same `.vercel/output`.
 *
 * `vitest.config.ts` disables file parallelism: this build shares `.nuxt` with
 * the fixture the other e2e suites boot.
 */
beforeAll(() => {
  const build = spawnSync(nuxi, ['build'], {
    cwd: fixtureDir,
    env: { ...process.env, NITRO_PRESET: 'vercel' },
    encoding: 'utf8',
    timeout: 300000
  })

  if (build.status !== 0) {
    throw new Error(`nuxi build (vercel) failed with status ${build.status}\n${build.stdout}\n${build.stderr}`)
  }

  const config = JSON.parse(readFileSync(`${outputDir}config.json`, 'utf8')) as { version: number, routes: VercelRoute[] }
  expect(config.version).toBe(3)
  routes = config.routes
}, 300000)

describe('vercel build output', () => {
  it('leads with a `continue: true` `Vary` route', () => {
    expect(routes[0]).toBeDefined()
    expect(routes[0]!.continue).toBe(true)
    expect(routes[0]!.headers?.Vary).toBe(MARKDOWN_VARY)
    // Nitro emits its own `routeRules` header routes after the rewrites and
    // without `continue`, so this one has to come first to reach a request
    // rewritten to a prerendered raw markdown file.
    expect(routes[0]!.dest).toBeUndefined()
  })

  it('emits a `continue: true` `Link` route on the homepage', () => {
    const linkRoute = routes.find(route => route.src === '^/$' && route.continue === true)

    expect(linkRoute).toBeDefined()
    expect(linkRoute!.headers?.Link).toContain('</llms.txt>; rel="describedby"; type="text/plain"')
    expect(linkRoute!.headers?.Link).toContain('</>; rel="alternate"; type="text/markdown"')
  })

  it('rewrites on the `Accept` header', () => {
    const acceptRoutes = routes.filter(route => route.has?.some(has => has.type === 'header' && has.key === 'accept'))

    expect(acceptRoutes.length).toBeGreaterThanOrEqual(2)
    for (const route of acceptRoutes) {
      expect(route.dest).toMatch(/^\/raw\//)
      expect(route.check).toBe(true)
      expect(route.has!.find(has => has.key === 'accept')!.value).toContain('text/markdown')
    }
  })

  it('rewrites on a known agent `User-Agent`', () => {
    const agentRoutes = routes.filter(route => route.has?.some(has => has.type === 'header' && has.key === 'user-agent'))

    expect(agentRoutes.length).toBeGreaterThanOrEqual(2)
    for (const route of agentRoutes) {
      expect(route.dest).toMatch(/^\/raw\//)
      expect(route.check).toBe(true)

      const pattern = route.has!.find(has => has.key === 'user-agent')!.value
      expect(pattern).toContain('ClaudeBot')
      expect(pattern).toContain('GPTBot')
      // The bot list must be the shared one, not a `curl`-only match.
      expect(new RegExp(pattern).test('Mozilla/5.0 (compatible; ClaudeBot/1.0)')).toBe(true)
    }
  })

  it('rewrites the explicit `.md` twin URLs without a header matcher', () => {
    const twin = routes.find(route => route.dest?.startsWith('/raw/') && !route.has)

    expect(twin).toBeDefined()
    expect(twin!.src).toContain('\\.md$')
  })

  it('keeps the table O(patterns)', () => {
    let count = 0
    while (routes[count] && isModuleRoute(routes[count]!)) {
      count++
    }

    // `routes: ['/', '/**']` → 2 header routes + 2 exact + 3 glob.
    expect(count).toBe(7)
    expect(count).toBeLessThanOrEqual(12)
  })

  it('prerenders the homepage raw markdown into the static output', () => {
    expect(existsSync(`${outputDir}static/raw/index.md`)).toBe(true)
    expect(existsSync(`${outputDir}static/sitemap.md`)).toBe(true)
    expect(existsSync(`${outputDir}static/llms.txt`)).toBe(true)
  })
})
