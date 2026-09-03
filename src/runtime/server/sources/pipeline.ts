import { absolutizeTreeLinks } from '../../shared/negotiation'

/**
 * The node shape minimark and comark agree on: `[tag, props, ...children]`.
 * Enough to edit a document without importing either backend.
 */
export type DocNode = [string, Record<string, unknown>?, ...unknown[]]

export interface PrepareDocumentOptions {
  /** Prepended as an `h1` when the body does not open with one. */
  title?: string
  /** Prepended as a blockquote under that title. */
  description?: string
  /** Frontmatter `links`, appended as a list when any carries a label and a target. */
  links?: unknown
  /** Origin site-relative hrefs are resolved against. */
  siteUrl: string
}

/**
 * A highlighter appends a `<style>` node carrying the per-document CSS
 * variables. Neither backend drops it once something follows it, so it goes
 * before the related links are appended.
 */
function removeStyleNodes(nodes: DocNode[]): void {
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (nodes[i]?.[0] === 'style') {
      nodes.splice(i, 1)
    }
  }
}

/**
 * Pushed as nodes, not as a `# ${title}` string, so the title and the
 * description go through the same escaper the body does.
 */
function prependLead(nodes: DocNode[], title?: string, description?: string): void {
  if (Array.isArray(nodes[0]) && nodes[0][0] === 'h1') {
    return
  }
  if (description) {
    nodes.unshift(['blockquote', {}, description])
  }
  if (title) {
    nodes.unshift(['h1', {}, title])
  }
}

/** Related links at the end if present, like `@nuxt/content` does. */
function appendRelatedLinks(nodes: DocNode[], links: unknown): void {
  if (!Array.isArray(links) || links.length === 0) {
    return
  }
  // Frontmatter is user content: a `links: [null]` or a half-filled entry is
  // skipped, not thrown on. A numeric label stays a label, since YAML reads
  // `label: 2024` as a number.
  const items: DocNode[] = []
  for (const link of links) {
    if (typeof link !== 'object' || link === null) {
      continue
    }
    const { label, to } = link as { label?: unknown, to?: unknown }
    if (typeof to !== 'string' || to === '') {
      continue
    }
    if (typeof label !== 'number' && (typeof label !== 'string' || label === '')) {
      continue
    }
    items.push(['li', {}, ['a', { href: to }, String(label)]])
  }
  if (items.length > 0) {
    nodes.push(['hr', {}])
    nodes.push(['ul', {}, ...items])
  }
}

/**
 * Everything both adapters do to a parsed document before handing the tree to
 * their own stringifier, kept in one place because the two renderings have to
 * come out byte-identical. Mutates in place.
 */
export function prepareDocumentTree(nodes: DocNode[], options: PrepareDocumentOptions): void {
  removeStyleNodes(nodes)
  prependLead(nodes, options.title, options.description)
  appendRelatedLinks(nodes, options.links)
  absolutizeTreeLinks(nodes, options.siteUrl)
}
