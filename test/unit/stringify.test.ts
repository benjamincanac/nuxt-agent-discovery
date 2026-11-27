import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { tryResolveModule } from '@nuxt/kit'
import { minimarkHandlers } from '../../src/runtime/server/sources/minimark'
import { prepareDocumentTree } from '../../src/runtime/server/sources/pipeline'
import type { DocNode } from '../../src/runtime/server/sources/pipeline'

/**
 * The `@nuxt/content` adapter's stringification, against the parser that
 * produced the tree. Everything is resolved from `@nuxt/content` itself, the
 * way the module resolves `minimark/stringify`, so this runs the minimark a
 * site actually gets rather than this repository's own copy.
 */
const contentEntry = await tryResolveModule('@nuxt/content', [import.meta.url])
const resolveFromContent = async (id: string) => (await tryResolveModule(id, [contentEntry!]))!
const { stringify } = await import(await resolveFromContent('minimark/stringify'))
const { fromHast } = await import(await resolveFromContent('minimark/hast'))
const { parseMarkdown } = await import(await resolveFromContent('@nuxtjs/mdc/runtime'))

/** What `@nuxt/content`'s markdown transformer stores as `page.body.value`. */
async function parse(markdown: string): Promise<DocNode[]> {
  const parsed = await parseMarkdown(markdown, { highlight: false, toc: false })
  return fromHast(parsed.body).value
}

/** What `sources/content.ts` hands back as the page markdown. */
function render(nodes: DocNode[]): string {
  return stringify({ type: 'minimark', value: nodes }, { format: 'markdown/mdc', handlers: minimarkHandlers(nodes, 'markdown/mdc') })
}

// The playground page holding every construct the raw markdown used to lose.
const fixture = await readFile(new URL('../../playground/content/docs/markdown.md', import.meta.url), 'utf8')

describe('content stringify: code fences', () => {
  it('fences code holding a fence one backtick longer than its longest run', async () => {
    const code = '# Title\n\n```bash\nnpm i\n```\n'
    const markdown = render([['pre', { language: 'md', filename: 'README.md', code }, ['code', {}, code]]])

    expect(markdown).toBe('````md [README.md]\n# Title\n\n```bash\nnpm i\n```\n````\n')
  })

  it('keeps three backticks around ordinary code', async () => {
    const code = 'const a = `b`\n'
    const markdown = render([['pre', { language: 'ts', code }, ['code', {}, code]]])

    expect(markdown).toBe('```ts\nconst a = `b`\n```\n')
  })
})

describe('content stringify: components', () => {
  it('writes a multi-class `class` as the attribute the source used', async () => {
    const markdown = render(await parse('::hero{class="dark:bg-gradient-to-b from-neutral-900 to-neutral-950"}\nBody\n::\n'))

    expect(markdown).toContain('::hero{class="dark:bg-gradient-to-b from-neutral-900 to-neutral-950"}')
  })

  it('writes array props as a YAML block', async () => {
    const markdown = render(await parse('::cta\n---\nlinks:\n  - label: Start\n    to: /start\n---\nBody\n::\n'))

    expect(markdown).toBe('::cta\n---\nlinks:\n  - label: Start\n    to: /start\n---\nBody\n::\n')
  })

  it('adds a colon per level of nesting, so siblings stay inside their parent', async () => {
    const markdown = render(await parse('::section\n  :::button\n  One\n  :::\n\n  :::button\n  Two\n  :::\n::\n'))

    expect(markdown).toBe('::section\n  :::button\n  One\n  :::\n\n  :::button\n  Two\n  :::\n::\n')
  })

  it('writes a boolean prop the way the parser reads one back', async () => {
    // Typed booleans only come from raw HTML or a hook; MDC reads them back bound.
    const markdown = render([['u-button', { disabled: true, open: false }, ['p', {}, 'Go']]])

    expect(markdown).toBe('::u-button{:disabled="true" :open="false"}\nGo\n::\n')
    expect((await parse(markdown))[0]![1]).toEqual({ ':disabled': 'true', ':open': 'false' })
  })

  it('round-trips boolean props written as MDC and as YAML', async () => {
    for (const source of ['::u-button{disabled}\nGo\n::\n', '::u-button\n---\nopen: false\nlabel: Go\n---\n::\n']) {
      const tree = await parse(source)

      expect(await parse(render(structuredClone(tree)))).toEqual(tree)
    }
  })

  it('writes slots with the `#name` shorthand', async () => {
    const markdown = render(await parse('::hero\n#title\nShip it\n::\n'))

    expect(markdown).toBe('::hero\n#title\nShip it\n::\n')
  })
})

