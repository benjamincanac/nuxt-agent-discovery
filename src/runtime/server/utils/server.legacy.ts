import type { H3Event } from 'h3'
import { getRequestURL } from 'h3'
import { useNitroApp, useRuntimeConfig } from 'nitropack/runtime'
import type { AgentRequestEvent } from '../../shared/types'

/**
 * The server API the shared helpers reach through `#agent-discovery/server`, on
 * Nitro 2. `server.ts` is the same surface on `nuxt/server`, and the module
 * points the alias at whichever the host runs.
 */

/** The runtime config, the per-request copy when there is a request. */
export function useServerConfig(event?: AgentRequestEvent): Record<string, unknown> {
  return useRuntimeConfig(event as H3Event | undefined)
}

/** Origin of the incoming request. */
export function getRequestOrigin(event: AgentRequestEvent): string {
  return getRequestURL(event as H3Event).origin
}

/** Calls a server runtime hook, the `agent-discovery:*` ones a site registers from a Nitro plugin. */
export async function callServerHook(name: string, ...args: unknown[]): Promise<void> {
  const hooks = useNitroApp().hooks as unknown as { callHook: (name: string, ...args: unknown[]) => Promise<void> }
  await hooks.callHook(name, ...args)
}
