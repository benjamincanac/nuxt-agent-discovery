/**
 * Defaults the runtime has to know about too, rather than only the build.
 *
 * The build merges these into `runtimeConfig` so `defaults.ts` stays the one
 * place a reader looks them up, but `runtimeConfig` is overridable per deploy
 * and an override replaces a list wholesale. Anything that has to hold whatever
 * the resolved config says lives here and is applied again at request time.
 */

/**
 * MCP definition groups the public server card hides. Groups come from the
 * subdirectory a definition sits in under `server/mcp/tools`, and
 * `mcpServerCard.excludeGroups` extends this list rather than replacing it: a
 * site naming its own private group should not silently start publishing its
 * admin tools.
 */
export const MCP_EXCLUDED_GROUPS = ['admin']

/**
 * The groups a server card leaves out: the built-in defaults, plus whatever the
 * resolved config carries.
 *
 * The build already merges the two, so `extra` is normally the result of that
 * merge and the union is a no-op. It is not always: `runtimeConfig` is
 * env-overridable, and `NUXT_AGENT_DISCOVERY_MCP_EXCLUDE_GROUPS` replaces the
 * array rather than adding to it. A deploy naming its own groups would drop
 * `admin` off the end of the list and start advertising the admin tools, which
 * is the one thing this default exists to prevent.
 */
export function mcpExcludedGroups(extra?: string[]): Set<string> {
  return new Set([...MCP_EXCLUDED_GROUPS, ...(extra || [])])
}
