import { defineEventHandler, setResponseHeader } from 'h3'
import { useNitroApp } from 'nitropack/runtime'
import { getAgentSiteUrl, useAgentDiscoveryConfig } from '../utils/agent-discovery'
import { listAgentPages } from '../utils/pages'
import { MARKDOWN_VARY } from '../../shared/negotiation'

const escapeLabel = (label: string) => label
  .replace(/\\/g, '\\\\')
  .replace(/\[/g, '\\[')
  .replace(/\]/g, '\\]')

/**
 * Markdown index of every page, grouped by first path segment. Pages covered
 * by the negotiation routes link to their raw markdown twin so agents keep
 * getting markdown when they follow them.
 *
 * Through `rawUrl()`, which is the same `rawDestination()` the CDN rewrites,
 * the middleware and the `llms.txt` bridge resolve. Hand-rolling the twin here
 * put `/` on the HTML page while `llms.txt` pointed it at `/raw/index.md`, in
 * two documents an agent reads together, and ignored `raw` overrides.
 *
 * Carries `Vary` like the raw route does, so every markdown document the module
 * serves answers the same way about what its response depends on.
 */
export default defineEventHandler(async (event) => {
  const config = useAgentDiscoveryConfig(event)
  const siteUrl = getAgentSiteUrl(event)

  const entries = await listAgentPages(event)

  const { expand, labels } = config.sitemapSections

  // Top-level pages share one section; anything deeper is grouped by its first
  // segment, or by its second when that prefix is expanded.
  const sectionKey = (route: string): string => {
    const parts = route.split('/').filter(Boolean)
    if (parts.length < 2) {
      return 'pages'
    }
    return expand.includes(`/${parts[0]}`) ? parts[1]! : parts[0]!
  }

  const sections = new Map<string, { title: string, href: string }[]>()
  for (const entry of entries) {
    const key = sectionKey(entry.route)
    const href = entry.rawUrl
    if (!sections.has(key)) {
      sections.set(key, [])
    }
    sections.get(key)!.push({ title: entry.title || entry.route, href })
  }

  // The content adapter only knows the pages it holds. A site with hand-written
  // routes, a Vue-rendered showcase or a design document has no other way to
  // put them in the index an agent reads first.
  await useNitroApp().hooks.callHook('agent-discovery:sitemap', event, sections)

  const siteName = config.siteName || new URL(siteUrl).hostname
  const lines: string[] = [
    `# ${siteName} Sitemap`,
    '',
    `> Markdown index of every page on ${new URL(siteUrl).hostname}. Links point at the raw markdown; append \`.md\` to any page URL (or set \`Accept: text/markdown\`) to get it from the page URL instead.`,
    ''
  ]

  for (const [key, pages] of sections) {
    // Own keys only: a section named `constructor` or `toString` would
    // otherwise read a function off `Object.prototype` and print it as a label.
    const label = (Object.hasOwn(labels, key) && labels[key]) || key.charAt(0).toUpperCase() + key.slice(1).replace(/-/g, ' ')
    lines.push(`## ${label}`, '')
    for (const page of pages) {
      lines.push(`- [${escapeLabel(page.title)}](${page.href})`)
    }
    lines.push('')
  }

  setResponseHeader(event, 'Content-Type', 'text/markdown; charset=utf-8')
  setResponseHeader(event, 'Vary', MARKDOWN_VARY)

  return lines.join('\n')
})
