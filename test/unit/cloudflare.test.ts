import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Nitro } from 'nitropack'
import { isCloudflareWorkerPreset, setupCloudflarePreset } from '../../src/presets/cloudflare'

const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn() }))

vi.mock('@nuxt/kit', async importOriginal => ({
  ...await importOriginal<typeof import('@nuxt/kit')>(),
  useLogger: () => logger
}))

describe('setupCloudflarePreset', () => {
  beforeEach(() => {
    logger.info.mockClear()
    logger.warn.mockClear()
  })

  /** One `cloudflare-module` build: Nitro's `wrangler.json`, when given, then the module's `compiled` hook. */
  async function compile(options: { wrangler?: Record<string, unknown>, runWorkerFirst?: boolean, prerendered?: boolean, preset?: string, baseURL?: string } = {}) {
    const serverDir = mkdtempSync(join(tmpdir(), 'agent-discovery-cloudflare-'))
    const file = join(serverDir, 'wrangler.json')
    if (options.wrangler) {
      writeFileSync(file, JSON.stringify(options.wrangler))
    }
    const hooks: Record<string, () => Promise<void>> = {}
    const nitro = {
      options: {
        dev: false,
        static: false,
        preset: options.preset || 'cloudflare-module',
        baseURL: options.baseURL || '/',
        publicAssets: [
          { dir: '/build/client', baseURL: '/_nuxt/', maxAge: 31536000 },
          { dir: '/build/meta', baseURL: '/_nuxt/builds/meta/', maxAge: 31536000 },
          { dir: '/public', fallthrough: true }
        ],
        output: { serverDir }
      },
      hooks: { hook: (name: string, callback: () => Promise<void>) => { hooks[name] = callback } }
    }
    setupCloudflarePreset(nitro as unknown as Nitro, {
      runWorkerFirst: options.runWorkerFirst ?? true,
      prerendered: () => options.prerendered ?? true
    })
    await hooks.compiled?.()
    return { hooked: Boolean(hooks.compiled), written: existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as { assets?: { run_worker_first?: unknown } } : undefined }
  }

  const generated = { main: 'index.mjs', assets: { binding: 'ASSETS', directory: '../public' } }

  it('runs the Worker first everywhere but the fingerprinted assets, and says what it costs', async () => {
    const { written } = await compile({ wrangler: generated })

    // `/_nuxt/builds/meta/` is under `/_nuxt/`, and wrangler refuses a rule another one covers.
    expect(written!.assets).toEqual({ binding: 'ASSETS', directory: '../public', run_worker_first: ['/*', '!/_nuxt/*'] })
    expect(logger.info).toHaveBeenCalledOnce()
    expect(logger.info.mock.calls[0]![0]).toContain('100,000 a day')
  })

  it('writes the rules below `app.baseURL`', async () => {
    expect((await compile({ wrangler: generated, baseURL: '/base/' })).written!.assets!.run_worker_first).toEqual(['/base/*', '!/base/_nuxt/*'])
  })

  it('leaves a `run_worker_first` the site sets itself alone', async () => {
    expect((await compile({ wrangler: { assets: { ...generated.assets, run_worker_first: true } } })).written!.assets!.run_worker_first).toBe(true)
    expect(logger.warn).not.toHaveBeenCalled()

    expect((await compile({ wrangler: { assets: { ...generated.assets, run_worker_first: ['/admin'] } } })).written!.assets!.run_worker_first).toEqual(['/admin'])
    expect(logger.warn.mock.calls[0]![0]).toContain('"run_worker_first": ["/*","!/_nuxt/*"]')
  })

  it('names the rules when Nitro wrote no wrangler config', async () => {
    const { written } = await compile()

    expect(written).toBeUndefined()
    expect(logger.warn).toHaveBeenCalledOnce()
    expect(logger.warn.mock.calls[0]![0]).toContain('"run_worker_first": ["/*","!/_nuxt/*"]')
  })

  it('leaves the assets alone when the site turns it off', async () => {
    const { hooked, written } = await compile({ wrangler: generated, runWorkerFirst: false })

    expect(hooked).toBe(false)
    expect(written).toEqual(generated)
  })

  it('stays out of a build where no negotiable page was prerendered', async () => {
    // Every page reaches the Worker already, and the rule would only bill
    // the public files.
    expect((await compile({ wrangler: generated, prerendered: false })).written).toEqual(generated)
    expect(logger.info).not.toHaveBeenCalled()
  })

  it('only runs for a Worker in front of Workers Static Assets', async () => {
    expect((await compile({ wrangler: generated, preset: 'cloudflare-pages' })).hooked).toBe(false)
    expect((await compile({ wrangler: generated, preset: 'node-server' })).hooked).toBe(false)
    expect(isCloudflareWorkerPreset('cloudflare-durable')).toBe(true)
  })
})
