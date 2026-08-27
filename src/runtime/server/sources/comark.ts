import type { H3Event } from 'h3'
import { useNitroApp } from 'nitropack/runtime'
import type { AgentContentSource, AgentListEntry, AgentSectionSelector } from '../../shared/types'
import { absolutizeTreeLinks } from '../../shared/negotiation'
import { getAgentSiteUrl } from '../utils/agent-discovery'

/** Same shape minimark uses: `[tag, props, ...children]`. */
type ComarkNode = [string, Record<string, unknown>, ...unknown[]]

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

    /**
     * Step for step what the `@nuxt/content` adapter does to a minimark tree,
     * on a comark one. The two have to come out byte-identical: a site moving
     * backend changes the adapter and nothing else, and `test/e2e/expected.ts`
     * is what holds them to it.
     */
    async get(route: string, event: H3Event) {
      const content = await getContent(event)
      const path = route === '/index' ? '/' : route
      const item = await content.get(path)
      if (!item || item.meta.kind !== 'document') {
        return null
      }

      // Copied before anything touches it. The hook below hands this to a
      // site's own transformer, and the link pass bakes a per-request origin
      // into every href, which with `siteUrl: ''` differs between requests.
      // Whether comark's cache hands back a shared object is its business.
      const page = { ...item, nodes: structuredClone(item.nodes) }

      // Lets sites transform the document (MDC components → plain markdown)
      // without replacing the whole source. Called before the nodes are read,
      // so a transformer can swap them wholesale.
      await useNitroApp().hooks.callHook('agent-discovery:document', event, page)

      const nodes = page.nodes as ComarkNode[]
      const frontmatter = (page.data || {}) as { title?: string, description?: string, links?: unknown }

      // comark 0.6 declares `removeLastStyle` and reads it nowhere, so a
      // highlighter's `<style>` node would render into the markdown verbatim.
      // Dropped here rather than at the end for the same reason as the other
      // adapter: the related links below would strand it mid-document.
      for (let i = nodes.length - 1; i >= 0; i--) {
        if (nodes[i]?.[0] === 'style') {
          nodes.splice(i, 1)
        }
      }

      // Pushed as nodes, not as a `# ${title}` string, so the title and the
      // description go through the same escaper the body does.
      if (!(Array.isArray(nodes[0]) && nodes[0][0] === 'h1')) {
        if (frontmatter.description) {
          nodes.unshift(['blockquote', {}, frontmatter.description])
        }
        if (frontmatter.title) {
          nodes.unshift(['h1', {}, frontmatter.title])
        }
      }

      // comark keeps all frontmatter in `data`, with no `meta` split.
      const links = frontmatter.links
      if (Array.isArray(links) && links.length > 0) {
        const items = links
          .filter((link: { label?: string, to?: string }) => link.label && link.to)
          .map((link: { label: string, to: string }) => ['li', {}, ['a', { href: link.to }, link.label]] as ComarkNode)
        if (items.length > 0) {
          nodes.push(['hr', {}])
          nodes.push(['ul', {}, ...items])
        }
      }

      absolutizeTreeLinks(nodes, getAgentSiteUrl(event))

      // `render`, not `renderMarkdown`: the latter routes through
      // `renderFrontmatter`, which re-emits `data` as a YAML block the raw
      // route already writes, and trims the trailing newline the documents
      // are built around. `markdown/html` is the format the minimark
      // stringifier uses, and the one the two agree on.
      //
      // Imported dynamically, so this resolves the site's own comark rather
      // than a copy of ours: the same guarantee the module buys for
      // `minimark/stringify` by aliasing it.
      const { render } = await import('comark/render')
      const markdown = await render({ nodes: nodes as never }, { format: 'markdown/html' })

      // An empty render means a document with no body, the structured-page
      // case the other adapter 404s. With a title there is still a document
      // to serve, the lead above.
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
