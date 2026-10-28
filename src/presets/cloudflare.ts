import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { joinURL, withTrailingSlash } from 'ufo'
import { resolve } from 'pathe'
import { useLogger } from '@nuxt/kit'
import type { Nitro } from 'nitropack'

/** The presets running a Worker behind Workers Static Assets. */
export function isCloudflareWorkerPreset(preset: string): boolean {
  return preset === 'cloudflare-module' || preset === 'cloudflare-durable'
}

/**
 * Workers Static Assets answers a prerendered page before the Worker runs, so
 * once a negotiable page is prerendered, every request runs the Worker first
 * (`assets.run_worker_first`), except under Nitro's fingerprinted directories
 * (`/_nuxt/`), where every chunk would become a Worker request. Before that,
 * every page reaches the Worker anyway, and the rule would bill the public
 * files for nothing.
 *
 * Written into the `wrangler.json` Nitro writes after it compiles, with
 * `cloudflare.deployConfig` (the Nitro 3 default, and on under Workers
 * Builds). It carries the site's own wrangler config merged in, and a
 * `run_worker_first` set there is left alone.
 */
export function setupCloudflarePreset(nitro: Nitro, options: { runWorkerFirst: boolean, prerendered: () => boolean }) {
  if (nitro.options.dev || nitro.options.static || !options.runWorkerFirst || !isCloudflareWorkerPreset(nitro.options.preset)) {
    return
  }
  const logger = useLogger('nuxt-agent-discovery')
  nitro.hooks.hook('compiled', async () => {
    if (!options.prerendered()) {
      return
    }
    const assetBases = [...new Set(nitro.options.publicAssets
      .filter(dir => !dir.fallthrough && dir.baseURL && dir.baseURL !== '/')
      .map(dir => withTrailingSlash(joinURL(nitro.options.baseURL, dir.baseURL!))))]
    const rules = [
      joinURL(nitro.options.baseURL, '*'),
      // Wrangler refuses a rule another one covers, like `/_nuxt/builds/meta/` under `/_nuxt/`.
      ...assetBases.filter(base => !assetBases.some(other => other !== base && base.startsWith(other))).map(base => `!${base}*`)
    ]

    const file = resolve(nitro.options.output.serverDir, 'wrangler.json')
    const wrangler = existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) as { assets?: { run_worker_first?: boolean | string[] } } : undefined
    // `true` already runs the Worker everywhere.
    if (wrangler?.assets?.run_worker_first === true) {
      return
    }
    if (!wrangler || wrangler.assets?.run_worker_first !== undefined) {
      const reason = wrangler ? 'The site\'s wrangler config sets its own `run_worker_first`' : 'Nitro wrote no wrangler config (`cloudflare.deployConfig` is off)'
      logger.warn(`${reason}, so the prerendered pages stay HTML for agents until \`"run_worker_first": ${JSON.stringify(rules)}\` is added under \`assets\` in yours.`)
      return
    }
    wrangler.assets = { ...wrangler.assets, run_worker_first: rules }
    await writeFile(file, JSON.stringify(wrangler, null, 2), 'utf8')
    logger.info(`Prerendered pages run the Worker first now (\`run_worker_first\`), so they negotiate. Cloudflare bills those requests, and on the Free plan answers 429 past 100,000 a day. \`agentDiscovery.cloudflare.runWorkerFirst: false\` leaves them to the assets.`)
  })
}
