/**
 * `@nuxt/content`'s collection manifest, declared but not typed. Only the
 * module's own type-check sees this, since a site resolves the real declaration.
 */
declare module '#content/manifest' {
  const collections: unknown
  export default collections
}

declare module '#agent-discovery/source' {
  const source: import('./shared/types').AgentContentSource | null
  export default source
}

/** `@nuxtjs/mcp-toolkit`'s listing API when the site runs it, `null` otherwise. */
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
