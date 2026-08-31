/**
 * Markdown content negotiation core.
 *
 * Kept dependency-free on purpose: imported by the build-time module and
 * deploy presets (through the module bundle) and by the Nitro runtime
 * (middleware, error handler, routes). One source of truth for both.
 */

import type { AgentRoute, DiscoveryLink, NegotiationConfig } from './types'

/** Request headers the markdown representation depends on. */
export const MARKDOWN_VARY = 'Accept, User-Agent'

/* --------------------------------- paths --------------------------------- */

/** Drops the query string and any trailing slash, keeping the root as `/`. */
export function normalizePathname(path: string): string {
  const pathname = (path || '/').split('?')[0]!.split('#')[0]!
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.slice(0, -1)
  }
  return pathname || '/'
}

/**
 * A raw route slug as the content backends spell it: decoded, without a
 * trailing slash, and with `/index` folded into the directory it indexes.
 *
 * The URL arrives percent-encoded while every backend stores decoded paths, so
 * without this `/docs/caf%C3%A9` has no markdown twin at all while its HTML
 * page renders. A malformed escape is left as it came: it matches nothing
 * either way, and throwing would turn a 404 into a 500.
 */
export function normalizeAgentRoute(route: string): string {
  let path = route
  try {
    path = decodeURIComponent(path)
  } catch {
    // Not a valid escape sequence, so there is nothing to decode.
  }
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1)
  }
  if (path.endsWith('/index')) {
    path = path.slice(0, -6) || '/'
  }
  return path === '/index' || path === '' ? '/' : path
}

/**
 * The inverse, for URLs this module emits: the decoded route re-encoded the
 * way a page URL is spelled. `encodeURI` alone leaves `#` and `?` in place,
 * where either one cuts a `Link` or `Location` header short, so those two are
 * escaped on top. Not `encodeURIComponent` per segment: that also escapes
 * sub-delims (`@`, `:`, `,`) the HTML page's own canonical keeps literal,
 * which would split the canonical signal into two spellings.
 */
export function encodeAgentRoute(path: string): string {
  return encodeURI(path).replace(/#/g, '%23').replace(/\?/g, '%3F')
}

/** Whether the last path segment is dotted: an asset, not a page. */
export function hasFileExtension(pathname: string): boolean {
  const segment = pathname.slice(pathname.lastIndexOf('/') + 1)
  return segment.includes('.')
}

/** Plain prefix match, so `/_` covers `/_nuxt` and `/api/` covers `/api/x`. */
function isExcluded(pathname: string, config: NegotiationConfig): boolean {
  return config.excludePrefixes.some(prefix => pathname.startsWith(prefix))
}

/* -------------------------------- patterns ------------------------------- */

const REGEX_SPECIALS = /[.+?^${}()|[\]\\]/

/**
 * Compiles a route pattern to a regex source with one capture group per
 * wildcard: `*` matches one segment, `**` one or more.
 *
 * A trailing slash is matched but never captured. The runtime strips it in
 * `normalizePathname` before matching, but the CDN tests this pattern against
 * the raw request path, and a captured slash lands in the rewrite destination:
 * `/docs/x/` becoming `/raw/docs/x/.md`, which 404s. The `**` capture is lazy
 * so it yields the slash to that optional suffix rather than swallowing it.
 */
export function compilePattern(pattern: string): { source: string, captures: number } {
  let source = ''
  let captures = 0
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        source += '(.+?)'
        i++
      } else {
        source += '([^/]+)'
      }
      captures++
    } else {
      source += REGEX_SPECIALS.test(char) ? `\\${char}` : char
    }
  }
  return { source: `^${source}/?$`, captures }
}

const patternCache = new Map<string, RegExp>()

function patternRegExp(pattern: string): RegExp {
  let regexp = patternCache.get(pattern)
  if (!regexp) {
    regexp = new RegExp(compilePattern(pattern).source)
    patternCache.set(pattern, regexp)
  }
  return regexp
}

