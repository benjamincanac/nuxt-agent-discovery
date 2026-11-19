import type { AgentContentSource, AgentListEntry, AgentRequestEvent, AgentSectionSelector } from '../../shared/types'
import { createComarkSource } from './comark'
import type { ComarkLikeContent } from './comark'
import { titleCase } from './pipeline'

interface ListedFile {
  path: string
  data?: { title?: string, description?: string, seo?: { title?: string } }
  meta: { type?: string, stem: string }
}

/** One comark-content instance, a v3 collection in v4's compatibility mode. */
interface ContentInstance {
  name: string
  list: () => Promise<ListedFile[]>
}

/** v4's server `content`: one instance, or a hub of one per collection. */
type NuxtContent = ComarkLikeContent & Partial<ContentInstance> & { instances?: ContentInstance[] }

/** The page title, as the v3 adapter reads it, rather than the navigation's. */
const pageTitle = (file: ListedFile) => file.data?.title || file.data?.seo?.title

/** Every instance's files, in hub order. */
async function listInstances(content: NuxtContent): Promise<{ name: string, files: ListedFile[] }[]> {
  const instances = content.instances || [content as ContentInstance]
  return Promise.all(instances.map(async instance => ({ name: instance.name, files: await instance.list() })))
}

/**
 * The built-in `@nuxt/content` v4 adapter: the comark adapter, with the
 * listing the v3 adapter gives. Pages are titled from their frontmatter and
 * grouped by the instance they come from, which v4 creates per collection.
 */
export function createContentSource(getContent: (event: AgentRequestEvent) => NuxtContent | Promise<NuxtContent>): AgentContentSource {
  const comark = createComarkSource(getContent)
  return {
    ...comark,

    async list(selector: AgentSectionSelector | undefined, event: AgentRequestEvent) {
      // A `navigation` selector walks the tree, which carries `navigation.title`.
      if (selector) {
        const entries = await comark.list!(selector, event)
        if (!entries) {
          return null
        }
        const files = (await listInstances(await getContent(event))).flatMap(instance => instance.files)
        const titles = new Map(files.map(file => [file.path, pageTitle(file)]))
        return entries.map(entry => ({ ...entry, title: titles.get(entry.route) || entry.title }))
      }

      return (await listInstances(await getContent(event))).flatMap(({ name, files }) => files
        // Markdown only, the pages v4 applies the v3 page defaults to.
        .filter(file => file.meta.type === 'text/markdown')
        // By `stem`, as v3 orders its query, with the homepage back on top.
        .sort((a, b) => Number(b.path === '/') - Number(a.path === '/') || (a.meta.stem < b.meta.stem ? -1 : a.meta.stem > b.meta.stem ? 1 : 0))
        .map((file): AgentListEntry => ({
          route: file.path,
          title: pageTitle(file),
          description: file.data?.description,
          section: titleCase(name)
        })))
    }
  }
}
