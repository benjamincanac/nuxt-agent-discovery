import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { joinURL } from 'ufo'
import { resolve } from 'pathe'
import { useLogger } from '@nuxt/kit'
import type { Nitro } from 'nitropack'
import { encodeAgentRoute } from '../runtime/shared/negotiation'
import { appBase } from '../runtime/shared/paths'
import type { NegotiationConfig } from '../runtime/shared/types'

/** Wrangler refuses more rules than this, or a longer one. */
const MAX_RULES = 100
const MAX_RULE_LENGTH = 100

/** The presets running a Worker behind Workers Static Assets. */
export function isCloudflareWorkerPreset(preset: string): boolean {
  return /^cloudflare[-_](?:module|durable)$/.test(preset)
}

/**
 * Wrangler rejects a rule that a `*` rule already covers, as well as a
 * duplicate, so the merge with a site's own rules drops them the same way.
 */
function withoutCovered(rules: string[]): string[] {
  const unique = [...new Set(rules)]
  return unique.filter(rule => !unique.some(other => other !== rule && other.endsWith('*') && rule.startsWith(other.slice(0, -1))))
}

/**
 * `assets.run_worker_first` rules sending the negotiated routes to the Worker
 * ahead of Workers Static Assets, which answers a prerendered page before the
 * Worker runs otherwise. One rule per pattern, never one per page: wrangler
 * takes 100 at most. Its `*` crosses `/`, so a pattern is cut at its first
 * wildcard segment, and an exact route gets its trailing-slash twin, which the
 * asset layer redirects a directory index to. Matched against the
 * percent-encoded path, while routes are spelled decoded.
 *
 * `assetBases` are Nitro's fingerprinted directories (`/_nuxt/`), handed back
 * to the assets where a rule would otherwise cover them: every chunk would
 * become a Worker request.
 */
export function cloudflareRunWorkerFirst(config: NegotiationConfig, options: { baseURL?: string, assetBases?: string[], current?: string[] } = {}): string[] {
  const base = appBase(options.baseURL)
  const rules = [...(options.current || [])]
  for (const route of config.routes) {
    const segments = route.path.split('/')
    const wildcard = segments.findIndex(segment => segment.includes('*'))
    if (wildcard !== -1) {
      rules.push(`${base}${encodeAgentRoute(segments.slice(0, wildcard).join('/'))}/*`)
      continue
    }
    const path = `${base}${route.path === '/' ? '' : encodeAgentRoute(route.path.replace(/\/+$/, ''))}`
    rules.push(...(path ? [path, `${path}/`] : ['/']))
  }
  const positive = withoutCovered(rules.filter(rule => !rule.startsWith('!')))
  const negative = withoutCovered([
    ...rules.filter(rule => rule.startsWith('!')),
    ...(options.assetBases || [])
      .filter(assetBase => positive.some(rule => rule.endsWith('*') && assetBase.startsWith(rule.slice(0, -1))))
      .map(assetBase => `!${assetBase.replace(/\/?$/, '/')}*`)
  ])
  return [...positive, ...negative]
}

/**
 * Sends the negotiated routes to the Worker first by editing the
 * `wrangler.json` Nitro writes after it compiles, with `cloudflare.deployConfig`
 * (the Nitro 3 default, and on under Workers Builds). It carries the site's
 * own wrangler config merged in, so a rule of theirs is kept and `true`, which
 * already runs the Worker everywhere, is left alone. Opt-in: Cloudflare bills
 * every request a rule matches, where static assets are free.
 */
export function setupCloudflarePreset(nitro: Nitro, config: NegotiationConfig, options: { runWorkerFirst: boolean, prerendered: () => number }) {
  if (nitro.options.dev || nitro.options.static || !isCloudflareWorkerPreset(nitro.options.preset)) {
    return
  }
  const logger = useLogger('nuxt-agent-discovery')
  nitro.hooks.hook('compiled', async () => {
    const file = resolve(nitro.options.output.serverDir, 'wrangler.json')
    const wrangler = existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) as { assets?: { run_worker_first?: boolean | string[] } } : undefined

    if (!options.runWorkerFirst) {
      // A site already running the Worker first has nothing to learn here.
      if (options.prerendered() && !wrangler?.assets?.run_worker_first) {
        logger.info('Workers Static Assets answers the prerendered pages before the Worker runs, so they stay HTML for agents. `agentDiscovery.cloudflare.runWorkerFirst` sends the negotiated routes to the Worker first, as requests Cloudflare bills.')
      }
      return
    }

    const assetBases = nitro.options.publicAssets
      .filter(dir => !dir.fallthrough && dir.baseURL && dir.baseURL !== '/')
      .map(dir => joinURL(nitro.options.baseURL, dir.baseURL!))
    if (!wrangler) {
      const rules = cloudflareRunWorkerFirst(config, { baseURL: nitro.options.baseURL, assetBases })
      logger.warn(`Nitro wrote no wrangler config (\`cloudflare.deployConfig\` is off), so the prerendered pages stay HTML for agents until \`"run_worker_first": ${JSON.stringify(rules)}\` is added under \`assets\` in yours.`)
      return
    }

    const assets = wrangler.assets ||= {}
    if (assets.run_worker_first === true) {
      return
    }
    const rules = cloudflareRunWorkerFirst(config, {
      baseURL: nitro.options.baseURL,
      assetBases,
      current: Array.isArray(assets.run_worker_first) ? assets.run_worker_first : []
    })
    const tooLong = rules.filter(rule => rule.length > MAX_RULE_LENGTH)
    if (rules.length > MAX_RULES || tooLong.length) {
      logger.warn(`\`run_worker_first\` would need ${rules.length} rules${tooLong.length ? `, ${tooLong.length} of them over ${MAX_RULE_LENGTH} characters` : ''}, past what wrangler accepts (${MAX_RULES} rules of ${MAX_RULE_LENGTH} characters), so it is left as it is and the prerendered pages stay HTML for agents. Fewer or shorter \`routes\` patterns fix it.`)
      return
    }
    assets.run_worker_first = rules
    await writeFile(file, JSON.stringify(wrangler, null, 2), 'utf8')
  })
}