/** First route whose pattern matches the pathname, in declaration order. */
export function matchRoute(routes: AgentRoute[], pathname: string): AgentRoute | undefined {
  return routes.find(route => patternRegExp(route.path).test(pathname))
}

/** Everything before the first wildcard: `/docs/**` → `/docs/`, `/` → `/`. */
export function staticPrefix(pattern: string): string {
  return pattern.split('*')[0]!
}

/** `/docs/` → `/docs`, so a prefix compares equal to the exact path it covers. */
function trimSlash(value: string): string {
  return value.length > 1 && value.endsWith('/') ? value.slice(0, -1) : value
}

/**
 * Whether `path` is `prefix` or sits under it, on a segment boundary. A plain
 * `startsWith` would put `/toolsx` under `/tools`.
 */
function isUnder(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix === '/' ? '/' : `${prefix}/`)
}

/**
 * Whether two patterns can match the same path. Used to decide whether a route
 * rule's response cache covers a negotiated pattern, so it errs towards `true`:
 * a false positive costs a redirect where a rewrite would have done, a false
 * negative lets two representations share one cache entry.
 *
 * Static prefixes alone are too loose in two directions: an exact pattern
 * matches exactly one path, so a `/docs/**` rule says nothing about `/`, and a
 * bare string prefix crosses segment boundaries.
 */
export function patternsOverlap(a: string, b: string): boolean {
  const left = trimSlash(staticPrefix(a))
  const right = trimSlash(staticPrefix(b))
  if (!isUnder(left, right) && !isUnder(right, left)) {
    return false
  }
  if (!a.includes('*')) {
    return patternRegExp(b).test(a) || isUnder(a, right)
  }
  if (!b.includes('*')) {
    return patternRegExp(a).test(b) || isUnder(b, left)
  }
  return true
}

/**
 * Whether a `routeRules` key covers a path, read the way Nitro reads it rather
 * than the way this module's own patterns are read.
 *
 * Route rules are matched by radix3, where `**` stands for zero or more
 * segments: `/docs/**` applies to `/docs` itself, and `/**` applies to `/`.
 * `compilePattern` compiles `**` to `(.+)`, one or more, which is what a page
 * pattern needs (the capture feeds `/raw/$1.md`) and not what a cache rule
 * means. Reading a rule with the pattern matcher silently leaves the section
 * root uncached, which is where a rewrite poisons a cache that really exists.
 */
export function ruleMatchesPath(rule: string, pathname: string): boolean {
  if (rule.endsWith('**')) {
    return isUnder(pathname, trimSlash(staticPrefix(rule)))
  }
  return patternRegExp(rule).test(pathname)
}

/**
 * Whether a cached rule covers *every* path a negotiated pattern matches, the
 * only condition under which the whole pattern may be demoted from a rewrite
 * to a 307. Anything narrower gets its own pair of routes emitted ahead of the
 * pattern instead.
 *
 * Errs towards `false`, the opposite bias to `patternsOverlap`: a pattern
 * wrongly left uncovered still gets that rule's own 307, while a pattern
 * wrongly covered turns every page under it into a redirect.
 *
 * A rule carrying a wildcard before its last segment, a locale prefix say,
 * reports `true` for anything under its static prefix, because `staticPrefix`
 * cuts at the first wildcard. That is the fail-safe direction and matches what
 * the preset did before, so it is left alone deliberately.
 */
export function ruleCoversPattern(rule: string, pattern: string): boolean {
  if (rule === pattern) {
    return true
  }
  // A `**` rule owns its whole subtree, so it covers any pattern rooted in it.
  if (rule.endsWith('**')) {
    return isUnder(trimSlash(staticPrefix(pattern)), trimSlash(staticPrefix(rule)))
  }
  // Anything else matches a bounded set of paths, so it can only cover a
  // pattern that is itself a single path the rule matches.
  return !pattern.includes('*') && ruleMatchesPath(rule, pattern)
}

