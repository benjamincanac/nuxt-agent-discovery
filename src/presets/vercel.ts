import { resolve } from 'pathe'
import { readFile, writeFile } from 'node:fs/promises'
import type { Nitro } from 'nitropack'
import { compilePattern, formatLinkHeader, matchRoute, patternsOverlap, rawDestination, ruleCoversPattern, MARKDOWN_VARY } from '../runtime/shared/negotiation'
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
  check?: boolean
  continue?: boolean
}

interface RouteMatcher {
  type: string
  key: string
  value: string
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * `Accept` values that explicitly refuse markdown, as an anchored pattern: a
 * `text/markdown` range carrying `q=0`, with or without trailing zeroes, and
 * whatever follows it.
 *
 * The negotiation core reads q-values per RFC 9110, so the Nitro middleware
 * serves HTML for `Accept: text/markdown;q=0, text/html`. A CDN matcher is a
 * plain regex over the raw header, with no way to express "markdown, but not at
 * q=0" as a positive match. A `missing` matcher says it directly: the rewrite
 * applies only when this does not match. Confirmed against a real Vercel edge,
 * which anchors the value and matches it case-insensitively.
 *
 * `q=0.5` and friends must not match, hence the `(\.0+)?` rather than a loose
 * tail, and the boundary that follows keeps `q=0.05` (a real quality) out. The
 * whitespace before that boundary is load-bearing: RFC 9110 allows spaces
 * around a list separator, and without it `text/markdown;q=0 , text/html` was
 * served markdown by the edge after explicitly refusing it.
 */
const REFUSES_MARKDOWN = String.raw`.*text/markdown\s*;\s*[qQ]=0(\.0+)?(\s*[;,].*)?`

/** A media range half: a non-empty RFC 9110 token, which `*` is one of. */
const TOKEN = String.raw`[a-z0-9!#$%&'*+.^_|~-]+`

/**
 * `Accept` values leaving a negotiated page something to serve: a `text/html`
 * or `text/markdown` range, or a wildcard covering one of them.
 *
 * The `missing` matcher for the 406 route, so the page is refused only when
 * this does not match. Anchored at media-range boundaries the same way
 * `acceptMarkdown` is, and for the same reason: a bare substring also matches
 * inside a parameter value, so `Accept: application/json;profile="text/html"`
 * read as offering HTML when the only range in it is JSON.
 *
 * Still not the q-value ranking the runtime does, because a matcher is a plain
 * regex over the raw header. A representation offered and then refused with
 * `q=0` reads as offered here, so the edge serves the page where the origin
 * answers 406. That is the fail-safe direction, and the one this route wants
 * above all others.
 */
const ACCEPTS_A_REPRESENTATION = String.raw`(.*,)?\s*(text/(html|markdown|\*)|\*/\*)\s*([;,].*)?`

/**
 * An `Accept` carrying at least one media range, however unacceptable.
 *
 * Both halves have to be there: `text/`, `/html` and `text/html/extra` are
 * mangled rather than unacceptable, and the runtime ignores those rather than
 * refusing over them. A looser test here would 406 at the edge what the origin
 * serves, which is the one divergence this route cannot have.
 */
const ANY_MEDIA_RANGE = String.raw`(.*,)?\s*${TOKEN}/${TOKEN}\s*([;,].*)?`

/** `has` matcher for the Vercel Build Output API, which anchors the value. */
function agentUserAgentPattern(config: NegotiationConfig): string {
  return `.*(${config.userAgents.map(escapeRegExp).join('|')}).*`
}

/** Pattern wildcards replaced by their capture references: `/docs/**` → `/docs/$1`. */
function patternDest(pattern: string): string {
  let capture = 0
  return pattern.replace(/\*\*|\*/g, () => `$${++capture}`)
}

/**
 * Negative lookahead keeping the excluded prefixes out of a wildcard match,
 * mirroring the runtime's exclusion check.
 */
function excludeLookahead(config: NegotiationConfig): string {
  const prefixes = [`${config.rawPrefix}/`, ...config.excludePrefixes].map(escapeRegExp)
  return `(?!${prefixes.join('|')})`
}

/**
 * Mirrors the runtime's dotted-asset rule: a dot anywhere in the last path
 * segment means asset, while mid-path dots (`/docs/3.x/...`) stay negotiable.
 */
const NO_DOTTED_LAST_SEGMENT = String.raw`(?!.*\.[^/]*$)`

/**
 * One negotiated route: a rewrite on a prerendered page, a 307 on a cached one.
 *
 * A rewrite keeps the page URL, which is the whole point of doing this at the
 * CDN rather than redirecting like every other implementation does. It is only
 * safe when the destination is a prerendered file: a response cache keyed on
 * the request path alone ignores `Vary`, so rewriting an `isr`/`swr` page would
 * let its HTML and markdown variants overwrite each other under the same key.
 * Cached patterns get a 307 instead, so each URL keeps a single variant and the
 * client resolves the twin before any cache lookup.
 *
 * `Location` carries no query of its own, and does not need one: `src` matches
 * the pathname excluding the querystring, and the CDN re-attaches the incoming
 * query to the destination itself ("all query strings that are found in the
 * source path will be passed to the destination path"). That is the same thing
 * the Nitro middleware does by hand for the presets that have no CDN, so a
 * query-driven page like `/compare?tools=a,b` reaches
 * `/raw/compare.md?tools=a,b` either way.
 */
function negotiatedRoute(src: string, dest: string, has: RouteMatcher[], cached: boolean, missing?: RouteMatcher[]): VercelRoute {
  if (cached) {
    return { src, status: 307, headers: { Location: dest, Vary: MARKDOWN_VARY }, has, ...(missing ? { missing } : {}) }
  }
  // `check: true` looks the destination up in the filesystem first, which is
  // where prerendered raw files live.
  return { src, dest, has, ...(missing ? { missing } : {}), check: true }
}

/**
 * Routes prepended to `.vercel/output/config.json` (Build Output API v3) to
 * serve markdown through content negotiation at the edge, where prerendered
 * pages never reach Nitro. The table stays O(route patterns), never O(pages).
 *
 * The two `Vary` routes must come first and carry `continue: true`: Nitro emits
 * its own `routeRules` header routes *after* these rewrites and without
 * `continue`, so they never run for a request that gets rewritten to a
 * prerendered raw markdown file. The first labels the pages, cached patterns
 * included even though their 307 carries `Vary` itself, so the HTML variant is
 * labelled as well; the second labels the markdown representations those pages
 * send a client to.
 */
export function vercelMarkdownRoutes(config: NegotiationConfig): VercelRoute[] {
  // `text/markdown` at the head of a media range, not anywhere in the header.
  // A bare substring also matched it inside a parameter value, so
  // `Accept: text/html;profile="text/markdown"` was served markdown.
  const acceptMarkdown = { type: 'header', key: 'accept', value: String.raw`(.*,)?\s*text/markdown\s*([;,].*)?` }
  // Only on the `Accept` routes. A known agent user agent gets markdown
  // whatever its `Accept` says, which is what the negotiation core does too.
  const refusesMarkdown = [{ type: 'header', key: 'accept', value: REFUSES_MARKDOWN }]
  // An empty list has no matcher, not an empty alternation: `.*().*` matches
  // every user agent there is, so `userAgents: { replace: [] }` served markdown
  // to browsers at the edge while the runtime correctly matched nothing.
  const agentUserAgent = config.userAgents.length
    ? { type: 'header', key: 'user-agent', value: agentUserAgentPattern(config) }
    : undefined
  const excluded = excludeLookahead(config)

  const routes: VercelRoute[] = []

  /**
   * One negotiated pattern: the `Accept` route, then the agent one. A site that
   * emptied the user-agent list gets the first only, rather than an empty
   * alternation that matches every client.
   */
  const pushNegotiated = (src: string, dest: string, cached: boolean) => {
    routes.push(negotiatedRoute(src, dest, [acceptMarkdown], cached, refusesMarkdown))
    if (agentUserAgent) {
      routes.push(negotiatedRoute(src, dest, [agentUserAgent], cached))
    }
  }

  // Tell CDNs the response depends on `Accept` / `User-Agent`, then keep
  // routing. The dotted-segment lookahead is what keeps this off the documents
  // that have a single representation: without it this route labelled
  // `/llms.txt`, `/robots.txt`, `/sitemap.xml` and every file in `public/`,
  // which fragments a shared cache per user-agent for nothing. It takes the
  // `.md` twins out too, which the route below puts back deliberately.
  const varySources = config.routes.map(route => compilePattern(route.path).source.slice(1, -1))
  routes.push({
    src: `^${NO_DOTTED_LAST_SEGMENT}${excluded}(?:${varySources.join('|')})$`,
    headers: { Vary: MARKDOWN_VARY },
    continue: true
  })

  // The markdown representations themselves: everything under the raw prefix,
  // the `.md` twins, and `/sitemap.md`. Their own handlers set the header, but
  // a prerendered file never reaches a handler, and a request one of the
  // rewrites below matches never reaches what Nitro emits from `routeRules`
  // either.
  //
  // A negotiated page rewrites or 307s to one of these, so the response a
  // client keeps, and the one a shared cache stores, is the twin's. Labelling
  // only the page leaves the URL the hop actually lands on saying nothing about
  // the two representations behind it, which is what a checker following the
  // redirect sees. The cost is a shared cache keyed per user-agent on these
  // documents, which is why they were left alone until it turned out the
  // negotiated pair has to be consistent end to end.
  const twinSources = config.routes.flatMap((route) => {
    if (route.path.includes('*')) {
      return [`${excluded}${compilePattern(route.path).source.slice(1, -1)}\\.md`]
    }
    // `/` has no `.md` twin URL, matching the rewrite loop below.
    return route.path === '/' ? [] : [`${escapeRegExp(route.path)}\\.md`]
  })
  // Keyed on the registered link rather than on this module serving the route,
  // the same way the exclusion is: a site with `sitemap.markdown` off that
  // serves its own through `discovery.links` needs the label just as much.
  const markdownSources = [
    `${escapeRegExp(config.rawPrefix)}/.*`,
    ...twinSources,
    ...(config.links.some(link => link.href === '/sitemap.md') ? [String.raw`/sitemap\.md`] : [])
  ]
  routes.push({
    src: `^(?:${markdownSources.join('|')})$`,
    headers: { Vary: MARKDOWN_VARY },
    continue: true
  })

  // Opt-in: a negotiated page has exactly two representations, so an `Accept`
  // allowing neither is a 406 per RFC 9110 rather than a page the client just
  // said it cannot read. Emitted here as well as in the middleware because a
  // prerendered page is answered off the filesystem and never reaches it, so
  // without this the option would be on for the pages Nitro renders and
  // quietly off for the rest of the site.
  //
  // The guards are the middleware's, as matchers: an `Accept` has to be there
  // and carry a media range at all, must not offer a representation, and a
  // navigation or a known agent is never refused. The body is empty, where the
  // origin renders the markdown one, which is the price of answering before
  // anything runs.
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
      ]
    })
  }

  // The `/` routeRule carries the same `Link` header, but a homepage request
  // rewritten below to a prerendered raw markdown file never reaches it.
  const linkHeader = config.linkHeader ? formatLinkHeader(config.links) : ''
  if (linkHeader) {
    routes.push({
      src: '^/$',
      headers: { Link: linkHeader },
      continue: true
    })
  }

  // Whether a rule covers a whole pattern, so the pattern itself is demoted to
  // a redirect. Comparing static-prefix lengths instead used to tie `/` with
  // `/**`, so a single cached homepage demoted every page on the site.
  const patternCached = (pattern: string) => config.cachedRoutes.some(rule => ruleCoversPattern(rule, pattern))

  // A cached rule narrower than the pattern covering it, `routeRules['/docs/**']`
  // under the default `/**`, gets its own 307 pair ahead of that pattern's
  // rewrite. Marking the whole pattern cached instead would demote every page on
  // the site to a redirect because one section happens to be cached.
  for (const rule of config.cachedRoutes) {
    // An exact rule is only negotiable through the route it matches. Without
    // one there is no twin to send the client to, and inventing a
    // `rawPrefix + rule + '.md'` destination 307s to a URL that 404s.
    const wildcard = rule.includes('*')
    const matched = wildcard ? undefined : matchRoute(config.routes, rule)

    // This loop handles what a rule caches *beyond* the patterns it fully
    // covers; those are demoted wholesale below. Skipping a rule with nothing
    // left over is what keeps a path from collecting two redirects.
    if (wildcard) {
      if (!config.routes.some(route => patternsOverlap(rule, route.path) && !patternCached(route.path))) {
        continue
      }
    } else if (!matched || patternCached(matched.path)) {
      continue
    }

    const src = wildcard
      ? `^${NO_DOTTED_LAST_SEGMENT}${excluded}${compilePattern(rule).source.slice(1, -1)}$`
      : `^${escapeRegExp(rule)}$`
    const dest = matched
      ? rawDestination(config, matched, rule)
      : `${config.rawPrefix}${patternDest(rule)}.md`

    pushNegotiated(src, dest, true)
  }

  for (const route of config.routes) {
    // Cached only when a rule covers the pattern itself. A narrower rule was
    // handled above, so this pattern keeps its rewrite for everything outside
    // it. The `.md` twins stay rewrites either way: that URL only ever serves
    // markdown, so there is no second variant to poison.
    const cached = patternCached(route.path)

    if (route.path.includes('*')) {
      const body = compilePattern(route.path).source.slice(1, -1)
      const dest = `${config.rawPrefix}${patternDest(route.path)}.md`
      // Explicit `.md` twin URLs, whatever the headers say. The last wildcard
      // capture stops before the suffix thanks to the `\.md$` anchor.
      routes.push({
        src: `^${excluded}${body}\\.md$`,
        dest
      })
      // The dotted-last-segment lookahead keeps `.md` URLs on the rewrite above
      // and assets (`_payload.json`, images) out.
      pushNegotiated(`^${NO_DOTTED_LAST_SEGMENT}${excluded}${body}$`, dest, cached)
    } else {
      const dest = rawDestination(config, route, route.path)
      if (route.path !== '/') {
        routes.push({ src: `^${escapeRegExp(route.path)}\\.md$`, dest })
      }
      // The same two guards the wildcard branch carries. Without them an exact
      // pattern negotiated at the edge where the runtime refuses it: a dotted
      // one like `/faq.html` reads as an asset, and `/mcp` sits behind an
      // excluded prefix.
      pushNegotiated(`^${NO_DOTTED_LAST_SEGMENT}${excluded}${escapeRegExp(route.path)}/?$`, dest, cached)
    }
  }

  return routes
}

/**
 * Patches the Vercel Build Output config after Nitro compiles. We edit
 * `.vercel/output/config.json` (Build Output API v3), not `vercel.json`,
 * which has a different schema. The `check: true` and `continue` flags are
 * documented on the Source route type:
 * https://vercel.com/docs/build-output-api/configuration
 */
export function setupVercelPreset(nitro: Nitro, config: NegotiationConfig) {
  // `nuxt generate` on Vercel resolves the `vercel-static` preset, whose name
  // contains "vercel" but which emits no function routes at all. Patching the
  // table there leaves rewrites pointing at a filesystem that only holds what
  // was prerendered, with nothing behind them to fall through to.
  if (nitro.options.dev || nitro.options.static || !nitro.options.preset.includes('vercel')) {
    return
  }
  nitro.hooks.hook('compiled', async () => {
    const vcJSON = resolve(nitro.options.output.dir, 'config.json')
    const vcConfig = JSON.parse(await readFile(vcJSON, 'utf8'))
    vcConfig.routes.unshift(...vercelMarkdownRoutes(config))
    await writeFile(vcJSON, JSON.stringify(vcConfig, null, 2), 'utf8')
  })
}
