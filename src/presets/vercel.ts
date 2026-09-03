import { resolve } from 'pathe'
import { readFile, writeFile } from 'node:fs/promises'
import type { Nitro } from 'nitropack'
import { compilePattern, encodeAgentRoute, formatLinkHeader, isRawPath, matchRoute, patternsOverlap, rawDestination, ruleCoversPattern, MARKDOWN_VARY } from '../runtime/shared/negotiation'
import type { NegotiationConfig } from '../runtime/shared/types'

export interface VercelRoute {
  src: string
  /** Rewrite destination. Mutually exclusive with `status` + `headers.Location`. */
  dest?: string
  /** Redirect status, for the cached-route strategy below. */
  status?: number
  headers?: Record<string, string>
  has?: RouteMatcher[]
  /** Negated matchers: the route applies only when none of them match. */
  missing?: RouteMatcher[]
  /** Methods the route applies to; absent means every method. */
  methods?: string[]
  check?: boolean
  continue?: boolean
}

/** The negotiation middleware only answers GET/HEAD, so every emitted route carries the same restriction. */
const METHODS = ['GET', 'HEAD']

interface RouteMatcher {
  type: string
  key: string
  value: string
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Vercel matches `src` against the percent-encoded request path while the
 * config spells routes decoded. Wildcards survive the encoder untouched.
 */
const escapeEncoded = (path: string) => escapeRegExp(encodeAgentRoute(path))

/**
 * `Accept` values that refuse markdown with `q=0`, used as a `missing` matcher
 * because a regex over the raw header cannot express "markdown, but not at
 * q=0". `[qQ]` since only `src` documents `caseSensitive`, `(\.0+)?` to keep a
 * real `q=0.05` out, and the space before the boundary since RFC 9110 allows
 * one around a list separator.
 */
const REFUSES_MARKDOWN = String.raw`.*text/markdown\s*;\s*[qQ]=0(\.0+)?(\s*[;,].*)?`

/** A media range half: a non-empty RFC 9110 token, which `*` is one of. */
const TOKEN = String.raw`[a-z0-9!#$%&'*+.^_|~-]+`

/**
 * `Accept` values leaving a negotiated page something to serve, as the
 * `missing` matcher for the 406 route. Anchored at media-range boundaries, and
 * a comma inside a quoted value must not split the header, since a bare
 * substring matches inside a parameter value too. It ranks no q-values, so a
 * range refused with `q=0` reads as offered and the edge serves the page.
 */
const ACCEPTS_A_REPRESENTATION = String.raw`(([^"]|"[^"]*")*,)?\s*(text/(html|markdown|\*)|\*/\*)\s*([;,].*)?`

/**
 * An `Accept` carrying at least one media range. Both halves have to be there:
 * the runtime ignores a mangled range like `text/` rather than refusing over
 * it, and a looser test would 406 at the edge what the origin serves.
 */
const ANY_MEDIA_RANGE = String.raw`(.*,)?\s*${TOKEN}/${TOKEN}\s*([;,].*)?`

/**
 * `has` matcher for the user agent, which the Build Output API anchors.
 * Case-folded letter by letter because only `src` documents `caseSensitive`.
 */
function agentUserAgentPattern(config: NegotiationConfig): string {
  const fold = (value: string) => value.replace(/[a-z]/gi, letter => `[${letter.toLowerCase()}${letter.toUpperCase()}]`)
  return `.*(${config.userAgents.map(agent => fold(escapeRegExp(agent))).join('|')}).*`
}

/** Pattern wildcards replaced by their capture references: `/docs/**` → `/docs/$1`. */
function patternDest(pattern: string): string {
  let capture = 0
  return pattern.replace(/\*\*|\*/g, () => `$${++capture}`)
}

/** Keeps the excluded prefixes out of a wildcard match, mirroring the runtime's exclusion check. */
function excludeLookahead(config: NegotiationConfig): string {
  const prefixes = [`${config.rawPrefix}/`, ...config.excludePrefixes].map(escapeEncoded)
  return `(?!${prefixes.join('|')})`
}

/** The runtime's dotted-asset rule: a dot in the last segment means asset, `/docs/3.x/` stays negotiable. */
const NO_DOTTED_LAST_SEGMENT = String.raw`(?!.*\.[^/]*$)`

/**
 * One negotiated route: a rewrite on a prerendered page, a 307 on a cached one.
 * A rewrite keeps the page URL, but a response cache keyed on the request path
 * alone ignores `Vary`, so rewriting an `isr`/`swr` page would let its HTML and
 * markdown variants overwrite each other under one key. `Location` carries no
 * query of its own, since the CDN re-attaches the incoming one.
 */
function negotiatedRoute(src: string, dest: string, has: RouteMatcher[], cached: boolean, missing?: RouteMatcher[]): VercelRoute {
  if (cached) {
    return { src, status: 307, headers: { Location: dest, Vary: MARKDOWN_VARY }, has, ...(missing ? { missing } : {}), methods: METHODS }
  }
  // `check: true` looks the destination up in the filesystem, where prerendered raw files live.
  return { src, dest, has, ...(missing ? { missing } : {}), methods: METHODS, check: true }
}

/**
 * Routes prepended to `.vercel/output/config.json` (Build Output API v3) to
 * serve markdown through content negotiation at the edge, where prerendered
 * pages never reach Nitro. One entry per route pattern, never one per page.
 *
 * The two `Vary` routes come first and carry `continue: true`: Nitro emits its
 * own `routeRules` header routes after these and without `continue`, so they
 * never run for a request that gets rewritten to a prerendered file.
 */
export function vercelMarkdownRoutes(config: NegotiationConfig): VercelRoute[] {
  // Anchored at a media-range boundary: a bare substring also matches inside a
  // parameter value, so `Accept: text/html;profile="text/markdown"` reads as markdown.
  const acceptMarkdown = { type: 'header', key: 'accept', value: String.raw`(.*,)?\s*text/markdown\s*([;,].*)?` }
  // Only on the `Accept` routes: a known agent gets markdown whatever its `Accept` says.
  const refusesMarkdown = [{ type: 'header', key: 'accept', value: REFUSES_MARKDOWN }]
  // An empty list has no matcher: `.*().*` matches every user agent there is.
  const agentUserAgent = config.userAgents.length
    ? { type: 'header', key: 'user-agent', value: agentUserAgentPattern(config) }
    : undefined
  const excluded = excludeLookahead(config)

  const routes: VercelRoute[] = []

  /** The `Accept` route, then the agent one, which a site with no user agents left does without. */
  const pushNegotiated = (src: string, dest: string, cached: boolean) => {
    routes.push(negotiatedRoute(src, dest, [acceptMarkdown], cached, refusesMarkdown))
    if (agentUserAgent) {
      routes.push(negotiatedRoute(src, dest, [agentUserAgent], cached))
    }
  }

  // Tell CDNs the response depends on `Accept` / `User-Agent`, then keep routing.
  // The dotted-segment lookahead keeps this off single-representation documents
  // like `/llms.txt`, whose shared cache would fragment per user agent.
  const varySources = config.routes.map(route => compilePattern(encodeAgentRoute(route.path)).source.slice(1, -1))
  routes.push({
    src: `^${NO_DOTTED_LAST_SEGMENT}${excluded}(?:${varySources.join('|')})$`,
    headers: { Vary: MARKDOWN_VARY },
    methods: METHODS,
    continue: true
  })

  // The markdown representations themselves. A prerendered file never reaches
  // the handler that sets the header, and a negotiated page rewrites or 307s to
  // one of these, so the pair has to carry `Vary` end to end.
  const twinSources = config.routes.flatMap((route) => {
    if (route.path.includes('*')) {
      return [`${excluded}${compilePattern(encodeAgentRoute(route.path)).source.slice(1, -1)}\\.md`]
    }
    // `/` has no `.md` twin URL, matching the rewrite loop below.
    return route.path === '/' ? [] : [`${escapeEncoded(route.path)}\\.md`]
  })
  // Keyed on the registered link, not on this module serving the route: a site
  // serving its own `/sitemap.md` through `discovery.links` needs the label too.
  const markdownSources = [
    `${escapeEncoded(config.rawPrefix)}/.*`,
    ...twinSources,
    ...(config.links.some(link => link.href === '/sitemap.md') ? [String.raw`/sitemap\.md`] : [])
  ]
  routes.push({
    src: `^(?:${markdownSources.join('|')})$`,
    headers: { Vary: MARKDOWN_VARY },
    methods: METHODS,
    continue: true
  })

  // The canonical/alternate pair the raw handler sets, for prerendered twins the
  // CDN answers off the filesystem. The value embeds the page URL, so it needs a
  // configured site URL: the edge cannot know the request host at build time.
  // Absent from the page rewrites, whose URLs also serve HTML.
  if (config.siteUrl) {
    const canonicalLink = (href: string) => formatLinkHeader([
      { href, rel: 'canonical' },
      { href, rel: 'alternate', type: 'text/html' }
    ])
    // Twins with a static entry of their own: exact patterns whose raw
    // destination sits under `rawPrefix`, plus the root twin, whose wildcard
    // capture would otherwise mis-derive the page as `/index`.
    const isRaw = (raw: string) => isRawPath(config, raw)
    const rootTwin = `${config.rawPrefix}/index.md`
    const statics: { raw: string, href: string }[] = []
    for (const route of config.routes) {
      if (route.path.includes('*')) {
        continue
      }
      const raw = rawDestination(config, route, route.path)
      // Two exact routes can name the same twin, `/` and `/index` both mapping to
      // the root one: one entry per `src`, or two conflicting headers.
      if (!isRaw(raw) || statics.some(entry => entry.raw === raw)) {
        continue
      }
      // The origin folds a trailing `/index` into the directory it indexes, so
      // `/docs/index`'s twin advertises `/docs`, the URL that answers.
      const page = route.path.endsWith('/index') ? route.path.slice(0, -6) || '/' : route.path
      statics.push({ raw, href: page === '/' || raw === rootTwin ? config.siteUrl : `${config.siteUrl}${encodeAgentRoute(page)}` })
    }
    if (!statics.some(entry => entry.raw === rootTwin)) {
      // `/raw/index.md` folds to `/` at the origin whatever the patterns say, so
      // the wildcard capture must never read it as `/index`.
      statics.push({ raw: rootTwin, href: config.siteUrl })
    }
    // The wildcard capture must not also match a statically-mapped twin.
    const rawExclusion = statics.length ? `(?!(?:${statics.map(entry => escapeEncoded(entry.raw.slice(config.rawPrefix.length))).join('|')})$)` : ''
    // A trailing `/index` folds away at the origin, so a capture reading
    // `/docs/index.md` would advertise a page URL the handler never serves.
    const noIndex = String.raw`(?!.*/index\.md$)`
    for (const route of config.routes) {
      if (route.path.includes('*')) {
        const body = compilePattern(encodeAgentRoute(route.path)).source.slice(1, -1)
        const link = canonicalLink(`${config.siteUrl}${patternDest(encodeAgentRoute(route.path))}`)
        routes.push({ src: `^${excluded}${noIndex}${body}\\.md$`, headers: { Link: link }, methods: METHODS, continue: true })
        routes.push({ src: `^${escapeEncoded(config.rawPrefix)}${rawExclusion}${noIndex}${body}\\.md$`, headers: { Link: link }, methods: METHODS, continue: true })
      } else if (route.path !== '/' && !route.path.endsWith('/index') && isRaw(rawDestination(config, route, route.path))) {
        // An index-shaped exact path folds the same way, so its twin gets no entry.
        routes.push({ src: `^${escapeEncoded(route.path)}\\.md$`, headers: { Link: canonicalLink(`${config.siteUrl}${encodeAgentRoute(route.path)}`) }, methods: METHODS, continue: true })
      }
    }
    for (const entry of statics) {
      routes.push({ src: `^${escapeEncoded(entry.raw)}$`, headers: { Link: canonicalLink(entry.href) }, methods: METHODS, continue: true })
    }
  }

  // Opt-in: a negotiated page has exactly two representations, so an `Accept`
  // allowing neither is a 406 per RFC 9110. Emitted here as well as in the
  // middleware because a prerendered page never reaches it, which would leave
  // the option on for the pages Nitro renders and off for the rest of the site.
  if (config.notAcceptable) {
    routes.push({
      src: `^${NO_DOTTED_LAST_SEGMENT}${excluded}(?:${varySources.join('|')})$`,
      status: 406,
      headers: { Vary: MARKDOWN_VARY },
      has: [{ type: 'header', key: 'accept', value: ANY_MEDIA_RANGE }],
      missing: [
        { type: 'header', key: 'accept', value: ACCEPTS_A_REPRESENTATION },
        { type: 'header', key: 'sec-fetch-mode', value: 'navigate' },
        ...(agentUserAgent ? [agentUserAgent] : [])
      ],
      methods: METHODS
    })
  }

  // The `/` routeRule carries the same `Link` header, but a homepage request
  // rewritten below never reaches it. Method-agnostic like the rule it stands in for.
  const linkHeader = config.linkHeader ? formatLinkHeader(config.links) : ''
  if (linkHeader) {
    routes.push({
      src: '^/$',
      headers: { Link: linkHeader },
      continue: true
    })
  }

  // Whether a rule covers a whole pattern, so the pattern itself is demoted to a redirect.
  const patternCached = (pattern: string) => config.cachedRoutes.some(rule => ruleCoversPattern(rule, pattern))

  // A cached rule narrower than the pattern covering it, `routeRules['/docs/**']`
  // under the default `/**`, gets its own 307 pair ahead of that pattern's
  // rewrite. Marking the whole pattern cached would demote every page on the site.
  for (const rule of config.cachedRoutes) {
    // An exact rule is only negotiable through the route it matches: without one
    // there is no twin, and an invented `rawPrefix + rule + '.md'` 307s to a 404.
    const wildcard = rule.includes('*')
    const matched = wildcard ? undefined : matchRoute(config.routes, rule)

    // This loop handles what a rule caches beyond the patterns it fully covers,
    // which are demoted wholesale below, or a path collects two redirects.
    if (wildcard) {
      if (!config.routes.some(route => patternsOverlap(rule, route.path) && !patternCached(route.path))) {
        continue
      }
    } else if (!matched || patternCached(matched.path)) {
      continue
    }

    const src = wildcard
      ? `^${NO_DOTTED_LAST_SEGMENT}${excluded}${compilePattern(encodeAgentRoute(rule)).source.slice(1, -1)}$`
      : `^${escapeEncoded(rule)}$`
    const dest = matched
      ? encodeAgentRoute(rawDestination(config, matched, rule))
      : `${encodeAgentRoute(config.rawPrefix)}${patternDest(encodeAgentRoute(rule))}.md`

    pushNegotiated(src, dest, true)
  }

  for (const route of config.routes) {
    // Cached only when a rule covers the pattern itself; a narrower rule was
    // handled above. The `.md` twins stay rewrites: that URL serves one variant.
    const cached = patternCached(route.path)

    if (route.path.includes('*')) {
      const body = compilePattern(encodeAgentRoute(route.path)).source.slice(1, -1)
      const dest = `${encodeAgentRoute(config.rawPrefix)}${patternDest(encodeAgentRoute(route.path))}.md`
      routes.push({
        src: `^${excluded}${body}\\.md$`,
        dest,
        methods: METHODS
      })
      pushNegotiated(`^${NO_DOTTED_LAST_SEGMENT}${excluded}${body}$`, dest, cached)
    } else {
      const dest = encodeAgentRoute(rawDestination(config, route, route.path))
      if (route.path !== '/') {
        routes.push({ src: `^${escapeEncoded(route.path)}\\.md$`, dest, methods: METHODS })
      }
      // The same two guards as the wildcard branch: `/faq.html` reads as an asset
      // and `/mcp` sits behind an excluded prefix, both refused by the runtime.
      pushNegotiated(`^${NO_DOTTED_LAST_SEGMENT}${excluded}${escapeEncoded(route.path)}/?$`, dest, cached)
    }
  }

  return routes
}

/**
 * Patches the Vercel Build Output config after Nitro compiles. We edit
 * `.vercel/output/config.json` (Build Output API v3), not `vercel.json`, which
 * has a different schema. https://vercel.com/docs/build-output-api/configuration
 */
export function setupVercelPreset(nitro: Nitro, config: NegotiationConfig, collectCachedRoutes?: (routeRules: Nitro['options']['routeRules']) => void) {
  // `nuxt generate` resolves the `vercel-static` preset, whose name contains
  // "vercel" but which emits no function routes to fall through to.
  if (nitro.options.dev || nitro.options.static || !nitro.options.preset.includes('vercel')) {
    return
  }
  // The emitted table injects the `Link` pair on the raw twins, so the raw
  // handler has to skip its own copy or every origin-rendered raw response
  // carries it twice. Set on Nitro's copy: the module-scope one was cloned away.
  if (config.siteUrl) {
    const runtime = nitro.options.runtimeConfig.agentDiscovery as NegotiationConfig | undefined
    if (runtime) {
      runtime.cdnLinkPairs = true
    }
  }
  nitro.hooks.hook('compiled', async () => {
    // The last read of the rule table before it decides rewrite or 307: an
    // inline `defineRouteRules({ isr })` only lands on it during the Nuxt build,
    // after every module hook has run.
    collectCachedRoutes?.(nitro.options.routeRules)
    const vcJSON = resolve(nitro.options.output.dir, 'config.json')
    const vcConfig = JSON.parse(await readFile(vcJSON, 'utf8'))
    vcConfig.routes.unshift(...vercelMarkdownRoutes(config))
    await writeFile(vcJSON, JSON.stringify(vcConfig, null, 2), 'utf8')
  })
}