/**
 * The raw markdown destination for a matched page. `raw` is only honoured on
 * exact patterns; wildcard patterns always map to `rawPrefix + path + '.md'`.
 */
export function rawDestination(config: NegotiationConfig, route: AgentRoute, pathname: string): string {
  if (route.raw && !route.path.includes('*')) {
    return route.raw
  }
  const base = pathname === '/' ? '/index' : pathname
  return `${config.rawPrefix}${base}.md`
}

/* --------------------------------- Accept -------------------------------- */

interface AcceptEntry {
  type: string
  q: number
}

/** Minimal `Accept` parser: media ranges with q-values, malformed q → 1. */
export function parseAccept(accept?: string | null): AcceptEntry[] {
  if (!accept) {
    return []
  }
  const entries: AcceptEntry[] = []
  for (const part of accept.split(',')) {
    const [range, ...params] = part.trim().split(';')
    const type = range?.trim().toLowerCase()
    if (!type) {
      continue
    }
    let q = 1
    for (const param of params) {
      const [key, value] = param.split('=')
      if (key?.trim().toLowerCase() === 'q') {
        const parsed = Number.parseFloat(value?.trim() || '')
        if (!Number.isNaN(parsed)) {
          q = Math.min(Math.max(parsed, 0), 1)
        }
      }
    }
    entries.push({ type, q })
  }
  return entries
}

/** Quality of an exact media type entry, ignoring wildcards. 0 when absent. */
function explicitQuality(entries: AcceptEntry[], target: string): number {
  let q = 0
  for (const entry of entries) {
    if (entry.type === target) {
      q = Math.max(q, entry.q)
    }
  }
  return q
}

/** Quality of a media type per RFC 9110 precedence: exact, then partial, then full wildcard. */
export function acceptQuality(entries: AcceptEntry[], target: string): number {
  const type = target.split('/')[0]
  let specificity = 0
  let q = 0
  for (const entry of entries) {
    const entrySpecificity = entry.type === target ? 3 : entry.type === `${type}/*` ? 2 : entry.type === '*/*' ? 1 : 0
    if (!entrySpecificity) {
      continue
    }
    if (entrySpecificity > specificity) {
      specificity = entrySpecificity
      q = entry.q
    } else if (entrySpecificity === specificity) {
      q = Math.max(q, entry.q)
    }
  }
  return q
}

/**
 * Whether the client explicitly asked for markdown: a literal `text/markdown`
 * entry with a non-zero q-value that html does not outrank. A wildcard on its
 * own never counts as asking, so wildcard-only clients keep HTML on pages.
 *
 * Unless it refused html outright. A client sending `text/html;q=0` alongside
 * a full wildcard has ruled out the only other representation there is, so
 * html hands it the one thing it said it could not read, and the page is not
 * unacceptable either: markdown rates through that wildcard, so there is
 * nothing for `notAcceptable` to refuse. Markdown is the only answer left.
 *
 * Narrow on purpose: a browser and a `fetch()` both rate html through their
 * own wildcard, so neither ever reaches this.
 */
export function acceptsMarkdown(accept?: string | null): boolean {
  const entries = parseAccept(accept)
  const html = acceptQuality(entries, 'text/html')
  const markdown = explicitQuality(entries, 'text/markdown')
  if (markdown) {
    return markdown >= html
  }
  return html === 0 && acceptQuality(entries, 'text/markdown') > 0
}

/**
 * Case-insensitive, so it agrees with the CDN `has` matchers: a real Vercel
 * edge has been observed anchoring the value and matching it
 * case-insensitively. The Build Output docs only document `caseSensitive` for
 * `src`, so the edge matchers spell both cases where a miss would matter
 * (`REFUSES_MARKDOWN`) and nothing depends on the observation. The origin
 * errs the same direction, towards matching.
 *
 * Lowered per call on purpose: Nitro klonas the runtime config per request,
 * so a cache keyed on the list's identity could never hit across requests.
 */
