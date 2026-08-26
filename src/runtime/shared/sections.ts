/**
 * Narrows a markdown document to the `##` sections an agent asked for,
 * keeping the frontmatter, the title and the description.
 *
 * A docs page is often far longer than the part of it that answers a
 * question, and an agent that has to read all of it pays for the rest in
 * context. This is the function every site running an MCP `get-page` tool
 * ends up writing.
 *
 * Two copies of it exist in the wild and each fixed a bug the other still
 * has: one bounds the header scan at the first `##`, so a page with no
 * description doesn't swallow the whole document, but returns just the title
 * when nothing matched, which makes the agent fetch the page again; the other
 * falls back to the full document but lost the bound. This has both, plus the
 * frontmatter skip the raw route's output needs.
 */
export function extractSections(markdown: string, sectionTitles: string[]): string {
  const wanted = new Set(sectionTitles.map(title => title.toLowerCase().trim()))
  if (!wanted.size) {
    return markdown
  }

  const lines = markdown.split('\n')
  const result: string[] = []
  let start = 0

  // The raw route opens every document with a frontmatter block, and a YAML
  // block scalar (`description: >`) inside it would otherwise read as the
  // description blockquote and end the header scan early.
  if (lines[0] === '---') {
    const close = lines.indexOf('---', 1)
    if (close !== -1) {
      result.push(...lines.slice(0, close + 1))
      start = close + 1
    }
  }

  // The title and the description, however few lines that turns out to be.
  // Bounded by the first `##`: a page with no description blockquote would
  // otherwise push its entire body in here and then repeat the matched
  // sections below it.
  for (let index = start; index < lines.length; index++) {
    const line = lines[index]!
    if (line.startsWith('## ')) {
      break
    }
    result.push(line)
    if (line.startsWith('>')) {
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

  for (let index = start; index < lines.length; index++) {
    const line = lines[index]!
    if (line.startsWith('## ')) {
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

  // Nothing matched, so the agent named sections this page doesn't have.
  // Handing back the title alone would just make it ask again without the
  // argument; the whole document answers the question it was really asking.
  if (!matched) {
    return markdown
  }

  return result.join('\n').trim()
}
