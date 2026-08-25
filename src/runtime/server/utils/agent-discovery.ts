import type { H3Event } from 'h3'
import { getRequestURL } from 'h3'
import { useRuntimeConfig } from '#imports'
import type { AgentContentSource, NegotiationConfig } from '../../shared/types'

export function useAgentDiscoveryConfig(event?: H3Event): NegotiationConfig {
  return useRuntimeConfig(event).agentDiscovery as NegotiationConfig
}

/** Configured canonical site URL, falling back to the request origin. */
export function getAgentSiteUrl(event: H3Event): string {
  const config = useAgentDiscoveryConfig(event)
  return config.siteUrl || getRequestURL(event).origin
}

/** Identity helper for typed custom content sources. */
export function defineAgentContentSource(source: AgentContentSource): AgentContentSource {
  return source
}
