import { getRequestURL, useRuntimeConfig, useServerHooks } from 'nuxt/server'
import type { RequestEvent } from 'nuxt/server'
import type { AgentRequestEvent } from '../../shared/types'

/**
 * The server API the shared helpers reach through `#agent-discovery/server`, on
 * `nuxt/server`. `server.legacy.ts` is the same surface on Nitro 2, and the
 * module points the alias at whichever the host runs.
 */

/** The runtime config. There is one shared copy, so the request is not needed. */
export function useServerConfig(_event?: AgentRequestEvent): Record<string, unknown> {
  return useRuntimeConfig() as unknown as Record<string, unknown>
}

/** Origin of the incoming request. */
export function getRequestOrigin(event: AgentRequestEvent): string {
  return getRequestURL(event as RequestEvent).origin
}

/**
 * Calls a server runtime hook, the `agent-discovery:*` ones a site registers
 * through `useServerHooks()` or a Nitro plugin, which share one hookable.
 */
export async function callServerHook(name: string, ...args: unknown[]): Promise<void> {
  const hooks = useServerHooks() as unknown as { callHook: (name: string, ...args: unknown[]) => Promise<void> | void }
  await hooks.callHook(name, ...args)
}
