import source from '#agent-discovery/source'
import { callServerHook } from '#agent-discovery/server'
import { getAgentSiteUrl, useAgentDiscoveryConfig } from './agent-discovery'
import { listAgentPages } from './pages'
import { MARKDOWN_VARY } from '../../shared/negotiation'
import type { AgentRequestEvent } from '../../shared/types'

const escapeLabel = (label: string) => label
  .replace(/\\/g, '\\\\')
  .replace(/\[/g, '\\[')
  .replace(/\]/g, '\\]')

/**
 * Markdown index of every page, grouped by first path segment. Links point at
 * the raw markdown twin, resolved through `rawUrl()` so they cannot drift from
 * the CDN rewrites, the middleware and the `llms.txt` bridge.
 */
export async function sitemapMarkdown(event: AgentRequestEvent): Promise<{ body: string, headers: Record<string, string> }> {
  const config = useAgentDiscoveryConfig(event)
  const siteUrl = getAgentSiteUrl(event)

  const [entries, titles] = await Promise.all([listAgentPages(event), source?.sectionTitles?.(event)])
  const hostname = new URL(siteUrl).hostname
  const siteName = config.siteName || hostname

  const { expand, labels } = config.sitemapSections

  /** The section a page groups under, and the directory route that section is. */
  const sectionOf = (route: string): { key: string, directory?: string } => {
    const parts = route.split('/').filter(Boolean)
    if (parts.length < 2) {
      return { key: 'pages' }
    }
    const depth = expand.includes(`/${parts[0]}`) ? 2 : 1
    return { key: parts[depth - 1]!, directory: `/${parts.slice(0, depth).join('/')}` }
  }

  const sections = new Map<string, { title: string, href: string }[]>()
  const directories = new Map<string, string>()
  for (const entry of entries) {
    const { key, directory } = sectionOf(entry.route)
    if (!sections.has(key)) {
      sections.set(key, [])
    }
    if (directory && !directories.has(key)) {
      directories.set(key, directory)
    }
    // An untitled homepage is the site itself, not a bare `/`.
    sections.get(key)!.push({ title: entry.title || (entry.route === '/' ? siteName : entry.route), href: entry.rawUrl })
  }

  // The adapter only knows the pages it holds, so hand-written routes and
  // Vue-rendered pages are added here.
  await callServerHook('agent-discovery:sitemap', event, sections)

  const lines: string[] = [
    `# ${siteName} Sitemap`,
    '',
    `> Markdown index of every page on ${hostname}. Links point at the raw markdown; append \`.md\` to any page URL (or set \`Accept: text/markdown\`) to get it from the page URL instead.`,
    ''
  ]

  for (const [key, pages] of sections) {
    // Own keys only: a section named `constructor` would otherwise read a
    // function off `Object.prototype` and print it as a label.
    const directory = directories.get(key)
    const label = (Object.hasOwn(labels, key) && labels[key])
      || (directory && titles && Object.hasOwn(titles, directory) && titles[directory])
      || key.charAt(0).toUpperCase() + key.slice(1).replace(/-/g, ' ')
    lines.push(`## ${label}`, '')
    for (const page of pages) {
      lines.push(`- [${escapeLabel(page.title)}](${page.href})`)
    }
    lines.push('')
  }

  return {
    body: lines.join('\n'),
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Vary': MARKDOWN_VARY,
      // Without a configured site URL every URL below embeds the request origin.
      ...(config.siteUrl ? {} : { 'Cache-Control': 'no-cache' })
    }
  }
}