export function isAgentUserAgent(config: NegotiationConfig, userAgent?: string | null): boolean {
  if (!userAgent) {
    return false
  }
  const haystack = userAgent.toLowerCase()
  return config.userAgents.some(agent => haystack.includes(agent.toLowerCase()))
}

/* ------------------------------- negotiation ------------------------------ */

/**
 * Resolves the raw markdown destination a request should be served from, or
 * `undefined` when the request is not asking for markdown.
 *
 * Mirrors the deploy-preset rewrites so the dev and Node servers behave like
 * the edge.
 */
export function negotiatedRawPath(config: NegotiationConfig, path: string, options: { accept?: string | null, userAgent?: string | null } = {}): string | undefined {
  const pathname = normalizePathname(path)

  if (isRawPath(config, pathname)) {
    return undefined
  }

  if (isExcluded(pathname, config)) {
    return undefined
  }

  // An explicit `.md` twin URL is a markdown request, whatever the headers
  // say. A bare `/.md` is not a twin, matching the CDN rewrites. Handled here
  // rather than through `negotiableRoute`, whose dotted-segment rule would
  // read the suffix as an asset.
  if (pathname.endsWith('.md')) {
    const base = pathname.slice(0, -3)
    if (base.length <= 1) {
      return undefined
    }
    const route = matchRoute(config.routes, base)
    return route ? rawDestination(config, route, base) : undefined
  }

  if (!acceptsMarkdown(options.accept) && !isAgentUserAgent(config, options.userAgent)) {
    return undefined
  }

  const route = negotiableRoute(config, pathname)
  return route ? rawDestination(config, route, pathname) : undefined
}

/**
 * The route a path negotiates through, whatever the client asked for.
 * `undefined` when the URL has a single representation: the raw prefix itself,
 * an excluded prefix, a dotted asset (`_payload.json`, images), or a path no
 * configured pattern covers.
 */
function negotiableRoute(config: NegotiationConfig, pathname: string): AgentRoute | undefined {
  if (isRawPath(config, pathname)) {
    return undefined
  }
  if (isExcluded(pathname, config)) {
    return undefined
  }
  if (hasFileExtension(pathname)) {
    return undefined
  }
  return matchRoute(config.routes, pathname)
}

/**
 * Whether a normalized pathname is the raw prefix itself or sits under it.
 * The one definition of "this URL is a raw markdown twin", shared with the
 * sitemap plugin so every consumer agrees on it.
 */
export function isRawPath(config: Pick<NegotiationConfig, 'rawPrefix'>, pathname: string): boolean {
  return isUnder(pathname, config.rawPrefix)
}

/**
 * Whether a URL has both an HTML and a markdown representation, so its
 * response genuinely depends on `Accept` and `User-Agent`.
 *
 * This is what `Vary` is set from. Deriving it here rather than from a route
 * rule glob is the only way to exclude the API surface and the assets: a
 * `routeRules` key cannot express a negative pattern, so a catch-all pattern
 * would label every response on the site.
 */
export function isNegotiablePath(config: NegotiationConfig, path: string): boolean {
  return Boolean(negotiableRoute(config, normalizePathname(path)))
}

/**
 * The media types a negotiated page has a representation for, in the order the
 * 406 body lists them.
 */
export const REPRESENTATIONS = ['text/html', 'text/markdown']

/**
 * A media range as RFC 9110 spells one: a full wildcard, `type/*`, or
 * `type/subtype`, each half a non-empty token.
 *
 * `text/`, `/html` and `text/html/extra` are not media ranges, they are a
 * mangled header, and the difference matters: an unacceptable range is a 406
 * while a mangled one is ignored.
 */
