import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { tryResolveModule } from '@nuxt/kit'
import { minimarkHandlers } from '../../src/runtime/server/sources/minimark'
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

  it('writes slots with the `#name` shorthand', async () => {
    const markdown = render(await parse('::hero\n#title\nShip it\n::\n'))

    expect(markdown).toBe('::hero\n#title\nShip it\n::\n')
  })
})

describe('content stringify: round trip', () => {
  it('parses back to the tree it was written from', async () => {
    const tree = await parse(fixture)

    expect(await parse(render(structuredClone(tree)))).toEqual(tree)
  })
})
