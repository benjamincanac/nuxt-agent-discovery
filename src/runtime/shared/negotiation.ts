/** Negotiation core. Dependency-free: shared by build time, presets and runtime. */

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
 * Backends store decoded paths, so `/docs/caf%C3%A9` would have no twin.
 */
export function normalizeAgentRoute(route: string): string {
  let path = route
  try {
    path = decodeURIComponent(path)
  } catch {
    // Malformed escape: leave it as it came rather than turn a 404 into a 500.
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
 * The inverse, for URLs this module emits. `encodeURI` leaves `#` and `?` in
 * place, where either one cuts a `Link` or `Location` header short. Not
 * `encodeURIComponent`: it escapes sub-delims the page's canonical keeps.
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
export function isExcluded(pathname: string, config: NegotiationConfig): boolean {
  return config.excludePrefixes.some(prefix => pathname.startsWith(prefix))
}

/* -------------------------------- patterns ------------------------------- */

const REGEX_SPECIALS = /[.+?^${}()|[\]\\]/

/**
 * Compiles a route pattern to a regex source with one capture group per
 * wildcard: `*` matches one segment, `**` one or more. A trailing slash is
 * matched but never captured, because the CDN tests this against the raw
 * request path and a captured slash rewrites `/docs/x/` to `/raw/docs/x/.md`.
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

function trimSlash(value: string): string {
  return value.length > 1 && value.endsWith('/') ? value.slice(0, -1) : value
}

/** `path` is `prefix` or under it on a segment boundary: `/toolsx` is not. */
function isUnder(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix === '/' ? '/' : `${prefix}/`)
}

/**
 * Whether two patterns can match the same path. Errs towards `true`, since a
 * false negative lets two representations share one route rule cache entry.
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
 * Whether a `routeRules` key covers a path, read the way radix3 reads it: `**`
 * is zero or more segments, so `/docs/**` applies to `/docs` itself. The page
 * patterns compile `**` to one or more, which a cache rule does not mean.
 */
export function ruleMatchesPath(rule: string, pathname: string): boolean {
  if (rule.endsWith('**')) {
    return isUnder(pathname, trimSlash(staticPrefix(rule)))
  }
  return patternRegExp(rule).test(pathname)
}

/**
 * Whether a cached rule covers every path a pattern matches, the only case
 * where the pattern may be demoted from a rewrite to a 307. Errs towards
 * `false`: a pattern wrongly covered turns its pages into redirects.
 */
export function ruleCoversPattern(rule: string, pattern: string): boolean {
  if (rule === pattern) {
    return true
  }
  if (rule.endsWith('**')) {
    return isUnder(trimSlash(staticPrefix(pattern)), trimSlash(staticPrefix(rule)))
  }
  return !pattern.includes('*') && ruleMatchesPath(rule, pattern)
}

/** The raw markdown destination for a page. `raw` is only honoured on exact patterns. */
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
 * entry with a non-zero q-value that html does not outrank. A wildcard alone
 * never counts, so browsers and `fetch()` keep HTML. The exception is a client
 * that refused html outright, where markdown is the only answer left.
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
 * Case-insensitive, so it agrees with the CDN `has` matchers. Lowered per call
 * because Nitro clones the runtime config per request, so a cache keyed on the
 * list's identity could never hit across requests.
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
 * The raw markdown destination a request should be served from, or `undefined`
 * when it is not asking for markdown. Mirrors the deploy-preset rewrites.
 */
export function negotiatedRawPath(config: NegotiationConfig, path: string, options: { accept?: string | null, userAgent?: string | null } = {}): string | undefined {
  const pathname = normalizePathname(path)

  if (isRawPath(config, pathname)) {
    return undefined
  }

  if (isExcluded(pathname, config)) {
    return undefined
  }

  // An explicit `.md` twin is a markdown request whatever the headers say. Not
  // routed through `negotiableRoute`, which would read the suffix as an asset.
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
 * The twin a page hands Nitro's prerender crawler while it renders, or
 * `undefined` for a single-representation URL and for a twin the site serves
 * itself. Emitted from the page's own HTML response: Nitro drops
 * `x-nitro-prerender` on a `text/plain` one, and `/` is not always prerendered.
 */
export function prerenderTwin(config: NegotiationConfig, path: string): string | undefined {
  const pathname = normalizePathname(path)
  const route = negotiableRoute(config, pathname)
  if (!route) {
    return undefined
  }
  const raw = rawDestination(config, route, pathname)
  return siteServesRaw(config, raw) ? undefined : raw
}

/**
 * Whether the site answers a raw twin with a handler of its own, so nothing
 * may prerender it. Matched on handler patterns, since a page under a wildcard
 * route has no build-time list of twins.
 */
export function siteServesRaw(config: Pick<NegotiationConfig, 'ownRawRoutes'>, raw: string): boolean {
  return config.ownRawRoutes?.some(pattern => handlerRouteMatches(pattern, raw)) ?? false
}

/** Whether a handler route covers a path: `:name` and `*` match one segment, `**` the rest. */
export function handlerRouteMatches(pattern: string, path: string): boolean {
  if (!/[:*]/.test(pattern)) {
    return pattern === path
  }
  const patternSegments = pattern.split('/').filter(Boolean)
  const pathSegments = path.split('/').filter(Boolean)
  for (const [index, segment] of patternSegments.entries()) {
    if (segment.startsWith('**')) {
      return true
    }
    if (index >= pathSegments.length) {
      return false
    }
    if (segment !== '*' && !segment.startsWith(':') && segment !== pathSegments[index]) {
      return false
    }
  }
  return patternSegments.length === pathSegments.length
}

/**
 * The route a path negotiates through, whatever the client asked for.
 * `undefined` when the URL has a single representation.
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

/** Whether a normalized pathname is the raw prefix itself or sits under it. */
export function isRawPath(config: Pick<NegotiationConfig, 'rawPrefix'>, pathname: string): boolean {
  return isUnder(pathname, config.rawPrefix)
}

/**
 * Whether a URL has both an HTML and a markdown representation. This is what
 * `Vary` is set from, derived here because a `routeRules` key cannot express
 * the negative pattern that keeps the API surface and the assets out.
 */
export function isNegotiablePath(config: NegotiationConfig, path: string): boolean {
  return Boolean(negotiableRoute(config, normalizePathname(path)))
}

/** The media types a negotiated page has, in the order the 406 body lists them. */
export const REPRESENTATIONS = ['text/html', 'text/markdown']

/**
 * A media range as RFC 9110 spells one. `text/` and `/html` are a mangled
 * header, not a range: an unacceptable range is a 406, a mangled one ignored.
 */
const MEDIA_RANGE = /^[a-z0-9!#$%&'*+.^_|~-]+\/[a-z0-9!#$%&'*+.^_|~-]+$/

/**
 * Whether a negotiated page has to answer 406: the `Accept` rules out both of
 * its representations, as RFC 9110 asks. Off unless a site turns it on, and
 * narrow when it is, because a false positive turns a page that renders into
 * an error. A missing `Accept`, a navigation, a known agent and an unparseable
 * header all keep their page. `text/markdown;q=0` does not, zero is a refusal.
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

  // Only a URL with more than one representation can refuse them all.
  if (!isNegotiablePath(config, options.path)) {
    return false
  }

  if (isAgentUserAgent(config, options.userAgent)) {
    return false
  }

  if (options.secFetchMode && options.secFetchMode.toLowerCase() === 'navigate') {
    return false
  }

  // RFC 9110 says to ignore what cannot be parsed, so `application/xml, text/`
  // is still a refusal of both while `text/` on its own is unreadable.
  const entries = parseAccept(options.accept)
  if (!entries.some(entry => MEDIA_RANGE.test(entry.type))) {
    return false
  }

  return REPRESENTATIONS.every(type => acceptQuality(entries, type) === 0)
}

/**
 * Whether an error response should be rendered as markdown rather than the
 * HTML error page or Nitro's JSON fallback.
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

  if (pathname.endsWith('.md')) {
    return true
  }

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

  // A browser `fetch()` of any mode keeps the HTML or JSON error it expects.
  // Only navigations fall through.
  if (options.secFetchMode && options.secFetchMode.toLowerCase() !== 'navigate') {
    return false
  }

  // curl and any other non-browser client asking for a page gets markdown.
  return true
}

/* ------------------------------ markdown links ---------------------------- */

/** Link destinations in prose: `](/x)` and `]: /x`. */
const MARKDOWN_LINK = /(\]\(|\]:[ \t]*)(\/(?!\/)[^\s)>]*)/g

/**
 * The `</x>` autolink form. The path has to carry a second `/` or a `.`, or
 * `</div>` and `</Callout>` match too and rewriting them destroys the markup.
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
 * Rewrites site-relative markdown links to absolute ones, since the document
 * is read detached from its site. Fenced blocks and code spans are left alone.
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

/** Prefixes a site-relative href with the site origin, leaving others alone. */
export function absolutizeHref(href: string, siteUrl: string): string {
  return href.startsWith('/') && !href.startsWith('//') ? `${siteUrl}${href}` : href
}

const LINK_PROPS = ['href', 'src', 'to']

/**
 * The same rewrite on the document tree, before it is stringified. Both
 * backends hand back `[tag, props, ...children]` nodes, so one walker serves
 * both. Preferred over the string pass: it sees MDC component props and never
 * touches prose that merely looks like a link.
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
        if (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')) {
          props[prop] = base + value
        }
      }
    }
    absolutizeTreeLinks(node.slice(2), siteUrl)
  }
}

/**
 * Whether the Vercel route table already carries the canonical/alternate
 * `Link` pair for a raw URL, mirroring the `config.siteUrl` block of
 * `vercelMarkdownRoutes`. The raw handler skips its own copy exactly there, or
 * every origin-rendered raw response carries the pair twice. `/index.md` is
 * out because the preset's `noIndex` lookahead keeps it out of the table.
 */
export function hasCdnLinkPair(config: NegotiationConfig, rawPathname: string): boolean {
  if (!rawPathname.endsWith('.md')) {
    return false
  }
  // The table matches the encoded request path while the config spells routes
  // decoded.
  let pathname = rawPathname
  try {
    pathname = decodeURIComponent(pathname)
  } catch {
    // Malformed escape: leave it as it came.
  }

  const rootTwin = `${config.rawPrefix}/index.md`
  for (const route of config.routes) {
    if (route.path.includes('*')) {
      continue
    }
    const raw = rawDestination(config, route, route.path)
    if (raw === pathname && isRawPath(config, raw)) {
      return true
    }
  }
  if (pathname === rootTwin) {
    return true
  }

  if (!isRawPath(config, pathname) || pathname.endsWith('/index.md')) {
    return false
  }
  const page = pathname.slice(config.rawPrefix.length, -3)
  return config.routes.some(route => route.path.includes('*') && patternRegExp(route.path).test(page))
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
 * resources they can recover from. Links are absolute: the body travels.
 */
export function errorMarkdown(config: NegotiationConfig, options: { path: string, status?: number, statusMessage?: string, siteUrl: string }): string {
  const status = options.status || 404
  const siteUrl = options.siteUrl.replace(/\/$/, '')
  // The pathname is attacker-chosen and lands in a code span of a document an
  // agent will act on, so drop anything that could close the span and smuggle
  // markdown in. Newlines most of all: h3 has already decoded `%0A`.
  const pathname = normalizePathname(options.path).replace(/[`\\\r\n]+/g, '').slice(0, 200)
  // Server errors never surface their message.
  const statusMessage = status < 500
    ? options.statusMessage?.replace(/[\r\n\t`\\]+/g, ' ').trim()
    : undefined
  const title = status === 404
    ? STATUS_TEXT[404]!
    : statusMessage || STATUS_TEXT[status] || (status < 500 ? 'Request Error' : 'Server Error')

  // RFC 9110 asks a 406 body to list the available representations.
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
