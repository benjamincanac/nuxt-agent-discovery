import { describe, expect, it } from 'vitest'
import { extractSections } from '../../src/runtime/shared/sections'
import { GETTING_STARTED_MARKDOWN } from '../e2e/expected'

const NO_DESCRIPTION = `# Title

## Usage

Use it.

## Theme

Style it.
`

describe('extractSections', () => {
  it('keeps the frontmatter, title and description alongside the section asked for', () => {
    const extracted = extractSections(GETTING_STARTED_MARKDOWN, ['Usage'])

    expect(extracted).toContain('title: "Getting Started"')
    expect(extracted).toContain('# Getting Started')
    expect(extracted).toContain('> How to get started with the fixture.')
    expect(extracted).toContain('## Usage')
    expect(extracted).not.toContain('## Installation')
  })

  it('matches a heading whatever case it was asked for in', () => {
    expect(extractSections(GETTING_STARTED_MARKDOWN, ['  uSaGe '])).toContain('## Usage')
  })

  it('returns several sections in the order the document has them', () => {
    const extracted = extractSections(GETTING_STARTED_MARKDOWN, ['Usage', 'Installation'])

    expect(extracted.indexOf('## Installation')).toBeLessThan(extracted.indexOf('## Usage'))
  })

  it('falls back to the whole document when no section matched', () => {
    // The alternative is handing back a title and nothing else, which just
    // makes the agent fetch the page again without the argument.
    expect(extractSections(GETTING_STARTED_MARKDOWN, ['Nonexistent'])).toBe(GETTING_STARTED_MARKDOWN)
  })

  it('returns the whole document when nothing was asked for', () => {
    expect(extractSections(GETTING_STARTED_MARKDOWN, [])).toBe(GETTING_STARTED_MARKDOWN)
  })

  it('bounds the header at the first heading when a page has no description', () => {
    // Without the bound the header scan runs to the end of the document and
    // the matched section is then appended to a copy of the whole page.
    const extracted = extractSections(NO_DESCRIPTION, ['Theme'])

    expect(extracted).toContain('# Title')
    expect(extracted).toContain('## Theme')
    expect(extracted).not.toContain('## Usage')
    expect(extracted).not.toContain('Use it.')
  })

  it('does not mistake a YAML block scalar for the description', () => {
    // `>` opens a folded scalar in YAML, so a frontmatter block carrying one
    // would end the header scan before the title if it were scanned as prose.
    const withScalar = `---
description: >
  A folded value.
---
# Title

> The real description.

## Usage

Use it.
`
    const extracted = extractSections(withScalar, ['Usage'])

    expect(extracted).toContain('# Title')
    expect(extracted).toContain('> The real description.')
    expect(extracted).toContain('## Usage')
  })

  it('leaves a heading deeper than h2 inside its section', () => {
    const nested = `# Title

> Description.

## Usage

### Details

Deep.

## Theme

Styled.
`
    const extracted = extractSections(nested, ['Usage'])

    expect(extracted).toContain('### Details')
    expect(extracted).toContain('Deep.')
    expect(extracted).not.toContain('Styled.')
  })

  it('does not end a section on a heading inside a fence', () => {
    const doc = ['## Headings', 'intro', '```mdc', '## Not a heading', '```', 'after', '## Next'].join('\n')
    const extracted = extractSections(doc, ['Headings'])

    expect(extracted).toContain('## Not a heading')
    expect(extracted).toContain('after')
    expect(extracted).not.toContain('## Next')
  })

  it('does not close a fence on a nested fence line carrying an info string', () => {
    // A closing fence has no info string, so ` ```js ` inside a ` ```mdc `
    // block is content and the heading after it is still fenced.
    const doc = ['## Headings', '```mdc', '```js', '## Not a heading', '```', 'after', '## Next'].join('\n')
    const extracted = extractSections(doc, ['Headings'])

    expect(extracted).toContain('## Not a heading')
    expect(extracted).toContain('after')
    expect(extracted).not.toContain('## Next')
  })
})