describe('content stringify: markdown minimark 0.2 loses', () => {
  // Each one used to come back as a different tree: an HTML table whose rows
  // turned into a code block, a list renumbered from 1 with its nested list
  // escaping it, inline code losing its highlighting hint.
  it.each([
    ['a table', '| Prop | Type |\n| --- | --- |\n| `size` | `string` |\n'],
    ['inline code with a language', 'Use `string[]`{lang="ts-type"} here.\n'],
    ['bold text around inline code', '**Set `prose`** first.\n'],
    ['two line breaks', 'One<br><br>Two\n']
  ])('round-trips %s', async (_name, markdown) => {
    const tree = await parse(markdown)

    expect(await parse(render(structuredClone(tree)))).toEqual(tree)
  })

  it('keeps the language of highlighted inline code but not the highlighter\'s classes', () => {
    const markdown = render([['p', {}, ['code', { className: ['language-ts-type', 'shiki', 'shiki-themes', 'material-theme'], language: 'ts-type', style: '' }, 'string[]']]])

    expect(markdown).toBe('`string[]`{lang="ts-type"}\n')
  })

  it('keeps an ordered list\'s start and nests a list under its marker', async () => {
    const markdown = render(await parse('3. Step\n   - detail\n4. Next\n'))

    expect(markdown).toBe('3. Step\n   - detail\n4. Next\n')
  })

  it('writes a code block under its list item, not on the item\'s line', async () => {
    const markdown = render(await parse('1. Install the module:\n\n   ```bash\n   npm i x\n   ```\n\n2. Configure it.\n'))

    expect(markdown).toBe('1. Install the module:\n\n   ```bash\n   npm i x\n   ```\n2. Configure it.\n')
  })

  it('indents an item\'s blocks under a two-digit marker', async () => {
    const markdown = render(await parse('9. Nine\n10. Ten\n\n    ```bash\n    npm i x\n    ```\n'))

    expect(markdown).toBe('9. Nine\n10. Ten\n\n    ```bash\n    npm i x\n    ```\n')
  })

  it.each([
    ['a code block in an ordered item', '1. Install the module:\n\n   ```bash\n   npm i x\n   ```\n\n2. Configure it.\n'],
    ['a code block in a tight item', '- Run:\n  ```bash\n  npm i x\n  ```\n- Done\n'],
    ['code holding a list in a renumbered item', '3. Three\n\n   ```md\n   1. inside code\n   2. second\n   ```\n\n4. Four\n'],
    ['a table in an item', '- item\n\n  | a | b |\n  | - | - |\n  | 1 | 2 |\n\n- next\n'],
    ['a heading in an item', '- item\n\n  ### Heading in item\n\n- next\n'],
    ['a blockquote in an item', '- a\n\n  > quoted\n\n- b\n'],
    ['a list in a blockquote in an item', '- a\n\n  > - quoted\n  > - list\n\n- b\n'],
    ['two paragraphs in an item', '- one\n\n  two\n\n- next\n'],
    ['a block component in an item', '- item\n\n  ::note\n  Inside\n  ::\n\n- next\n'],
    ['a code block in a task item', '- [x] Done:\n\n  ```bash\n  npm i x\n  ```\n\n- [ ] Todo\n'],
    ['three levels of lists', '1. a\n   - b\n     1. c\n\n        ```ts\n        x\n        ```\n   - d\n2. e\n']
  ])('round-trips %s', async (_name, markdown) => {
    const tree = await parse(markdown)

    expect(await parse(render(structuredClone(tree)))).toEqual(tree)
  })

  it('leaves a table with a block in a cell to minimark', async () => {
    // GFM cells hold inline content only.
    const markdown = render(await parse('<table><tr><td>\n\n- item\n\n</td></tr></table>\n'))

    expect(markdown).toContain('<table>')
    expect(markdown).toContain('item')
  })
})

describe('content stringify: markdown/html', () => {
  it('writes no MDC attribute syntax', () => {
    const nodes: DocNode[] = [['p', {}, ['code', { language: 'ts-type' }, 'string[]'], ' ', ['img', { src: '/a.png', alt: 'A', height: 150 }]]]
    const markdown = stringify({ type: 'minimark', value: nodes }, { format: 'markdown/html', handlers: minimarkHandlers(nodes, 'markdown/html') })

    expect(markdown).toBe('`string[]` ![A](/a.png)\n')
  })
})

describe('content stringify: lead', () => {
  it('renders a numeric title and description instead of throwing', () => {
    const nodes: DocNode[] = [['p', {}, 'Body']]
    prepareDocumentTree(nodes, { title: 404, description: 3.5, siteUrl: 'https://example.com' })

    expect(render(nodes)).toBe('# 404\n\n> 3.5\n\nBody\n')
  })
})

describe('content stringify: round trip', () => {
  it('parses back to the tree it was written from', async () => {
    const tree = await parse(fixture)

    expect(await parse(render(structuredClone(tree)))).toEqual(tree)
  })
})
