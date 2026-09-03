/**
 * `@nuxtjs/mcp-toolkit`'s listing API, behind the `#agent-discovery/mcp` alias.
 * Aliased to `none.ts` when the toolkit is absent or has bailed out, since this
 * import pulls in the toolkit's own virtual modules.
 */
export { listMcpDefinitions } from '@nuxtjs/mcp-toolkit/server'
