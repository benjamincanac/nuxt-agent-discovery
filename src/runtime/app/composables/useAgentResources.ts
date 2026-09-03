import { useRuntimeConfig } from '#imports'
import type { AgentResource } from '../../shared/types'

/**
 * The discovery resources this site publishes, from the same registry the
 * `Link` header and `/.well-known/api-catalog` are built from, hook
 * contributions included.
 *
 * The same list, in the same order, that `renderAgentResources()` writes into
 * the agent homepage and the markdown error bodies. So an HTML error page can
 * offer the recovery links its markdown twin already carries instead of
 * hardcoding a set that drifts from what the site publishes.
 *
 * ```vue
 * <a v-for="resource in useAgentResources()" :key="`${resource.rel} ${resource.href}`" :href="resource.href">
 *   {{ resource.title }}
 * </a>
 * ```
 */
export function useAgentResources(): readonly AgentResource[] {
  // Through `unknown`: a site's generated `runtimeConfig` type narrows this to
  // whatever literal shape it resolved, as `useCanonical` does.
  const publicConfig = useRuntimeConfig().public.agentDiscovery as unknown as { resources?: AgentResource[] } | undefined
  return publicConfig?.resources || []
}
