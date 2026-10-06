import { describe, expect, it, vi } from 'vitest'
import type { Nuxt } from '@nuxt/schema'
import { dropContentLlmsFeature } from '../../src/build/content'

const warn = vi.hoisted(() => vi.fn())

vi.mock('@nuxt/kit', async importOriginal => ({
  ...await importOriginal<typeof import('@nuxt/kit')>(),
  useLogger: () => ({ warn })
}))

const CONTENT_PLUGIN = '/node_modules/@nuxt/content/dist/features/llms/runtime/server/content-llms.plugin'
const OWN_PLUGIN = '/node_modules/nuxt-agent-discovery/dist/runtime/server/plugins/llms'

/** Runs the `nitro:config` hook the function registers against `nitroConfig`. */
function drop(options: Record<string, unknown>, nitroConfig: { plugins?: string[] }) {
  const hooks: ((config: typeof nitroConfig) => void)[] = []
  const nuxt = {
    options: {
      serverHandlers: [],
      _installedModules: [{ meta: { configKey: 'content.llms' } }],
      ...options
    },
    hook: (_name: string, callback: (config: typeof nitroConfig) => void) => hooks.push(callback)
  }
  warn.mockClear()
  dropContentLlmsFeature(nuxt as unknown as Nuxt)
  for (const hook of hooks) {
    hook(nitroConfig)
  }
}

describe('dropContentLlmsFeature', () => {
  it('removes the plugin from `nitroConfig.plugins`', () => {
    const nitroConfig = { plugins: [CONTENT_PLUGIN, OWN_PLUGIN] }
    drop({}, nitroConfig)

    expect(nitroConfig.plugins).toEqual([OWN_PLUGIN])
    expect(warn).not.toHaveBeenCalled()
  })

  // Nuxt 4.6 only writes these into `nitroConfig.plugins` after `nitro:config`.
  it('removes the plugin from `_serverPlugins`', () => {
    const _serverPlugins = [{ plugin: CONTENT_PLUGIN }, { plugin: OWN_PLUGIN }]
    drop({ _serverPlugins }, { plugins: [] })

    expect(_serverPlugins).toEqual([{ plugin: OWN_PLUGIN }])
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns when the feature ran and left no plugin behind', () => {
    drop({ _serverPlugins: [{ plugin: OWN_PLUGIN }] }, { plugins: [] })

    expect(warn).toHaveBeenCalledOnce()
  })
})
