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
 * Markdown index of every page, grouped by first path segment. Links point at
 * the raw markdown twin, resolved through `rawUrl()` so they cannot drift from
 * the CDN rewrites, the middleware and the `llms.txt` bridge.
 */
export default defineEventHandler(async (event) => {
  const config = useAgentDiscoveryConfig(event)
  const siteUrl = getAgentSiteUrl(event)

  const entries = await listAgentPages(event)

  const { expand, labels } = config.sitemapSections

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
    if (!sections.has(key)) {
      sections.set(key, [])
    }
    sections.get(key)!.push({ title: entry.title || entry.route, href: entry.rawUrl })
  }

  // The adapter only knows the pages it holds, so hand-written routes and
  // Vue-rendered pages are added here.
  await useNitroApp().hooks.callHook('agent-discovery:sitemap', event, sections)

  const hostname = new URL(siteUrl).hostname
  const siteName = config.siteName || hostname
  const lines: string[] = [
    `# ${siteName} Sitemap`,
    '',
    `> Markdown index of every page on ${hostname}. Links point at the raw markdown; append \`.md\` to any page URL (or set \`Accept: text/markdown\`) to get it from the page URL instead.`,
    ''
  ]

  for (const [key, pages] of sections) {
    // Own keys only: a section named `constructor` would otherwise read a
    // function off `Object.prototype` and print it as a label.
    const label = (Object.hasOwn(labels, key) && labels[key]) || key.charAt(0).toUpperCase() + key.slice(1).replace(/-/g, ' ')
    lines.push(`## ${label}`, '')
    for (const page of pages) {
      lines.push(`- [${escapeLabel(page.title)}](${page.href})`)
    }
    lines.push('')
  }

  setResponseHeader(event, 'Content-Type', 'text/markdown; charset=utf-8')
  setResponseHeader(event, 'Vary', MARKDOWN_VARY)
  // Without a configured site URL every URL below embeds the request origin.
  if (!config.siteUrl) {
    setResponseHeader(event, 'Cache-Control', 'no-cache')
  }

  return lines.join('\n')
})
