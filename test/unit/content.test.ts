import { describe, expect, it, vi } from 'vitest'
import type { Nuxt } from '@nuxt/schema'
import { dropContentLlmsFeature, resolveContentSource } from '../../src/build/content'

const warn = vi.hoisted(() => vi.fn())
const templates = vi.hoisted(() => [] as { filename: string, getContents: () => string }[])

vi.mock('@nuxt/kit', async importOriginal => ({
  ...await importOriginal<typeof import('@nuxt/kit')>(),
  useLogger: () => ({ warn }),
  addTemplate: (template: { filename: string, getContents: () => string }) => {
    templates.push(template)
    return { ...template, dst: `/.nuxt/${template.filename}` }
  },
  tryResolveModule: async (id: string) => `/node_modules/${id}.mjs`
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

describe('resolveContentSource on v4', () => {
  /** Resolves the v4 source, then runs the `nitro:init` hook against `imports`. */
  async function resolveV4(imports: { name: string, as?: string, from: string }[]) {
    const hooks: ((nitro: unknown) => void)[] = []
    const nuxt = { hook: (_name: string, callback: (nitro: unknown) => void) => hooks.push(callback) }
    templates.length = 0
    const source = await resolveContentSource(nuxt as unknown as Nuxt, path => path, { entry: '/node_modules/@nuxt/content/dist/module.mjs', major: 4 })
    for (const hook of hooks) {
      hook({ options: { imports: { imports } } })
    }
    return { source, template: templates[0]! }
  }

  it('wires the server `content` import to the comark adapter', async () => {
    const { source, template } = await resolveV4([
      { name: 'useStorage', from: 'nitropack/runtime' },
      { name: 'content', from: '/app/server/content' }
    ])

    expect(source.sourcePath).toBe('/.nuxt/agent-discovery/content-source.mjs')
    expect(source.alias).toEqual({ 'comark/render': '/node_modules/comark/render.mjs' })
    expect(template.getContents()).toBe([
      'import { content } from "/app/server/content"',
      'import { createComarkSource } from \'#agent-discovery/comark\'',
      'export default createComarkSource(() => content)',
      ''
    ].join('\n'))
  })

  it('throws when v4 registered no server `content` import', async () => {
    const { template } = await resolveV4([{ name: 'queryCollection', from: '/content/v3/composables.server' }])

    expect(() => template.getContents()).toThrow('registered no server `content` import')
  })
})
