import { defineEventHandler, setResponseHeader } from 'h3'
import source from '#agent-discovery/source'
import { getAgentSiteUrl, useAgentDiscoveryConfig } from '../utils/agent-discovery'
import { matchRoute } from '../../shared/negotiation'

const escapeLabel = (label: string) => label
  .replace(/\\/g, '\\\\')
  .replace(/\[/g, '\\[')
  .replace(/\]/g, '\\]')

/**
 * Markdown index of every page, grouped by first path segment. Pages covered
 * by the negotiation routes link to their `.md` twin so agents keep getting
 * markdown when they follow them.
 */
export default defineEventHandler(async (event) => {
  const config = useAgentDiscoveryConfig(event)
  const siteUrl = getAgentSiteUrl(event)

  const entries = source
    ? (source.list
        ? await source.list(event)
        : (await source.routes(event)).map(route => ({ route, title: undefined as string | undefined })))
    : []

  const sections = new Map<string, { title: string, href: string }[]>()
  for (const entry of entries) {
    const parts = entry.route.split('/').filter(Boolean)
    const key = parts.length > 1 ? parts[0]! : 'pages'
    const negotiated = matchRoute(config.routes, entry.route)
    const href = negotiated && entry.route !== '/'
      ? `${siteUrl}${entry.route}.md`
      : `${siteUrl}${entry.route === '/' ? '' : entry.route}` || siteUrl
    if (!sections.has(key)) {
      sections.set(key, [])
    }
    sections.get(key)!.push({ title: entry.title || entry.route, href })
  }

  const siteName = config.siteName || new URL(siteUrl).hostname
  const lines: string[] = [
    `# ${siteName} Sitemap`,
    '',
    `> Markdown index of every page on ${new URL(siteUrl).hostname}. Append \`.md\` to any page URL (or set \`Accept: text/markdown\`) to retrieve the markdown source.`,
    ''
  ]

  for (const [key, pages] of sections) {
    const label = key.charAt(0).toUpperCase() + key.slice(1).replace(/-/g, ' ')
    lines.push(`## ${label}`, '')
    for (const page of pages) {
      lines.push(`- [${escapeLabel(page.title)}](${page.href})`)
    }
    lines.push('')
  }

  setResponseHeader(event, 'Content-Type', 'text/markdown; charset=utf-8')
  return lines.join('\n')
})