const MEDIA_RANGE = /^[a-z0-9!#$%&'*+.^_|~-]+\/[a-z0-9!#$%&'*+.^_|~-]+$/

/**
 * Whether a negotiated page has to answer 406: the request carries an `Accept`
 * that rules out both of its representations, which is what RFC 9110 asks for
 * when a server cannot honour the header.
 *
 * Off unless a site turns it on, and narrow when it is on, because every false
 * positive here is a page that used to render turning into an error. So:
 *
 * - no `Accept` at all means the client takes anything, and the full wildcard
 *   a `fetch()` sends, or the one at `q=0.8` every browser sends, rates both
 *   representations through `acceptQuality`, so neither reaches the last check
 * - a `Sec-Fetch-Mode` of `navigate` is a real navigation, and keeps its page
 *   whatever it asked for, the same protection `prefersMarkdownError` gives
 * - a known agent gets markdown whatever its `Accept` says, so it can never be
 *   refused over a header it was not being read on anyway
 * - a header with no media range in it at all is malformed, and RFC 9110 says
 *   to ignore one of those rather than fail the request over it. `garbage` is
 *   one, and so is a half-mangled `text/` or `/html`, which is the shape a
 *   proxy rewriting the header leaves behind
 *
 * `Accept: text/markdown;q=0` reaches the last check and is a 406, on the same
 * reading that makes `Accept: application/xml` one: a quality of zero is a
 * refusal, and refusing both representations leaves nothing to send.
 */
export function notAcceptable(config: NegotiationConfig, options: {
  method?: string
  path: string
  accept?: string | null
  userAgent?: string | null
  secFetchMode?: string | null
}): boolean {
  if (!config.notAcceptable) {
    return false
  }

  const method = (options.method || 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') {
    return false
  }

  if (!options.accept?.trim()) {
    return false
  }

  // Only a URL with more than one representation can refuse them all. Rules
  // out the assets, the excluded prefixes and the `.md` twins in one call.
  if (!isNegotiablePath(config, options.path)) {
    return false
  }

  if (isAgentUserAgent(config, options.userAgent)) {
    return false
  }

  if (options.secFetchMode && options.secFetchMode.toLowerCase() === 'navigate') {
    return false
  }

  // One intelligible range is enough to judge the request on. RFC 9110 says to
  // ignore what cannot be parsed, so `application/xml, text/` is still a
  // refusal of both representations while `text/` on its own is not a request
  // this can read at all.
  const entries = parseAccept(options.accept)
  if (!entries.some(entry => MEDIA_RANGE.test(entry.type))) {
    return false
  }

  return REPRESENTATIONS.every(type => acceptQuality(entries, type) === 0)
}

/**
 * Whether an error response should be rendered as markdown rather than the
 * HTML error page (or the JSON payload Nitro falls back to).
 */
export function prefersMarkdownError(config: NegotiationConfig, options: {
  method?: string
  path: string
  accept?: string | null
  userAgent?: string | null
  secFetchMode?: string | null
}): boolean {
  const method = (options.method || 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') {
    return false
  }

  const pathname = normalizePathname(options.path)

  if (isRawPath(config, pathname)) {
    return true
  }

  // The API and framework surfaces keep their JSON errors, `.md` or not.
  if (isExcluded(pathname, config)) {
    return false
  }

  // Explicit markdown URLs.
  if (pathname.endsWith('.md')) {
    return true
  }

  // Assets and non-page documents: images, `.xml`, `.json`, `.js`, ...
  if (hasFileExtension(pathname)) {
    return false
  }

  if (acceptsMarkdown(options.accept)) {
    return true
  }

  if (isAgentUserAgent(config, options.userAgent)) {
    return true
  }

  const entries = parseAccept(options.accept)
  if (explicitQuality(entries, 'text/html') > 0) {
    return false
  }

  if (explicitQuality(entries, 'application/json') > 0) {
    return false
  }

  // A browser `fetch()` of any mode (`cors`, `no-cors`, `same-origin`) keeps
  // the HTML or JSON error it was written against. Only navigations fall through.
  if (options.secFetchMode && options.secFetchMode.toLowerCase() !== 'navigate') {
    return false
  }

  // `*/*`, an empty `Accept`, curl, or any other non-browser client asking for
  // a page: markdown is the most useful thing we can hand back.
  return true
}

/* ------------------------------ markdown links ---------------------------- */

/** Link destinations in prose: `](/x)` and `]: /x`. */
const MARKDOWN_LINK = /(\]\(|\]:[ \t]*)(\/(?!\/)[^\s)>]*)/g

