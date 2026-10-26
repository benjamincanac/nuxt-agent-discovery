import { stringify as stringifyYaml } from 'yaml'
import type { DocNode } from './pipeline'

/** The part of minimark's stringify state these handlers use. */
interface MinimarkState {
  handlers: Record<string, MinimarkHandler | undefined>
  context: { blockSeparator: string }
  one: (node: unknown, state: MinimarkState, parent?: DocNode) => string
}

type MinimarkHandler = (node: DocNode, state: MinimarkState, parent?: DocNode) => string

/** Markdown tags, rendered by minimark or by a handler below. Every other tag is a component. */
const MINIMARK_TAGS = new Set([
  'a', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'img', 'input',
  'li', 'ol', 'p', 'pre', 'strong', 'style', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul'
])

/** Parents whose children are phrasing content, where a component can only be inline. */
const INLINE_PARENTS = new Set(['a', 'del', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'strong', 'td', 'th'])

function textContent(node: unknown): string {
  if (typeof node === 'string') {
    return node
  }
  return Array.isArray(node) ? node.slice(2).map(textContent).join('') : ''
}

function phrasing(node: DocNode, state: MinimarkState): string {
  return node.slice(2).map(child => state.one(child, state, node)).join('')
}

/**
 * Code blocks. minimark fences every block with three backticks, so code
 * holding a fence of its own (a README inside a `md` block) closes the block
 * early and the rest spills into the page. The fence has to outrun the longest
 * backtick run inside the code. minimark also trims the code, which loses its
 * indentation, and drops the highlighted lines.
 */
const pre: MinimarkHandler = (node, state) => {
  const props = node[1] || {}
  const code = String(props.code ?? textContent(node)).replace(/\n$/, '')
  const longest = Math.max(0, ...(code.match(/`+/g) || []).map(run => run.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  const className = ([] as unknown[]).concat(props.className || [])
  const language = props.language || className.map(String).find(name => name.startsWith('language-'))?.slice(9) || ''
  let info = String(language)
  if (props.filename) {
    info += ` [${props.filename}]`
  }
  if (Array.isArray(props.highlights) && props.highlights.length) {
    info += ` {${props.highlights.join(',')}}`
  }
  if (props.meta) {
    info += ` ${props.meta}`
  }
  return `${fence}${info}\n${code}\n${fence}${state.context.blockSeparator}`
}

/** minimark writes these from their text alone, dropping inline code and links inside. */
const strong: MinimarkHandler = (node, state) => `**${phrasing(node, state)}**`
const em: MinimarkHandler = (node, state) => `*${phrasing(node, state)}*`
const del: MinimarkHandler = (node, state) => `~~${phrasing(node, state)}~~`

/** Inline code, keeping the `{lang="ts"}` highlighting hint and any other attribute minimark drops. */
const code: MinimarkHandler = (node) => {
  const { className, language, ...rest } = node[1] || {}
  const text = textContent(node)
  const longest = Math.max(0, ...(text.match(/`+/g) || []).map(run => run.length))
  const fence = '`'.repeat(longest + 1)
  const padded = longest || /^ .* $/.test(text) ? ` ${text} ` : text
  // `lang` puts the `language-*` class back, so only the others are written.
  const classes = ([] as unknown[]).concat(className || []).filter(name => !language || name !== `language-${language}`)
  const props = { ...(language ? { lang: language } : {}), ...(classes.length ? { className: classes } : {}), ...rest }
  return `${fence}${padded}${fence}${inlineAttributes(attributes(props))}`
}

/** minimark numbers every ordered list from 1. Only the first marker counts. */
const ol: MinimarkHandler = (node, state, parent) => {
  const markdown = state.handlers.ol!(node, state, parent)
  const start = Number(node[1]?.start)
  return Number.isInteger(start) && start !== 1 ? markdown.replace(/^(\s*)1\. /, `$1${start}. `) : markdown
}

/**
 * minimark indents a nested list by two spaces whatever the marker, which
 * nests it under `- ` but not under `1. `.
 */
const li: MinimarkHandler = (node, state, parent) => {
  const markdown = state.handlers.li!(node, state, parent)
  const marker = markdown.match(/^\d+\. /)?.[0]
  return marker ? markdown.replace(/\n(?=.)/g, `\n${' '.repeat(marker.length - 2)}`) : markdown
}

/**
 * minimark 0.2 has no handler for it and writes `:br`. The HTML form also
 * holds inside a table cell and when two follow each other.
 */
