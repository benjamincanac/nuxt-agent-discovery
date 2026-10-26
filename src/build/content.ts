import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { addTemplate, tryResolveModule, useLogger } from '@nuxt/kit'
import type { Resolver } from '@nuxt/kit'
import type { Nuxt } from '@nuxt/schema'
import { dirname, join } from 'pathe'

/**
 * Build-time glue for the `@nuxt/content` backend. It matches what the llms
 * feature registered by route and plugin path, so it assumes the version range
 * `module.ts` declares through `moduleDependencies`.
 */

const logger = useLogger('nuxt-agent-discovery')

/** `@nuxt/content`'s llms nitro plugin, by the path its feature registers. */
const CONTENT_LLMS_PLUGIN = /features[\\/]llms[\\/]runtime[\\/]server[\\/]content-llms\.plugin/

export interface ContentPackage {
  entry: string
  major?: number
}

/**
 * The installed `@nuxt/content` and its major. v4 exports no
 * `./package.json`, so the manifest is read next to the entry instead.
 */
export async function resolveContentPackage(nuxt: Nuxt): Promise<ContentPackage | undefined> {
  const entry = await tryResolveModule('@nuxt/content', nuxt.options.modulesDir)
  if (!entry) {
    return undefined
  }
  for (let dir = dirname(entry); dir !== dirname(dir); dir = dirname(dir)) {
    const manifest = join(dir, 'package.json')
    if (existsSync(manifest)) {
      const { version } = JSON.parse(await readFile(manifest, 'utf8')) as { version?: string }
      return { entry, major: Number.parseInt(version || '') || undefined }
    }
  }
  return { entry }
}

/**
 * The built-in content adapter: the runtime source, and the aliases pinning the
 * renderer to the one `@nuxt/content` produced the tree with. Takes the
 * module's own `resolve`, since the build packs everything outside `runtime/`
 * into one `dist/module.mjs` and a resolver anchored here would come out a
 * directory too high.
 */
export async function resolveContentSource(nuxt: Nuxt, resolve: Resolver['resolve'], contentPackage: ContentPackage | undefined): Promise<{ sourcePath: string, alias: Record<string, string> }> {
  if (contentPackage?.major && contentPackage.major >= 4) {
    return resolveComarkContentSource(nuxt, contentPackage.entry)
  }

  const sourcePath = resolve('./runtime/server/sources/content')
  // The stringifier has to be the one that produced the tree: our own
  // `minimark` could pin a major that disagrees with the content backend's.
  const minimarkStringify = contentPackage ? await tryResolveModule('minimark/stringify', [contentPackage.entry]) : undefined
  if (!minimarkStringify) {
    logger.warn(contentPackage
      ? 'Could not resolve `minimark/stringify` from `@nuxt/content`, so raw markdown may differ from what it produces.'
      : 'The content source is enabled but `@nuxt/content` could not be resolved. Install it, or set `agentDiscovery.source` to a file exporting an `AgentContentSource`.')
  }
  return { sourcePath, alias: minimarkStringify ? { 'minimark/stringify': minimarkStringify } : {} }
}

/**
 * v4 serves comark trees through `comark-content`, so its server `content`
 * goes through the comark adapter. Which file defines `content` depends on the
 * site (`server/content.ts`, a v3 `content.config.ts`, or neither), so it is
 * read off the server import v4 registers rather than guessed. Nitro has it by
 * `nitro:init`, before Nuxt writes its templates.
 */
async function resolveComarkContentSource(nuxt: Nuxt, contentEntry: string): Promise<{ sourcePath: string, alias: Record<string, string> }> {
  let contentImport: string | undefined
  nuxt.hook('nitro:init', (nitro) => {
    const imports = nitro.options.imports ? nitro.options.imports.imports : undefined
    contentImport = imports?.find(entry => entry.name === 'content' && (!entry.as || entry.as === 'content'))?.from
  })

  const template = addTemplate({
    filename: 'agent-discovery/content-source.mjs',
    write: true,
    getContents: () => {
      // Thrown rather than falling back to no source: negotiation is already
      // on, and every negotiated page would answer agents a 404.
      if (!contentImport) {
        throw new Error('[nuxt-agent-discovery] `@nuxt/content` v4 registered no server `content` import to build the content source from. Point `agentDiscovery.source` at a file exporting `createComarkSource(() => content)` from `#agent-discovery/comark`, and please report this with the `@nuxt/content` version.')
      }
      return [
        `import { content } from ${JSON.stringify(contentImport)}`,
        `import { createComarkSource } from '#agent-discovery/comark'`,
        `export default createComarkSource(() => content)`
      ].join('\n') + '\n'
    }
  })

  // The same rule as `minimark/stringify` on v3: render with the comark that
  // parsed the tree, not whichever copy the package manager hoisted.
  const comarkRender = await tryResolveModule('comark/render', [contentEntry])
  return { sourcePath: template.dst, alias: comarkRender ? { 'comark/render': comarkRender } : {} }
}

/**
 * Takes `@nuxt/content` out of the `nuxt-llms` bridge, leaving the raw markdown
 * route to the adapter. Works whichever module runs first, since its handler is
 * dropped below as well.
 */
export function disableContentRawMarkdown(nuxt: Nuxt): void {
  const llmsOptions = nuxt.options as unknown as { llms?: Record<string, unknown> }
  llmsOptions.llms = { ...llmsOptions.llms, contentRawMarkdown: false }
}

/**
 * Removes what `@nuxt/content`'s llms feature registered: the raw markdown
 * handler and the nitro plugin, both of which the adapter now covers. The
 * supported off switch (`nuxt.options['content.llms'] = false`) is too late
 * unless this module is listed first, but dropping what the feature registered
 * does not depend on module order.
 */
export function dropContentLlmsFeature(nuxt: Nuxt): void {
  const handlers = nuxt.options.serverHandlers
  for (let i = handlers.length - 1; i >= 0; i--) {
    const handler = handlers[i]!
    if (handler.route === '/raw/**:slug.md' && String(handler.handler).includes('llms')) {
      handlers.splice(i, 1)
    }
  }

  // At `nitro:config` rather than here: `@nuxt/content` does not await that
  // `installModule`, so the plugin lands on a floating promise with no ordering
  // guarantee against `modules:done`.
  nuxt.hook('nitro:config', (nitroConfig) => {
    // Nuxt 4.6 gathers kit registrations on `_serverPlugins` and only writes
    // them into `nitroConfig.plugins` after this hook, so both lists are checked.
    const registered = (nuxt.options as unknown as { _serverPlugins?: { plugin: string }[] })._serverPlugins || []
    const plugins = nitroConfig.plugins || []
    let found = false
    for (let i = registered.length - 1; i >= 0; i--) {
      if (CONTENT_LLMS_PLUGIN.test(String(registered[i]!.plugin))) {
        registered.splice(i, 1)
        found = true
      }
    }
    for (let i = plugins.length - 1; i >= 0; i--) {
      if (CONTENT_LLMS_PLUGIN.test(String(plugins[i]))) {
        plugins.splice(i, 1)
        found = true
      }
    }
    if (found) {
      return
    }

    // Only a feature that actually ran must have left a plugin behind.
    const feature = (nuxt.options._installedModules || []).find(module => module.meta?.configKey === 'content.llms')
    if (feature && !(feature.meta as { disabled?: boolean } | undefined)?.disabled) {
      logger.warn('`@nuxt/content`\'s llms plugin is installed but could not be found to remove it, so `llms.txt` may come out with duplicate sections. Please report this with the `@nuxt/content` version.')
    }
  })
}
