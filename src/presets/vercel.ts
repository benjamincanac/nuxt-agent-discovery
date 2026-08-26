import { resolve } from 'pathe'
import { readFile, writeFile } from 'node:fs/promises'
import type { Nitro } from 'nitropack'
import { compilePattern, formatLinkHeader, matchRoute, patternsOverlap, rawDestination, staticPrefix, MARKDOWN_VARY } from '../runtime/shared/negotiation'
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
 * `Accept` values that explicitly refuse markdown, as an anchored RE2 pattern:
 * a `text/markdown` range carrying `q=0`, with or without trailing zeroes, and
 * whatever follows it.
 *
 * The negotiation core reads q-values per RFC 9110, so the Nitro middleware
 * serves HTML for `Accept: text/markdown;q=0, text/html`. A CDN matcher is a
 * plain regex over the raw header, and Vercel runs RE2, so there is no
 * lookahead to say "markdown, but not at q=0" in a `has` matcher. A `missing`
 * matcher says it directly: the rewrite applies only when this does not match.
 *
 * `q=0.5` and friends must not match, hence the `(\.0+)?` rather than a loose
 * tail, and the boundary that follows keeps `q=0.05` (a real quality) out.
 */
const REFUSES_MARKDOWN = String.raw`.*text/markdown\s*;\s*[qQ]=0(\.0+)?([;,].*)?`

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
 * The `Vary` route must come first and carry `continue: true`: Nitro emits its
 * own `routeRules` header routes *after* these rewrites and without
 * `continue`, so they never run for a request that gets rewritten to a
 * prerendered raw markdown file. It covers cached patterns too, even though
 * their 307 carries `Vary` itself, so the HTML variant is labelled as well.
 */
export function vercelMarkdownRoutes(config: NegotiationConfig): VercelRoute[] {
  const acceptMarkdown = { type: 'header', key: 'accept', value: '(.*)text/markdown(.*)' }
  // Only on the `Accept` routes. A known agent user agent gets markdown
  // whatever its `Accept` says, which is what the negotiation core does too.
  const acceptsMarkdown = [{ type: 'header', key: 'accept', value: REFUSES_MARKDOWN }]
  const agentUserAgent = { type: 'header', key: 'user-agent', value: agentUserAgentPattern(config) }
  const excluded = excludeLookahead(config)

  const routes: VercelRoute[] = []

  // Tell CDNs the response depends on `Accept` / `User-Agent`, then keep routing.
  const varySources = config.routes.flatMap((route) => {
    const body = compilePattern(route.path).source.slice(1, -1)
    const sources = [body]
    // Exact patterns also cover their `.md` twin; wildcards already do.
    if (!route.path.includes('*') && route.path !== '/') {
      sources.push(`${escapeRegExp(route.path)}\\.md`)
    }
    return sources
  })
  routes.push({
    src: `^${excluded}(?:${varySources.join('|')})$`,
    headers: { Vary: MARKDOWN_VARY },
    continue: true
  })

  // The `/` routeRule carries the same `Link` header, but a homepage request
  // rewritten below to a prerendered raw markdown file never reaches it.
  const linkHeader = formatLinkHeader(config.links)
  if (linkHeader) {
    routes.push({
      src: '^/$',
      headers: { Link: linkHeader },
      continue: true
    })
  }

  // A cached rule narrower than the pattern covering it, `routeRules['/docs/**']`
  // under the default `/**`, gets its own 307 pair ahead of that pattern's
  // rewrite. Marking the whole pattern cached instead would demote every page on
  // the site to a redirect because one section happens to be cached.
  for (const rule of config.cachedRoutes) {
    const covered = config.routes.filter(route => patternsOverlap(rule, route.path))
    if (!covered.length || !covered.every(route => staticPrefix(rule).length > staticPrefix(route.path).length)) {
      continue
    }

    // An exact rule is only negotiable through the route it matches. Without
    // one there is no twin to send the client to, and inventing a
    // `rawPrefix + rule + '.md'` destination 307s to a URL that 404s.
    const wildcard = rule.includes('*')
    const matched = wildcard ? undefined : matchRoute(config.routes, rule)
    if (!wildcard && !matched) {
      continue
    }

    const src = wildcard
      ? `^${NO_DOTTED_LAST_SEGMENT}${excluded}${compilePattern(rule).source.slice(1, -1)}$`
      : `^${escapeRegExp(rule)}$`
    const dest = matched
      ? rawDestination(config, matched, rule)
      : `${config.rawPrefix}${patternDest(rule)}.md`

    routes.push(
      negotiatedRoute(src, dest, [acceptMarkdown], true, acceptsMarkdown),
      negotiatedRoute(src, dest, [agentUserAgent], true)
    )
  }

  for (const route of config.routes) {
    // Cached only when a rule covers the pattern itself. A narrower rule was
    // handled above, so this pattern keeps its rewrite for everything outside
    // it. The `.md` twins stay rewrites either way: that URL only ever serves
    // markdown, so there is no second variant to poison.
    const cached = config.cachedRoutes.some(rule => patternsOverlap(rule, route.path) && staticPrefix(rule).length <= staticPrefix(route.path).length)

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
      const negotiatedSrc = `^${NO_DOTTED_LAST_SEGMENT}${excluded}${body}$`
      routes.push(
        negotiatedRoute(negotiatedSrc, dest, [acceptMarkdown], cached, acceptsMarkdown),
        negotiatedRoute(negotiatedSrc, dest, [agentUserAgent], cached)
      )
    } else {
      const dest = rawDestination(config, route, route.path)
      const src = `^${escapeRegExp(route.path)}$`
      if (route.path !== '/') {
        routes.push({ src: `^${escapeRegExp(route.path)}\\.md$`, dest })
      }
      routes.push(
        negotiatedRoute(src, dest, [acceptMarkdown], cached, acceptsMarkdown),
        negotiatedRoute(src, dest, [agentUserAgent], cached)
      )
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
  if (nitro.options.dev || !nitro.options.preset.includes('vercel')) {
    return
  }
  nitro.hooks.hook('compiled', async () => {
    const vcJSON = resolve(nitro.options.output.dir, 'config.json')
    const vcConfig = JSON.parse(await readFile(vcJSON, 'utf8'))
    vcConfig.routes.unshift(...vercelMarkdownRoutes(config))
    await writeFile(vcJSON, JSON.stringify(vcConfig, null, 2), 'utf8')
  })
}