const br: MinimarkHandler = () => '<br>'

/** minimark drops every attribute but `src` and `alt`. */
const img: MinimarkHandler = (node) => {
  const { src, alt, title, ...rest } = node[1] || {}
  return `![${alt ?? ''}](${src}${title ? ` "${title}"` : ''})${inlineAttributes(attributes(rest))}`
}

const BLOCK_TAGS = new Set(['blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'ol', 'p', 'pre', 'table', 'ul'])

/**
 * A GFM table. minimark writes an HTML table indented under its blank lines,
 * so every row after the first blank line parses back as a code block. A cell
 * holding block content has no GFM form and is left to minimark.
 */
const table: MinimarkHandler = (node, state, parent) => {
  const rows: DocNode[] = []
  for (const child of node.slice(2)) {
    if (Array.isArray(child) && child[0] === 'tr') {
      rows.push(child as DocNode)
    } else if (Array.isArray(child) && (child[0] === 'thead' || child[0] === 'tbody')) {
      rows.push(...child.slice(2).filter((row): row is DocNode => Array.isArray(row) && row[0] === 'tr'))
    }
  }
  const cells = (row: DocNode) => row.slice(2).filter((cell): cell is DocNode => Array.isArray(cell) && (cell[0] === 'th' || cell[0] === 'td'))
  const header = rows[0] && cells(rows[0]).every(cell => cell[0] === 'th') ? rows.shift()! : undefined
  const blocky = (cell: DocNode) => cell.slice(2).some(child => Array.isArray(child) && BLOCK_TAGS.has(String(child[0])))
  if (!header || [header, ...rows].some(row => cells(row).some(blocky))) {
    return state.handlers.html!(node, state, parent)
  }

  const line = (row: DocNode) => `| ${cells(row).map(cell => phrasing(cell, state).replace(/\n/g, ' ').replace(/\|/g, '\\|')).join(' | ')} |`
  const delimiter = cells(header).map((cell) => {
    const align = cell[1]?.align || String(cell[1]?.style || '').match(/text-align:\s*(\w+)/)?.[1]
    return align === 'center' ? ':---:' : align === 'right' ? '---:' : align === 'left' ? ':---' : '---'
  })
  return [line(header), `| ${delimiter.join(' | ')} |`, ...rows.map(line)].join('\n') + state.context.blockSeparator
}

/**
 * Props as the MDC source spells them. The tree holds hast properties, so
 * `className` is an array and goes back to `class`.
 */
function attributes(props: Record<string, unknown>): [string, string][] {
  const entries: [string, string][] = []
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) {
      continue
    }
    const name = key === 'className' ? 'class' : key
    entries.push([name, Array.isArray(value) ? value.join(' ') : typeof value === 'object' ? JSON.stringify(value) : String(value)])
  }
  return entries
}

/**
 * A quoted attribute value. The MDC parser has no escape for the quote
 * character but decodes character references, so a value holding both quotes,
 * or a newline, still comes back unchanged.
 */
