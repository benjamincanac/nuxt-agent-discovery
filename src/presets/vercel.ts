import { resolve } from 'pathe'
import { readFile, writeFile } from 'node:fs/promises'
import type { Nitro } from 'nitropack'
import { compilePattern, formatLinkHeader, rawDestination, MARKDOWN_VARY } from '../runtime/shared/negotiation'
import type { NegotiationConfig } from '../runtime/shared/types'

export interface VercelRoute {
  src: string
  dest?: string
  headers?: Record<string, string>
  has?: { type: string, key: string, value: string }[]
  check?: boolean
  continue?: boolean
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

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
 * Routes prepended to `.vercel/output/config.json` (Build Output API v3) to
 * serve markdown through content negotiation at the edge, where prerendered
 * pages never reach Nitro. The table stays O(route patterns), never O(pages).
 *
 * The `Vary` route must come first and carry `continue: true`: Nitro emits its
 * own `routeRules` header routes *after* these rewrites and without
 * `continue`, so they never run for a request that gets rewritten to a
 * prerendered raw markdown file.
 */
export function vercelMarkdownRoutes(config: NegotiationConfig): VercelRoute[] {
  const acceptMarkdown = { type: 'header', key: 'accept', value: '(.*)text/markdown(.*)' }
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

  for (const route of config.routes) {
    if (route.path.includes('*')) {
      const body = compilePattern(route.path).source.slice(1, -1)
      const dest = `${config.rawPrefix}${patternDest(route.path)}.md`
      // Explicit `.md` twin URLs, whatever the headers say. The last wildcard
      // capture stops before the suffix thanks to the `\.md$` anchor.
      routes.push({
        src: `^${excluded}${body}\\.md$`,
        dest
      })
      // Negotiated rewrites. The dotted-last-segment lookahead keeps `.md`
      // URLs on the rewrite above and assets (`_payload.json`, images) out.
      // `check: true` looks the destination up in the filesystem first, which
      // is where prerendered raw files live.
      const negotiatedSrc = `^${NO_DOTTED_LAST_SEGMENT}${excluded}${body}$`
      routes.push(
        { src: negotiatedSrc, dest, has: [acceptMarkdown], check: true },
        { src: negotiatedSrc, dest, has: [agentUserAgent], check: true }
      )
    } else {
      const dest = rawDestination(config, route, route.path)
      const src = `^${escapeRegExp(route.path)}$`
      if (route.path !== '/') {
        routes.push({ src: `^${escapeRegExp(route.path)}\\.md$`, dest })
      }
      routes.push(
        { src, dest, has: [acceptMarkdown], check: true },
        { src, dest, has: [agentUserAgent], check: true }
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
