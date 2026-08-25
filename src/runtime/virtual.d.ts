declare module '#agent-discovery/source' {
  const source: import('./shared/types').AgentContentSource | null
  export default source
}

declare module 'comark/render' {
  export function renderMarkdown(document: { nodes: unknown[], frontmatter?: unknown }, options?: Record<string, unknown>): Promise<string>
}
