import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { MARKDOWN_VARY } from './expected'

interface VercelRoute {
  src?: string
  dest?: string
  status?: number
  headers?: Record<string, string>
  has?: { type: string, key: string, value: string }[]
  missing?: { type: string, key: string, value: string }[]
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
  // A cached pattern redirects instead of rewriting, so it carries a
  // `Location` and no `dest`. Missing it here stopped the walk below early and
  // silently measured a shorter table than the module emitted.
  if (route.status === 307 && route.headers?.Location?.startsWith('/raw/')) {
    return true
  }
  // The opt-in 406, which answers a status and goes nowhere at all.
  if (route.status === 406) {
    return true
  }
  return route.continue === true && Boolean(route.headers?.Vary || route.headers?.Link)
}

/** Where a negotiated route sends the client, rewrite or redirect. */
function destinationOf(route: VercelRoute): string {
  return route.dest || route.headers?.Location || ''
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
  it('leads with two `continue: true` `Vary` routes', () => {
    // Nitro emits its own `routeRules` header routes after the rewrites and
    // without `continue`, so these have to come first to reach a request
    // rewritten to a prerendered raw markdown file.
    for (const route of [routes[0], routes[1]]) {
      expect(route).toBeDefined()
      expect(route!.continue).toBe(true)
      expect(route!.headers?.Vary).toBe(MARKDOWN_VARY)
      expect(route!.dest).toBeUndefined()
    }

    // The page, then the markdown representation it sends a client to. The
    // prerendered files are the reason this is a CDN route at all: they never
    // reach the handler that sets the header.
    expect(new RegExp(routes[0]!.src!).test('/docs/getting-started')).toBe(true)
    expect(new RegExp(routes[1]!.src!).test('/raw/index.md')).toBe(true)
    expect(new RegExp(routes[1]!.src!).test('/sitemap.md')).toBe(true)
  })

  it('refuses at the edge what the middleware refuses at the origin', () => {
    const refusal = routes.find(route => route.status === 406)

    // A prerendered page never reaches the middleware, so the option would
    // otherwise be on for the pages Nitro renders and off for the rest.
    expect(refusal).toBeDefined()
    expect(refusal!.dest).toBeUndefined()
    expect(new RegExp(refusal!.src!).test('/docs/getting-started')).toBe(true)
    expect(refusal!.has?.[0]?.key).toBe('accept')
    expect(refusal!.missing?.map(entry => entry.key)).toEqual(['accept', 'sec-fetch-mode', 'user-agent'])
  })

  it('emits a `continue: true` `Link` route on the homepage', () => {
    const linkRoute = routes.find(route => route.src === '^/$' && route.continue === true)

    expect(linkRoute).toBeDefined()
    expect(linkRoute!.headers?.Link).toContain('</llms.txt>; rel="describedby"; type="text/plain"')
    expect(linkRoute!.headers?.Link).toContain('</>; rel="alternate"; type="text/markdown"')
  })

  it('negotiates on the `Accept` header', () => {
    // The 406 matches on `Accept` too, but to refuse rather than to resolve a
    // twin, so it is not one of the routes this asserts about.
    const acceptRoutes = routes.filter(route => route.status !== 406
      && route.has?.some(has => has.type === 'header' && has.key === 'accept'))

    expect(acceptRoutes.length).toBeGreaterThanOrEqual(2)
    for (const route of acceptRoutes) {
      // A rewrite on an uncached pattern, a redirect on a cached one. Either
      // way it resolves to the raw prefix, and a rewrite looks the destination
      // up on the filesystem first.
      expect(destinationOf(route)).toMatch(/^\/raw\//)
      expect(route.dest ? route.check : route.status).toBeTruthy()

      // The matcher has to agree with `acceptsMarkdown`, which means matching a
      // media range rather than the string anywhere in the header.
      const value = route.has!.find(has => has.key === 'accept')!.value
      const accepts = (header: string) => new RegExp(`^(?:${value})$`).test(header)
      expect(accepts('text/markdown')).toBe(true)
      expect(accepts('text/html, text/markdown')).toBe(true)
      expect(accepts('text/html;profile="text/markdown"')).toBe(false)

      // A client that explicitly refused markdown is excluded, whitespace
      // before the delimiter included: RFC 9110 allows it and a real edge
      // served markdown without this.
      const refuses = (header: string) => new RegExp(`^(?:${route.missing![0]!.value})$`).test(header)
      expect(refuses('text/markdown;q=0')).toBe(true)
      expect(refuses('text/markdown;q=0 , text/html')).toBe(true)
      expect(refuses('text/markdown;q=0.5')).toBe(false)
    }
  })

  it('negotiates on a known agent `User-Agent`', () => {
    const agentRoutes = routes.filter(route => route.has?.some(has => has.type === 'header' && has.key === 'user-agent'))

    expect(agentRoutes.length).toBeGreaterThanOrEqual(2)
    for (const route of agentRoutes) {
      expect(destinationOf(route)).toMatch(/^\/raw\//)
      expect(route.dest ? route.check : route.status).toBeTruthy()

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

  // The property is that the table is a function of the configured patterns and
  // the cached rules, not of how many pages the site has. The fixture has five
  // content pages; the closed form below never mentions them.
  it('keeps the table O(patterns)', () => {
    let count = 0
    while (routes[count] && isModuleRoute(routes[count]!)) {
      count++
    }

    const patterns = 2 // `routes: ['/', '/**']`
    const exact = 1 // `/`
    const cachedRules = 2 // `/docs/components/**`, plus `/docs/late/**` from `nitro:config`
    const headerRoutes = 3 // `Vary` on the pages, `Vary` on the markdown twins, `Link`
    const canonicalLinks = 3 // canonical/alternate per twin space: two for `/**`, one for `/`
    const refusals = 1 // `notAcceptable: true` in the fixture
    // Per pattern: an `Accept` route and a User-Agent route, plus a `.md` alias
    // for a wildcard. Per cached rule narrower than the pattern over it: its own
    // redirect pair.
    expect(count).toBe(headerRoutes + canonicalLinks + refusals + patterns * 2 + (patterns - exact) + cachedRules * 2)
  })

  // The cache-correctness path, asserted against real emitted output rather
  // than the pure function, because the module has to read the site's route
  // rules to know the section is cached at all.
  it('redirects the cached section and rewrites everything else', () => {
    const cached = routes.filter(route => route.status === 307)
    expect(cached).toHaveLength(4)

    const components = cached.filter(route => route.headers?.Location === '/raw/docs/components/$1.md')
    expect(components).toHaveLength(2)
    for (const route of components) {
      expect(route.headers?.Vary).toBe(MARKDOWN_VARY)
      expect(route.dest).toBeUndefined()
      expect(new RegExp(route.src!).test('/docs/components/button')).toBe(true)
      expect(new RegExp(route.src!).test('/docs/getting-started')).toBe(false)
    }
    expect(components.map(route => route.has?.[0]?.key)).toEqual(['accept', 'user-agent'])

    // The catch-all is untouched by the narrower rules.
    const catchAll = routes.filter(route => route.dest === '/raw/$1.md' && route.has)
    expect(catchAll).toHaveLength(2)
    expect(catchAll.every(route => route.check && !route.status)).toBe(true)
  })

  // The rule arrives through a companion module's `nitro:config` hook, so it
  // exists only on Nitro's own table. Missing it emitted a URL-preserving
  // rewrite onto a cached route, which poisons a path-keyed response cache.
  it('redirects a section cached through `nitro:config`', () => {
    const late = routes.filter(route => route.headers?.Location === '/raw/docs/late/$1.md')

    expect(late).toHaveLength(2)
    expect(late.every(route => route.status === 307)).toBe(true)
    expect(late.map(route => route.has?.[0]?.key)).toEqual(['accept', 'user-agent'])
  })

  it('labels the prerendered twins with their canonical page', () => {
    // The raw handler sets this pair, but a prerendered twin never reaches
    // it, so the table has to carry the header for the CDN-answered files.
    const linkRoutes = routes.filter(route => route.continue && route.headers?.Link?.includes('rel="canonical"'))
    expect(linkRoutes.length).toBeGreaterThanOrEqual(3)

    const twin = linkRoutes.find(route => new RegExp(route.src!).test('/raw/docs/getting-started.md'))
    expect(twin).toBeDefined()
    const link = '/raw/docs/getting-started.md'.replace(new RegExp(twin!.src!), twin!.headers!.Link!)
    expect(link).toContain('<https://basic.example.com/docs/getting-started>; rel="canonical"')
    expect(link).toContain('rel="alternate"; type="text/html"')
  })

  it('prerenders the homepage raw markdown into the static output', () => {
    expect(existsSync(`${outputDir}static/raw/index.md`)).toBe(true)
    expect(existsSync(`${outputDir}static/sitemap.md`)).toBe(true)
    expect(existsSync(`${outputDir}static/llms.txt`)).toBe(true)
  })
})
