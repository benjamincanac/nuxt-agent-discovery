import { tryResolveModule, useLogger } from '@nuxt/kit'
import type { Resolver } from '@nuxt/kit'
import type { Nuxt } from '@nuxt/schema'

/**
 * Everything the build does for the `@nuxt/content` backend.
 *
 * Kept in one file because none of it is a public API: the source resolution
 * reaches into the site's own `@nuxt/content` install, and the teardown below
 * finds what the llms feature registered by matching a route string and a
 * plugin path. A major bump moves any of that and the site keeps building, so
 * the whole surface is worth reading in one place. `module.ts` declares the
 * version range this file assumes, through `moduleDependencies`.
 */

const logger = useLogger('nuxt-agent-discovery')

/** `@nuxt/content`'s llms nitro plugin, by the path its feature registers. */
const CONTENT_LLMS_PLUGIN = /features[\\/]llms[\\/]runtime[\\/]server[\\/]content-llms\.plugin/

/**
 * The built-in content adapter: the runtime source, and the stringifier the
 * raw markdown route renders trees with.
 *
 * Takes the module's own `resolve` rather than creating one here. The build
 * bundles everything outside `runtime/` into a single `dist/module.mjs`, so a
 * resolver anchored on this file resolves against `src/build` before packing
 * and against `dist` after it, and the runtime path would come out one
 * directory too high in the published package.
 */
export async function resolveContentSource(nuxt: Nuxt, resolve: Resolver['resolve']): Promise<{ sourcePath: string, minimarkStringify?: string }> {
  const sourcePath = resolve('./runtime/server/sources/content')
  // `minimark` is the tree format `@nuxt/content` stores and serializes
  // with, not a format this module owns: comark sources render through
  // `comark/render` and custom sources bring their own. So the stringifier
  // has to be the one that produced the tree. Resolved from this module's
  // own dependencies it would pin a version that can disagree with the
  // content backend's, and a major bump changes the markdown of every page
  // (attribute serialization, code-fence meta, ...). Resolve it from
  // `@nuxt/content` instead, so the two can never drift.
  const contentEntry = await tryResolveModule('@nuxt/content', nuxt.options.modulesDir)
  const minimarkStringify = contentEntry ? await tryResolveModule('minimark/stringify', [contentEntry]) : undefined
  if (!minimarkStringify) {
    // Points at the cause rather than the symptom: reached with
    // `source: 'content'` on a site that has no `@nuxt/content` at all,
    // where the next failure is an unresolvable `@nuxt/content/server`.
    logger.warn(contentEntry
      ? 'Could not resolve `minimark/stringify` from `@nuxt/content`, so raw markdown may differ from what it produces.'
      : 'The content source is enabled but `@nuxt/content` could not be resolved. Install it, or set `agentDiscovery.source` to a file exporting an `AgentContentSource`.')
  }
  return { sourcePath, minimarkStringify }
}

/**
 * Takes `@nuxt/content` out of the `nuxt-llms` bridge.
 *
 * This module serves the raw markdown route from the adapter, so the route
 * survives a content-backend swap. Works whichever module runs first:
 * `@nuxt/content` normalizes `contentRawMarkdown` into runtime config at
 * `modules:done`, and its handler is dropped below.
 */
export function disableContentRawMarkdown(nuxt: Nuxt): void {
  const llmsOptions = nuxt.options as unknown as { llms?: Record<string, unknown> }
  llmsOptions.llms = { ...llmsOptions.llms, contentRawMarkdown: false }
}

/**
 * Removes what `@nuxt/content`'s llms feature registered.
 *
 * `@nuxt/content` installs that feature from inside its own setup, so the
 * supported off switch (`nuxt.options['content.llms'] = false`, the literal
 * key its `configKey` declares) is already too late unless this module happens
 * to be listed first. Drop what the feature registered instead, which does not
 * depend on module order:
 *
 * - the raw markdown handler, because this module serves that route from the
 *   adapter so it survives a content-backend swap
 * - the nitro plugin, because it builds `llms.txt` sections and renders
 *   `llms-full.txt` through a second markdown pipeline (`toHast` plus
 *   `@nuxtjs/mdc`), which disagrees with what `/raw/**.md` returns and has no
 *   comark equivalent. Both now come from the adapter.
 *
 * Reversible upstream: gating that `installModule` on `@nuxt/content`'s own
 * `options.llms !== false` would make `content: { llms: false }` work and let
 * all of this go.
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
  // `installModule`, so the plugin is registered by a floating promise with no
  // ordering guarantee against `modules:done`. It has always landed in time in
  // practice, but `nitro:config` fires later and receives the same array, so
  // there is nothing to gain by relying on it.
  nuxt.hook('nitro:config', (nitroConfig) => {
    const plugins = nitroConfig.plugins || []
    const index = plugins.findIndex(plugin => CONTENT_LLMS_PLUGIN.test(String(plugin)))
    if (index !== -1) {
      plugins.splice(index, 1)
      return
    }

    // Only a feature that actually ran must have left a plugin behind. A site
    // setting `nuxt.options['content.llms'] = false` itself, or a future
    // `@nuxt/content` without the feature, is not a problem.
    const feature = (nuxt.options._installedModules || []).find(module => module.meta?.configKey === 'content.llms')
    if (feature && !(feature.meta as { disabled?: boolean } | undefined)?.disabled) {
      logger.warn('`@nuxt/content`\'s llms plugin is installed but could not be found to remove it, so `llms.txt` may come out with duplicate sections. Please report this with the `@nuxt/content` version.')
    }
  })
}
