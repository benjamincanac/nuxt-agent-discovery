/* ---- defaults the runtime applies again at request time ---- */

/**
 * MCP definition groups the public server card hides. Groups come from the
 * subdirectory a definition sits in under `server/mcp/tools`, and
 * `mcpServerCard.excludeGroups` extends this list rather than replacing it.
 */
export const MCP_EXCLUDED_GROUPS = ['admin']

/**
 * The groups a server card leaves out: the built-in defaults plus whatever the
 * resolved config carries. `NUXT_AGENT_DISCOVERY_MCP_EXCLUDE_GROUPS` replaces
 * that array rather than adding to it, so the union keeps a deploy-time
 * override from publishing the admin tools.
 */
export function mcpExcludedGroups(extra?: string[]): Set<string> {
  return new Set([...MCP_EXCLUDED_GROUPS, ...(extra || [])])
}

/** Heading of the discovery registry block on the agent homepage. */
export const AGENT_RESOURCES_HEADING = 'Resources for Agents'