/**
 * The `</x>` autolink form, which the resource lists in the raw documents use.
 *
 * The path has to carry a second `/` or a `.` somewhere, or every HTML closing
 * tag in the document is one: `</div>` and `</Callout>` are indistinguishable
 * from an autolink otherwise, and rewriting them destroys the markup. The cost
 * is that a single-segment autolink like `</blog>` is left relative, which is
 * a great deal better than mangling every tag.
 */
const MARKDOWN_AUTOLINK = /<(\/(?!\/)[^\s<>]*)>/g

/** A second `/` or a `.` past the leading slash: a path, not a tag name. */
const AUTOLINK_PATH = /[/.]/

/** Runs of backticks and everything between them: an inline code span. */
const INLINE_CODE = /(`+)[\s\S]*?\1/g

const OPEN_FENCE = /^ {0,3}(`{3,}|~{3,})/

function absolutizeProse(text: string, siteUrl: string): string {
  return text
    .replace(MARKDOWN_LINK, (_match, prefix: string, path: string) => `${prefix}${siteUrl}${path}`)
    .replace(MARKDOWN_AUTOLINK, (match, path: string) => AUTOLINK_PATH.test(path.slice(1)) ? `<${siteUrl}${path}>` : match)
}

function absolutizeLine(line: string, siteUrl: string): string {
  let result = ''
  let index = 0
  INLINE_CODE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = INLINE_CODE.exec(line))) {
    result += absolutizeProse(line.slice(index, match.index), siteUrl) + match[0]
    index = match.index + match[0].length
  }
  return result + absolutizeProse(line.slice(index), siteUrl)
}

/**
 * Rewrites site-relative markdown links to absolute ones. A markdown document
 * is read detached from the site it came from, so a relative href in it points
 * nowhere.
 *
 * Every adapter has to do this or the same page reads differently depending on
 * which backend served it, so it lives here rather than in each one. Fenced
 * blocks and inline code spans are left alone: a docs site writing about
 * markdown must keep its examples verbatim.
 */
export function absolutizeMarkdownLinks(markdown: string, siteUrl: string): string {
  const base = siteUrl.replace(/\/$/, '')
  let fence: string | undefined

  return markdown.split('\n').map((line) => {
    const opening = OPEN_FENCE.exec(line)?.[1]
    if (fence) {
      if (opening && opening.startsWith(fence[0]!) && opening.length >= fence.length) {
        fence = undefined
      }
      return line
    }
    if (opening) {
      fence = opening
      return line
    }
    return absolutizeLine(line, base)
  }).join('\n')
}

/**
 * Prefixes a site-relative href with the site origin, leaving absolute and
 * protocol-relative ones alone. Every discovery surface renders its links
 * through this so they all agree on what "absolute" means.
 */
export function absolutizeHref(href: string, siteUrl: string): string {
  return href.startsWith('/') && !href.startsWith('//') ? `${siteUrl}${href}` : href
}

const LINK_PROPS = ['href', 'src', 'to']

