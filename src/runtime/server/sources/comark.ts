import type { H3Event } from 'h3'
import type { AgentContentSource } from '../../shared/types'

interface ComarkNavigationItem {
  title?: string
  description?: string
  path: string
  page?: false
  children?: ComarkNavigationItem[]
}

interface ComarkLikeContent {
  get: (key: string, opts?: { fresh?: boolean }) => Promise<{ data?: Record<string, unknown>, meta: { kind: string }, nodes: unknown[] } | null | undefined>
  navigation: () => Promise<ComarkNavigationItem[]>
}

/**
 * Adapter factory for `comark-content` backends. comark sites construct their
 * content instance themselves, so pass the accessor in:
 *
 * ```ts
 * // server/utils/agent-source.ts
 * import { createComarkSource } from '#agent-discovery/comark'
 * export default createComarkSource(() => getProdContent())
 * ```
 */
export function createComarkSource(getContent: (event?: H3Event) => Promise<ComarkLikeContent> | ComarkLikeContent): AgentContentSource {
  const collect = (items: ComarkNavigationItem[], entries: { route: string, title?: string, description?: string }[]) => {
    for (const item of items) {
      if (item.page !== false && item.path) {
        entries.push({ route: item.path, title: item.title, description: item.description })
      }
      if (item.children?.length) {
        collect(item.children, entries)
      }
    }
  }

  return {
    async routes(event?: H3Event) {
      const content = await getContent(event)
      const entries: { route: string }[] = []
      collect(await content.navigation(), entries)
      return [...new Set(entries.map(entry => entry.route))]
    },

    async list(event?: H3Event) {
      const content = await getContent(event)
      const entries: { route: string, title?: string, description?: string }[] = []
      collect(await content.navigation(), entries)
      return entries
    },

    async get(route: string, event?: H3Event) {
      const content = await getContent(event)
      const path = route === '/index' ? '/' : route
      const item = await content.get(path)
      if (!item || item.meta.kind !== 'document') {
        return null
      }

      const { renderMarkdown } = await import('comark/render')
      const frontmatter = (item.data || {}) as { title?: string, description?: string }
      const lead = [
        frontmatter.title ? `# ${frontmatter.title}` : '',
        frontmatter.description ? `> ${frontmatter.description}` : ''
      ].filter(Boolean).join('\n\n')

      const body = await renderMarkdown({ nodes: item.nodes as never, frontmatter: item.data as never })
      return {
        markdown: [lead, body].filter(Boolean).join('\n\n'),
        title: frontmatter.title,
        description: frontmatter.description
      }
    }
  }
}
