import type { AgentContentSource } from '../../shared/types'

/**
 * Placeholder when no content source is configured: negotiation and discovery
 * still run against whatever already serves the raw markdown.
 */
export default null as AgentContentSource | null
