/**
 * `@nuxtjs/mcp-toolkit`'s listing API, behind the `#agent-discovery/mcp`
 * alias. Aliased to `none.ts` when the toolkit is absent or has bailed out,
 * so this import only ever runs where the toolkit's own virtual modules
 * (`#nuxt-mcp-toolkit/tools.mjs`, which `listMcpDefinitions` imports) exist.
 */
export { listMcpDefinitions } from '@nuxtjs/mcp-toolkit/server'
