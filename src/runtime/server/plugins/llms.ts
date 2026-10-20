import { definePlugin } from 'nitro'
import { useNitroHooks } from 'nitro/app'
import { createLlmsBridge, emitsPrerenderHints } from '../utils/llms'
import { getRequestPath } from '../utils/server'
import type { LlmsOptions } from '../utils/llms'
import type { AgentRequestEvent } from '../../shared/types'

/**
 * The `nuxt-llms` bridge on Nitro 3. `llms.legacy.ts` is the Nitro 2 twin,
 * `createLlmsBridge()` builds both documents.
 */
export default definePlugin(() => {
  // `nuxt-llms` declares neither hook on Nitro 3's table, hence the cast.
  // `useNitroHooks()` creates the table when no plugin has yet.
  const hooks = useNitroHooks() as unknown as {
    hook: (name: string, cb: (...args: never[]) => unknown) => void
  }
  const bridge = createLlmsBridge()

  hooks.hook('llms:generate', (event: AgentRequestEvent, options: LlmsOptions) => bridge.generate(event, options))
  hooks.hook('llms:generate:full', (event: AgentRequestEvent, options: LlmsOptions, contents: string[]) => bridge.generateFull(event, options, contents))

  // Lets the prerender crawler discover twins whose pages are never rendered as
  // HTML. Flushed on `/` because Nitro reads the hint from HTML responses only,
  // and `/llms.txt` goes out as `text/plain`. Encoded per entry, since Nitro
  // splits the header on commas and decodes each part. Nitro 3 has no
  // `beforeResponse`; `response` gets the built response instead.
  if (emitsPrerenderHints(import.meta.preset)) {
    hooks.hook('response', (response: Response, event: AgentRequestEvent) => {
      if (getRequestPath(event) === '/' && bridge.prerenderPaths.size) {
        for (const path of bridge.prerenderPaths) {
          response.headers.append('x-nitro-prerender', encodeURIComponent(path))
        }
      }
    })
  }
})