function quote(value: string): string {
  const escaped = value.replace(/&(?=#?\w+;)/g, '&amp;').replace(/\n/g, '&#10;')
  if (!escaped.includes('"')) {
    return `"${escaped}"`
  }
  if (!escaped.includes('\'')) {
    return `'${escaped}'`
  }
  return `"${escaped.replace(/"/g, '&quot;')}"`
}

function inlineAttributes(entries: [string, string][]): string {
  return entries.length ? `{${entries.map(([key, value]) => `${key}=${quote(value)}`).join(' ')}}` : ''
}

/** A `:`-prefixed prop holding an array or an object, which `@nuxt/content` stores as JSON. */
function structured(key: string, value: string): unknown {
  if (!key.startsWith(':') || !/^[[{]/.test(value)) {
    return undefined
  }
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

/**
 * Arrays, objects and multi-line strings, which read best as the YAML block
 * the source used, and camelCase names, which an inline attribute lowercases.
 */
function needsYaml(entries: [string, string][]): boolean {
  return entries.some(([key, value]) => /[A-Z]/.test(key) || value.includes('\n') || structured(key, value) !== undefined)
}

function yamlAttributes(entries: [string, string][]): string {
  const data: Record<string, unknown> = {}
  for (const [key, value] of entries) {
    const parsed = structured(key, value)
    if (parsed !== undefined) {
      data[key.slice(1)] = parsed
    } else {
      data[key] = value
    }
  }
  return `---\n${stringifyYaml(data).trimEnd()}\n---`
}

/** Where a component sits: inside phrasing content, and how many block components deep. */
interface Placement {
  inline: boolean
  level: number
}

/** A `template` holding a named slot, written `#name` inside its component. */
function slotName(node: DocNode, level: number): string | undefined {
  const keys = Object.keys(node[1] || {})
  if (node[0] !== 'template' || level === 0 || keys.length !== 1 || !keys[0]!.startsWith('v-slot:') || node[1]![keys[0]!] !== '') {
    return undefined
  }
  return keys[0]!.slice(7)
}

/**
 * Walks the tree once up front. minimark 0.2 does not hand the parent down
 * from its own handlers, so a component inside a paragraph cannot tell from
 * its arguments that it has to stay inline.
 */
function place(nodes: unknown[], placements: WeakMap<DocNode, Placement>, tags: Set<string>, parent?: DocNode, level = 0): void {
  const inline = !!parent && (INLINE_PARENTS.has(parent[0]) || parent.slice(2).some(child => typeof child === 'string'))
  for (const node of nodes) {
    if (!Array.isArray(node)) {
      continue
    }
    const tag = String(node[0])
    let childLevel = level
    if (!MINIMARK_TAGS.has(tag)) {
      tags.add(tag)
      placements.set(node as DocNode, { inline, level })
      if (!inline && slotName(node as DocNode, level) === undefined) {
        childLevel = level + 1
      }
    }
    place(node.slice(2), placements, tags, node as DocNode, childLevel)
  }
}

/**
 * Handlers passed to `minimark/stringify` on top of its own, for what it
 * writes in a form the MDC parser cannot read back. Built per document, since
 * the component handler is registered under every component tag in the tree.
 *
 * Components get their own handler because minimark 0.2, the version
 * `@nuxt/content` resolves, closes every block component with `::` at any
 * depth (a sibling escapes its parent), joins a `className` array with commas,
 * writes JSON props unescaped inside double quotes and multi-line props on
 * one line. There is no narrower hook: its component handler is not exported.
 */
export function minimarkHandlers(nodes: DocNode[], format: string): Record<string, MinimarkHandler> {
  const handlers: Record<string, MinimarkHandler> = Object.assign(Object.create(null), { br, code, del, em, img, li, ol, pre, strong, table })
  if (format !== 'markdown/mdc') {
    return handlers
  }

  const placements = new WeakMap<DocNode, Placement>()
  const tags = new Set<string>()
  place(nodes, placements, tags)

  const component: MinimarkHandler = (node, state) => {
    const [tag, props = {}, ...children] = node
    const entries = attributes(props)
    const { inline, level } = placements.get(node) || { inline: false, level: 0 }
    // The parser drops an explicit `#default` and keeps its content in place,
    // so content following a slot needs it back or it joins that slot.
    let content = ''
    let afterSlot = false
    for (const child of children) {
      const isSlot = Array.isArray(child) && slotName(child as DocNode, level + 1) !== undefined
      if (afterSlot && !isSlot && (typeof child !== 'string' || child.trim())) {
        content += `#default${state.context.blockSeparator.slice(1)}`
      }
      afterSlot = isSlot
      content += state.one(child, state, node)
    }

    // Leading newlines only: a nested block's indentation is part of it. A
    // thematic break right under the opening line would open a props block.
    const body = content.replace(/^\n+/, '').trimEnd().replace(/^---(?=\n|$)/, '***')

    const slot = slotName(node, level)
    if (slot !== undefined) {
      return `#${slot}\n${body}${state.context.blockSeparator}`
    }

    if (inline) {
      return tag === 'span'
        ? `[${content}]${inlineAttributes(entries)}`
        : `:${tag}${content && `[${content}]`}${inlineAttributes(entries)}`
    }

    // Even an empty component is written as a block here: a lone
    // `:tag{prop="value"}` line parses back as a paragraph around it.
    const fence = ':'.repeat(level + 2)
    const head = needsYaml(entries) ? `${fence}${tag}\n${yamlAttributes(entries)}` : `${fence}${tag}${inlineAttributes(entries)}`
    const block = `${head}\n${body && `${body}\n`}${fence}`
    // Nested blocks are indented like the source writes them: unindented, a
    // `#slot` inside one is read as a slot of its parent.
    return (level ? block.replace(/^(?=.)/gm, '  ') : block) + state.context.blockSeparator
  }

  for (const tag of tags) {
    handlers[tag] = component
  }
  return handlers
}
