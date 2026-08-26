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

declare module 'comark/render' {
  export function renderMarkdown(document: { nodes: unknown[], frontmatter?: unknown }, options?: Record<string, unknown>): Promise<string>
}
