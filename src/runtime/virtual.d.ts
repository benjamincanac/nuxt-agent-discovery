/**
 * `@nuxt/content`'s collection manifest. Declared, not typed: the shape belongs
 * to that module, and the one call site casts it. Only the module's own
 * type-check sees this, since a site building against `@nuxt/content` resolves
 * the real declaration.
 */
declare module '#content/manifest' {
  const collections: unknown
  export default collections
}

declare module '#agent-discovery/source' {
  const source: import('./shared/types').AgentContentSource | null
  export default source
}

/**
 * `@nuxtjs/mcp-toolkit`'s listing API when the site runs it, `null` otherwise.
 * The module picks the alias target, so the runtime null-checks it.
 */
declare module '#agent-discovery/mcp' {
  export const listMcpDefinitions: ((options?: { event?: import('h3').H3Event }) => Promise<{
    tools: { name: string, description?: string, group?: string }[]
    resources: { name: string, uri?: string, description?: string, group?: string }[]
    prompts: { name: string, description?: string, group?: string }[]
  }>) | null
}

declare module 'comark/render' {
  export function render(document: { nodes: unknown[] }, options?: Record<string, unknown>): Promise<string>
  export function renderMarkdown(document: { nodes: unknown[], frontmatter?: unknown }, options?: Record<string, unknown>): Promise<string>
}
