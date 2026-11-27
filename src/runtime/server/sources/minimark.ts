import { stringify as stringifyYaml } from 'yaml'
import type { DocNode } from './pipeline'

/** The part of minimark's stringify state these handlers use. */
interface MinimarkState {
  handlers: Record<string, MinimarkHandler | undefined>
  context: { blockSeparator: string, format: string, list?: boolean, order?: number | false, start?: number }
  applyContext: (edit: Record<string, unknown>) => Record<string, unknown>
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

/**
 * Inline code, keeping the `{lang="ts"}` highlighting hint minimark drops. The
 * class and style are the highlighter's output (`shiki`, theme names, CSS
 * variables), not something the source wrote, so they stay out.
 */
const code: MinimarkHandler = (node, state) => {
  const { className: _className, style: _style, language, ...rest } = node[1] || {}
  const text = textContent(node)
  const longest = Math.max(0, ...(text.match(/`+/g) || []).map(run => run.length))
  const fence = '`'.repeat(longest + 1)
  const padded = longest || /^ .* $/.test(text) ? ` ${text} ` : text
  return `${fence}${padded}${fence}${mdcAttributes(state, language ? { lang: language, ...rest } : rest)}`
}

const BLOCK_TAGS = new Set(['blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'ol', 'p', 'pre', 'table', 'ul'])

/** A block, or a component holding one, which the parser only reads as a block component. */
function isBlock(node: unknown): node is DocNode {
  if (!Array.isArray(node)) {
    return false
  }
  const tag = String(node[0])
  return BLOCK_TAGS.has(tag) || (!MINIMARK_TAGS.has(tag) && node.slice(2).some(child => Array.isArray(child) && BLOCK_TAGS.has(String(child[0]))))
}

/** minimark numbers every ordered list from 1. The items read `start` back from the context. */
const ol: MinimarkHandler = (node, state, parent) => {
  const start = Number(node[1]?.start)
  const revert = state.applyContext({ start: Number.isInteger(start) ? start : 1 })
  const markdown = state.handlers.ol!(node, state, parent)
  state.applyContext(revert)
  return markdown
}

/**
 * minimark joins an item's children as they come, so a code block, a table or
 * a nested list lands on the line of the text before it. Each block goes on
 * lines of its own, indented under the marker so it stays in the item.
 */
const li: MinimarkHandler = (node, state) => {
  const children = node.slice(2)
  const order = state.context.order
  const marker = order ? `${order + (state.context.start ?? 1) - 1}. ` : '- '
  let prefix = marker
  if (([] as unknown[]).concat(node[1]?.className || []).join(' ').includes('task-list-item')) {
    const input = children[0]
    if (Array.isArray(input) && input[0] === 'input') {
      children.shift()
      prefix += input[1]?.checked ? '[x] ' : '[ ] '
    }
  }

  let body = ''
  let text = ''
  const push = (block: string, tight = false) => {
    if (block) {
      body += `${body && (tight ? '\n' : '\n\n')}${block}`
    }
  }
  for (const child of children) {
    if (!isBlock(child)) {
      text += state.one(child, state, node)
      continue
    }
    push(text.trim())
    // No blank line where the source had none: the parser keeps the line break
    // on the text, and a list right under it reads the same either way.
    const tight = Boolean(text.trim()) && (text.endsWith('\n') || child[0] === 'ul' || child[0] === 'ol')
    // Outside the list context, where minimark would indent a nested list itself.
    const revert = state.applyContext({ list: false })
    // Leading newlines only: a nested component's indentation is part of it.
    push(state.one(child, state, node).replace(/^\n+/, '').trimEnd(), tight)
    state.applyContext(revert)
    text = ''
  }
  push(text.trim())

  if (order) {
    state.applyContext({ order: order + 1 })
  }
  return `${prefix}${body.replace(/\n(?=.)/g, `\n${' '.repeat(marker.length)}`)}\n`
}

/**
 * minimark 0.2 has no handler for it and writes `:br`. The HTML form also
 * holds inside a table cell and when two follow each other.
 */
const br: MinimarkHandler = () => '<br>'

/** minimark drops every attribute but `src` and `alt`. */
const img: MinimarkHandler = (node, state) => {
  const { src, alt, title, ...rest } = node[1] || {}
  return `![${alt ?? ''}](${src}${title ? ` "${title}"` : ''})${mdcAttributes(state, rest)}`
}

const cells = (row: DocNode) => row.slice(2).filter((cell): cell is DocNode => Array.isArray(cell) && (cell[0] === 'th' || cell[0] === 'td'))

/** A table's header and body rows, or `undefined` when it has no GFM form. */
function gfmTable(node: DocNode): { header: DocNode, rows: DocNode[] } | undefined {
  const rows: DocNode[] = []
  for (const child of node.slice(2)) {
    if (Array.isArray(child) && child[0] === 'tr') {
      rows.push(child as DocNode)
    } else if (Array.isArray(child) && (child[0] === 'thead' || child[0] === 'tbody')) {
      rows.push(...child.slice(2).filter((row): row is DocNode => Array.isArray(row) && row[0] === 'tr'))
    }
  }
  const header = rows[0] && cells(rows[0]).every(cell => cell[0] === 'th') ? rows.shift()! : undefined
  const blocky = (cell: DocNode) => cell.slice(2).some(child => Array.isArray(child) && BLOCK_TAGS.has(String(child[0])))
  return header && ![header, ...rows].some(row => cells(row).some(blocky)) ? { header, rows } : undefined
}

/**
 * A GFM table. minimark writes an HTML table indented under its blank lines,
 * so every row after the first blank line parses back as a code block. A cell
 * holding block content has no GFM form and is left to minimark.
 */
const table: MinimarkHandler = (node, state, parent) => {
  const gfm = gfmTable(node)
  if (!gfm) {
    return state.handlers.html!(node, state, parent)
  }
  const { header, rows } = gfm

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
    // MDC has no typed boolean attribute: the parser reads `{disabled}` and a
    // YAML `disabled: true` as a bound `:disabled`, so that is what is written.
    if (typeof value === 'boolean') {
      entries.push([`:${key}`, String(value)])
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

/** Attributes after an inline element, which only the MDC syntax has. */
function mdcAttributes(state: MinimarkState, props: Record<string, unknown>): string {
  return state.context.format === 'markdown/mdc' ? inlineAttributes(attributes(props)) : ''
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
    } else if (key.startsWith(':') && (value === 'true' || value === 'false')) {
      data[key.slice(1)] = value === 'true'
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

/** Whether a component sits in phrasing content. A list item holds its text bare, next to any block component under it. */
function isInline(node: DocNode, parent?: DocNode): boolean {
  return !!parent && (INLINE_PARENTS.has(parent[0]) || (parent.slice(2).some(child => typeof child === 'string') && !isBlock(node)))
}

/**
 * Walks the tree once up front. minimark 0.2 does not hand the parent down
 * from its own handlers, so a component inside a paragraph cannot tell from
 * its arguments that it has to stay inline.
 */
function place(nodes: unknown[], placements: WeakMap<DocNode, Placement>, tags: Set<string>, parent?: DocNode, level = 0): void {
  for (const node of nodes) {
    if (!Array.isArray(node)) {
      continue
    }
    const inline = isInline(node as DocNode, parent)
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

/*
 * Text escaping. minimark 0.2 writes a text node as it is, so a literal the
 * source escaped (`\# hash`, `\*not em\*`, `&lt;b&gt;`) comes back as the
 * syntax it was escaped from. The rules are comark's own, so both adapters
 * write the same bytes: only what would parse back differently is escaped.
 */

const INLINE_SYNTAX = /[\\`*_<&~[\]{:]/g
const ALPHANUMERIC = /^[a-z0-9]$/i
/** Characters after which `:name` opens an inline component. */
const COMPONENT_COLON_PREV = new Set([' ', '\t', '\n', '*', '_', '[', ']', '}', ')', '>'])
const OPEN_TAG_START = /<\/?[a-z][a-z0-9-]*[\s/]/iy

function escapeInline(text: string): string {
  return text.replace(INLINE_SYNTAX, (char: string, offset: number) => {
    const prev = text[offset - 1]
    const next = text[offset + 1]
    switch (char) {
      // Intraword, an underscore cannot open or close emphasis.
      case '_':
        return prev && next && ALPHANUMERIC.test(prev) && ALPHANUMERIC.test(next) ? char : `\\${char}`
      case '<':
        if (!next || !/[a-z!?/]/i.test(next)) {
          return char
        }
        // With no `>` after it, only an opening tag name still reads as HTML.
        OPEN_TAG_START.lastIndex = offset
        return text.includes('>', offset + 1) || OPEN_TAG_START.test(text) ? `\\${char}` : char
      case '&':
        return /^&#?[a-z0-9]+;/i.test(text.slice(offset)) ? `\\${char}` : char
      case ':':
        return (prev === undefined || COMPONENT_COLON_PREV.has(prev)) && next !== undefined && /[a-z$]/i.test(next) ? `\\${char}` : char
      case '{':
        return prev !== '{' && prev !== '$' && /^\{[ \t]{0,3}[.#:a-z_]/i.test(text.slice(offset, offset + 6)) ? `\\${char}` : char
      default:
        return `\\${char}`
    }
  })
}

/** A line opening with what would parse as a block: a heading, a quote, a list item, a setext underline, a component. */
function escapeLineStart(line: string): string {
  const ordered = /^(\d{1,9})[.)]([ \t]|$)/.exec(line)
  if (ordered) {
    return `${ordered[1]}\\${line.slice(ordered[1]!.length)}`
  }
  return /^#{1,6}([ \t]|$)/.test(line) || /^-([ \t-]|$)/.test(line) || /^\+([ \t]|$)/.test(line) || /^=+[ \t]*$/.test(line) || line[0] === '>' || line[0] === ':'
    ? `\\${line}`
    : line
}

function escapeTextNode(text: string, atLineStart: boolean): string {
  const escaped = escapeInline(text)
  if (!atLineStart && !escaped.includes('\n')) {
    return escaped
  }
  return escaped.split('\n').map((line, index) => index > 0 || atLineStart ? escapeLineStart(line) : line).join('\n')
}

/** Subtrees written verbatim, where an escape would show. */
const VERBATIM_TAGS = new Set(['code', 'pre', 'script', 'style'])

/** Whether a node's first text child starts a line of the output. */
function startsLine(node: DocNode | undefined, parent: DocNode | undefined): boolean {
  if (!node) {
    return true
  }
  const tag = String(node[0])
  if (tag === 'blockquote' || tag === 'li' || tag === 'p') {
    return true
  }
  return !MINIMARK_TAGS.has(tag) && !isInline(node, parent)
}

/**
 * Escapes every text node in place, before `minimark/stringify` runs: it has no
 * handler for text. `container` is the root array or a node, whose children
 * start at `offset`.
 */
export function escapeMinimarkText(container: unknown[], offset = 0, node?: DocNode, parent?: DocNode): void {
  const lineStarts = startsLine(node, parent)
  let atLineStart = lineStarts
  for (let index = offset; index < container.length; index++) {
    const child = container[index]
    if (typeof child === 'string') {
      container[index] = escapeTextNode(child, atLineStart)
      atLineStart = lineStarts && child.endsWith('\n')
      continue
    }
    if (!Array.isArray(child)) {
      continue
    }
    const tag = String(child[0])
    // A table with no GFM form goes out as HTML, where a backslash is literal.
    if (!VERBATIM_TAGS.has(tag) && (tag !== 'table' || gfmTable(child as DocNode))) {
      escapeMinimarkText(child, 2, child as DocNode, node)
    }
    // A task item's checkbox is written as part of the marker.
    atLineStart = lineStarts && (isBlock(child) || (tag === 'input' && atLineStart))
  }
}
