import { createFenceTracker } from './negotiation'

/**
 * Narrows a markdown document to the `##` sections an agent asked for, keeping
 * the frontmatter, the title and the description. A docs page is often far
 * longer than the part of it that answers a question.
 */
export function extractSections(markdown: string, sectionTitles: string[]): string {
  const wanted = new Set(sectionTitles.map(title => title.toLowerCase().trim()))
  if (!wanted.size) {
    return markdown
  }

  const lines = markdown.split('\n')
  const result: string[] = []
  let start = 0

  // A YAML block scalar (`description: >`) in the frontmatter would otherwise
  // read as the description blockquote and end the header scan early.
  if (lines[0] === '---') {
    const close = lines.indexOf('---', 1)
    if (close !== -1) {
      result.push(...lines.slice(0, close + 1))
      start = close + 1
    }
  }

  // Title and description, bounded by the first `##`: a page with no description
  // blockquote would otherwise push its entire body in here.
  const headerFence = createFenceTracker()
  for (let index = start; index < lines.length; index++) {
    const line = lines[index]!
    const fenced = headerFence(line)
    if (!fenced && line.startsWith('## ')) {
      break
    }
    result.push(line)
    if (!fenced && line.startsWith('>')) {
      result.push('')
      break
    }
  }

  let current: string | null = null
  let section: string[] = []
  let matched = false

  const take = () => {
    if (current && wanted.has(current.toLowerCase())) {
      result.push(...section)
      result.push('')
      matched = true
    }
  }

  // A fenced example that documents headings starts lines with `## ` too.
  const bodyFence = createFenceTracker()
  for (let index = start; index < lines.length; index++) {
    const line = lines[index]!
    if (!bodyFence(line) && line.startsWith('## ')) {
      take()
      current = line.slice(3).trim()
      section = [line]
      continue
    }
    if (current) {
      section.push(line)
    }
  }
  take()

  // Nothing matched, so the agent named sections this page doesn't have. The
  // title alone would just make it ask again without the argument.
  if (!matched) {
    return markdown
  }

  return result.join('\n').trim()
}
