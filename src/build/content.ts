import { tryResolveModule, useLogger } from '@nuxt/kit'
import type { Resolver } from '@nuxt/kit'
import type { Nuxt } from '@nuxt/schema'

/**
 * Build-time glue for the `@nuxt/content` backend. It matches what the llms
 * feature registered by route and plugin path, so it assumes the version range
 * `module.ts` declares through `moduleDependencies`.
 */

const logger = useLogger('nuxt-agent-discovery')

/** `@nuxt/content`'s llms nitro plugin, by the path its feature registers. */
const CONTENT_LLMS_PLUGIN = /features[\\/]llms[\\/]runtime[\\/]server[\\/]content-llms\.plugin/

/**
 * The built-in content adapter: the runtime source, and the stringifier the raw
 * markdown route renders trees with. Takes the module's own `resolve`, since
 * the build packs everything outside `runtime/` into one `dist/module.mjs` and
 * a resolver anchored here would come out a directory too high.
 */
export async function resolveContentSource(nuxt: Nuxt, resolve: Resolver['resolve']): Promise<{ sourcePath: string, minimarkStringify?: string }> {
  const sourcePath = resolve('./runtime/server/sources/content')
  // The stringifier has to be the one that produced the tree: our own
  // `minimark` could pin a major that disagrees with the content backend's.
  const contentEntry = await tryResolveModule('@nuxt/content', nuxt.options.modulesDir)
  const minimarkStringify = contentEntry ? await tryResolveModule('minimark/stringify', [contentEntry]) : undefined
  if (!minimarkStringify) {
    logger.warn(contentEntry
      ? 'Could not resolve `minimark/stringify` from `@nuxt/content`, so raw markdown may differ from what it produces.'
      : 'The content source is enabled but `@nuxt/content` could not be resolved. Install it, or set `agentDiscovery.source` to a file exporting an `AgentContentSource`.')
  }
  return { sourcePath, minimarkStringify }
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
    const plugins = nitroConfig.plugins || []
    const index = plugins.findIndex(plugin => CONTENT_LLMS_PLUGIN.test(String(plugin)))
    if (index !== -1) {
      plugins.splice(index, 1)
      return
    }

    // Only a feature that actually ran must have left a plugin behind.
    const feature = (nuxt.options._installedModules || []).find(module => module.meta?.configKey === 'content.llms')
    if (feature && !(feature.meta as { disabled?: boolean } | undefined)?.disabled) {
      logger.warn('`@nuxt/content`\'s llms plugin is installed but could not be found to remove it, so `llms.txt` may come out with duplicate sections. Please report this with the `@nuxt/content` version.')
    }
  })
}