/**
 * The same rewrite, one level earlier: on the document tree, before it is
 * stringified. Both built-in backends hand back `[tag, props, ...children]`
 * nodes, minimark for `@nuxt/content` and comark for `comark-content`, so one
 * walker serves both.
 *
 * Preferred over the string pass wherever a tree is available: it sees the
 * props of MDC components, which carry links a markdown-level scan cannot
 * find, and it can never touch prose that merely looks like a link.
 */
export function absolutizeTreeLinks(nodes: unknown[], siteUrl: string): void {
  const base = siteUrl.replace(/\/$/, '')

  for (const node of nodes) {
    if (!Array.isArray(node)) {
      continue
    }
    const props = node[1] as Record<string, unknown> | undefined
    if (props && typeof props === 'object') {
      for (const prop of LINK_PROPS) {
        const value = props[prop]
        // Only site-relative paths. Protocol-relative, absolute and in-page
        // anchors already resolve on their own.
        if (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')) {
          props[prop] = base + value
        }
      }
    }
    absolutizeTreeLinks(node.slice(2), siteUrl)
  }
}

/* ------------------------------- Link header ------------------------------ */

/** RFC 8288 serialization of the discovery links, relative hrefs kept as-is. */
export function formatLinkHeader(links: DiscoveryLink[]): string {
  return links
    .filter(link => link.header !== false)
    .map((link) => {
      let value = `<${link.href}>; rel="${link.rel}"`
      if (link.type) {
        value += `; type="${link.type}"`
      }
      return value
    })
    .join(', ')
}

/* ------------------------------- error body ------------------------------- */

const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Page Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  410: 'Gone',
  429: 'Too Many Requests'
}

/**
 * Short markdown body for an error response, pointing agents at the discovery
 * resources they can recover from. Links are absolute so they resolve wherever
 * the body ends up.
 */
export function errorMarkdown(config: NegotiationConfig, options: { path: string, status?: number, statusMessage?: string, siteUrl: string }): string {
  const status = options.status || 404
  const siteUrl = options.siteUrl.replace(/\/$/, '')
  // The pathname is attacker-chosen and lands in a code span of a document
  // written for agents, so drop anything that could close the span or smuggle
  // markdown in. Newlines most of all: h3 has already decoded `%0A`, so without
  // this a crafted path ends the paragraph and everything after it renders as
  // first-class markdown, links included, in a document an agent will act on.
  // Capped too, so a long path cannot bury the rest of the body.
  const pathname = normalizePathname(options.path).replace(/[`\\\r\n]+/g, '').slice(0, 200)
  // Server errors never surface their message. Client errors use the status
  // message when there is one, stripped of anything that could break the
  // heading or the frontmatter line.
  const statusMessage = status < 500
    ? options.statusMessage?.replace(/[\r\n\t`\\]+/g, ' ').trim()
    : undefined
  const title = status === 404
    ? STATUS_TEXT[404]!
    : statusMessage || STATUS_TEXT[status] || (status < 500 ? 'Request Error' : 'Server Error')

  // A 406 says which representations exist, which is the "list of available
  // representation characteristics" RFC 9110 asks a 406 body to carry.
  const intro = status === 404
    ? `The page \`${pathname}\` does not exist on ${siteUrl}.`
    : status === 406
      ? `\`${pathname}\` is available as ${REPRESENTATIONS.map(type => `\`${type}\``).join(' and ')}, and the request's \`Accept\` header allows neither.`
      : `The request for \`${pathname}\` failed with status ${status}.`

  const links = config.links
    .filter(link => link.title)
    .map(link => `- [${link.title}](${absolutizeHref(link.href, siteUrl)})`)

  return [
    '---',
    `title: ${JSON.stringify(title)}`,
    `status: ${status}`,
    '---',
    '',
    `# ${status} ${title}`,
    '',
    intro,
    '',
    '## Where to look next',
    '',
    ...links,
    '',
    '## Fetching markdown',
    '',
    'Any documentation page is available as markdown: append `.md` to its URL',
    'or send `Accept: text/markdown`.',
    ''
  ].join('\n')
}
