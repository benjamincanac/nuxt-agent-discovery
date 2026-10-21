import type { H3Event } from 'h3'
import { appendHeader } from 'h3'
import type { NitroApp } from 'nitropack/types'
import { defineNitroPlugin } from 'nitropack/runtime'
import { createLlmsBridge, emitsPrerenderHints } from '../utils/llms'
import type { LlmsOptions } from '../utils/llms'

/** The `nuxt-llms` bridge on Nitro 2. `createLlmsBridge()` builds both documents. */
export default defineNitroPlugin((nitroApp: NitroApp) => {
  const bridge = createLlmsBridge()

  nitroApp.hooks.hook('llms:generate' as never, ((event: H3Event, options: LlmsOptions) => bridge.generate(event, options)) as never)
  nitroApp.hooks.hook('llms:generate:full' as never, ((event: H3Event, options: LlmsOptions, contents: string[]) => bridge.generateFull(event, options, contents)) as never)

  // Lets the prerender crawler discover twins whose pages are never rendered as
  // HTML. Flushed on `/` because Nitro reads the hint from HTML responses only,
  // and `/llms.txt` goes out as `text/plain`. Encoded per entry, since Nitro
  // splits the header on commas and decodes each part.
  if (emitsPrerenderHints(import.meta.preset)) {
    nitroApp.hooks.hook('beforeResponse', (event) => {
      if (event.path === '/' && bridge.prerenderPaths.size) {
        appendHeader(event, 'x-nitro-prerender', Array.from(bridge.prerenderPaths, path => encodeURIComponent(path)))
      }
    })
  }
})
