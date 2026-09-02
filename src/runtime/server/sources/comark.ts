import type { H3Event } from 'h3'
import { useNitroApp } from 'nitropack/runtime'
import type { AgentContentSource, AgentListEntry, AgentSectionSelector } from '../../shared/types'
import { prepareDocumentTree } from './pipeline'
import type { DocNode } from './pipeline'
import { getAgentSiteUrl } from '../utils/agent-discovery'

interface ComarkNavigationItem {
  title?: string
  description?: string
  path: string
  page?: false
  children?: ComarkNavigationItem[]
}

interface ComarkContentFile {
  data?: Record<string, unknown>
  meta: { kind: string }
  nodes: unknown[]
}

interface ComarkLikeContent {
  get: (key: string, opts?: { fresh?: boolean }) => Promise<ComarkContentFile | null | undefined>
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
    // A node with children names the group its pages belong to, index included.
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
export function createComarkSource(getContent: (event: H3Event) => Promise<ComarkLikeContent> | ComarkLikeContent): AgentContentSource {
  return {
    /**
     * With no selector, every page grouped by its top-level navigation node.
     * With `{ navigation: '/path' }`, that subtree only.
     */
    async list(selector: AgentSectionSelector | undefined, event: H3Event) {
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
    async firstLeaf(route: string, event: H3Event) {
      const content = await getContent(event)
      const node = findNode(await content.navigation(), route)
      if (!node) {
        return null
      }
      // A section header carries `page: false`, so walking to `children[0]`
      // can redirect to a path whose `get()` returns null.
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

    /**
     * The shared document pipeline on a comark tree, with only the fetch and the
     * render around it. Both adapters come out byte-identical, which
     * `test/e2e/expected.ts` holds them to.
     */
    async get(route: string, event: H3Event) {
      const content = await getContent(event)
      const path = route === '/index' ? '/' : route
      const item = await content.get(path)
      if (!item || item.meta.kind !== 'document') {
        return null
      }

      // Copied before anything mutates it, since comark's cache may hand back
      // a shared object.
      const page = { ...item, nodes: structuredClone(item.nodes) }

      // Called before the nodes are read, so a transformer can swap them wholesale.
      await useNitroApp().hooks.callHook('agent-discovery:document', event, page)

      const nodes = page.nodes as DocNode[]
      const frontmatter = (page.data || {}) as { title?: string, description?: string, links?: unknown }

      // comark 0.6 declares `removeLastStyle` and reads it nowhere, so the
      // pipeline drops the `<style>` node. All frontmatter lives in `data`.
      prepareDocumentTree(nodes, {
        title: frontmatter.title,
        description: frontmatter.description,
        links: frontmatter.links,
        siteUrl: getAgentSiteUrl(event)
      })

      // `render`, not `renderMarkdown`: the latter re-emits `data` as a YAML
      // block the raw route already writes and trims the trailing newline.
      // `markdown/html` is the format the minimark stringifier uses. Imported
      // dynamically to resolve the site's own comark rather than a copy of ours.
      const { render } = await import('comark/render')
      const markdown = await render({ nodes: nodes as never }, { format: 'markdown/html' })

      // No body is the structured-page case the other adapter 404s, unless the
      // lead above gives it one.
      if (markdown.trim() === '' && !frontmatter.title) {
        return null
      }

      return {
        markdown,
        title: frontmatter.title,
        description: frontmatter.description
      }
    }
  }
}
