import type { H3Event } from 'h3'
import type { AgentContentSource, AgentListEntry, AgentSectionSelector } from '../../shared/types'
import { absolutizeMarkdownLinks } from '../../shared/negotiation'
import { getAgentSiteUrl } from '../utils/agent-discovery'

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

/** What a `llms.sections` entry may name for this adapter. */
interface ComarkSelector {
  /** Navigation path whose subtree the section lists, e.g. `/getting-started`. */
  navigation?: string
}

/** Depth-first walk collecting every page node, section label carried down. */
function collect(items: ComarkNavigationItem[], entries: AgentListEntry[], section?: string): void {
  for (const item of items) {
    // A node with children names the group its pages belong to, which is the
    // grouping `comark-docs` built by hand. Its own index page belongs in that
    // group too, not in the ungrouped bucket with the standalone pages.
    const group = item.children?.length ? section ?? item.title : section
    if (item.page !== false && item.path) {
      entries.push({ route: item.path, title: item.title, description: item.description, section: group })
    }
    if (item.children?.length) {
      collect(item.children, entries, group)
    }
  }
}

function findNode(items: ComarkNavigationItem[], path: string): ComarkNavigationItem | undefined {
  for (const item of items) {
    if (item.path === path) {
      return item
    }
    const found = item.children?.length ? findNode(item.children, path) : undefined
    if (found) {
      return found
    }
  }
  return undefined
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
  return {
    async routes(event?: H3Event) {
      const content = await getContent(event)
      const entries: AgentListEntry[] = []
      collect(await content.navigation(), entries)
      return [...new Set(entries.map(entry => entry.route))]
    },

    /**
     * With no selector, every page grouped by its top-level navigation node.
     * With `{ navigation: '/path' }`, that subtree only.
     */
    async list(event?: H3Event, selector?: AgentSectionSelector) {
      const { navigation } = (selector || {}) as ComarkSelector
      if (selector && !navigation) {
        return null
      }

      const content = await getContent(event)
      const tree = await content.navigation()
      const entries: AgentListEntry[] = []

      if (navigation) {
        const node = findNode(tree, navigation)
        if (!node) {
          return null
        }
        collect([node], entries)
        return entries
      }

      collect(tree, entries)
      return entries
    },

    /**
     * A directory node's first page, so `/raw/getting-started.md` redirects to
     * the section's first document the way the HTML page does.
     */
    async firstLeaf(route: string, event?: H3Event) {
      const content = await getContent(event)
      const node = findNode(await content.navigation(), route)
      if (!node) {
        return null
      }
      // Descend to the first node that is actually a page. A section header
      // carries `page: false`, so walking blindly to `children[0]` can redirect
      // to a path whose `get()` returns null, costing a hop to reach a 404.
      const firstPage = (items: ComarkNavigationItem[]): string | undefined => {
        for (const item of items) {
          if (item.page !== false && item.path && item.path !== route) {
            return item.path
          }
          const found = item.children?.length ? firstPage(item.children) : undefined
          if (found) {
            return found
          }
        }
        return undefined
      }
      return (node.children?.length ? firstPage(node.children) : undefined) || null
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
      const markdown = [lead, body].filter(Boolean).join('\n\n')
      return {
        markdown: event ? absolutizeMarkdownLinks(markdown, getAgentSiteUrl(event)) : markdown,
        title: frontmatter.title,
        description: frontmatter.description
      }
    }
  }
}
