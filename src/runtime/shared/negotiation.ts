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
 */
export function compilePattern(pattern: string): { source: string, captures: number } {
  let source = ''
  let captures = 0
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        source += '(.+)'
        i++
      } else {
        source += '([^/]+)'
      }
      captures++
    } else {
      source += REGEX_SPECIALS.test(char) ? `\\${char}` : char
    }
  }
  return { source: `^${source}$`, captures }
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
 * entry with a non-zero q-value that html does not outrank. Wildcards never
 * count as asking, so wildcard-only clients keep HTML on pages.
 */
export function acceptsMarkdown(accept?: string | null): boolean {
  const entries = parseAccept(accept)
  const markdown = explicitQuality(entries, 'text/markdown')
  if (!markdown) {
    return false
  }
  return markdown >= acceptQuality(entries, 'text/html')
}

/** Case-sensitive on purpose, so it agrees with the CDN `has` matchers. */
export function isAgentUserAgent(config: NegotiationConfig, userAgent?: string | null): boolean {
  if (!userAgent) {
    return false
  }
  return config.userAgents.some(agent => userAgent.includes(agent))
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

  if (pathname === config.rawPrefix || pathname.startsWith(`${config.rawPrefix}/`)) {
    return undefined
  }

  if (isExcluded(pathname, config)) {
    return undefined
  }

  // An explicit `.md` twin URL is a markdown request, whatever the headers
  // say. A bare `/.md` is not a twin, matching the CDN rewrites.
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

  const route = matchRoute(config.routes, pathname)
  if (!route) {
    return undefined
  }

  // Any other dotted path is an asset (`_payload.json`, images), not a page.
  if (hasFileExtension(pathname)) {
    return undefined
  }

  return rawDestination(config, route, pathname)
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

  if (pathname === config.rawPrefix || pathname.startsWith(`${config.rawPrefix}/`)) {
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
  // markdown in.
  const pathname = normalizePathname(options.path).replace(/[`\\]/g, '')
  // Server errors never surface their message. Client errors use the status
  // message when there is one, stripped of anything that could break the
  // heading or the frontmatter line.
  const statusMessage = status < 500
    ? options.statusMessage?.replace(/[\r\n\t`\\]+/g, ' ').trim()
    : undefined
  const title = status === 404
    ? STATUS_TEXT[404]!
    : statusMessage || STATUS_TEXT[status] || (status < 500 ? 'Request Error' : 'Server Error')

  const intro = status === 404
    ? `The page \`${pathname}\` does not exist on ${siteUrl}.`
    : `The request for \`${pathname}\` failed with status ${status}.`

  const links = config.links
    .filter(link => link.title)
    .map((link) => {
      const href = link.href.startsWith('/') ? `${siteUrl}${link.href}` : link.href
      return `- [${link.title}](${href})`
    })

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
