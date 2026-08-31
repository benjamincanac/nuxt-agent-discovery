import { describe, expect, it } from 'vitest'
import { prepareDocumentTree } from '../../src/runtime/server/sources/pipeline'
import type { DocNode } from '../../src/runtime/server/sources/pipeline'

describe('prepareDocumentTree: related links', () => {
  it('skips malformed entries instead of throwing', () => {
    // Frontmatter is user content, so `links: [null]` and half-filled entries
    // have to be survivable.
    const nodes: DocNode[] = [['h1', {}, 'Title']]
    prepareDocumentTree(nodes, {
      title: 'Title',
      links: [null, 42, 'x', { label: 'No target' }, { to: '/only-target' }, { label: '', to: '/empty' }, { label: 'Docs', to: '/docs' }],
      siteUrl: 'https://example.com'
    })

    const list = nodes.find(node => node[0] === 'ul')
    expect(list).toBeDefined()
    expect(list!.slice(2)).toHaveLength(1)
  })

  it('renders a numeric label as text', () => {
    // YAML reads `label: 2024` as a number, and both adapters rendered it
    // before the malformed-entry guard landed.
    const nodes: DocNode[] = [['h1', {}, 'Title']]
    prepareDocumentTree(nodes, {
      title: 'Title',
      links: [{ label: 2024, to: '/releases/2024' }],
      siteUrl: 'https://example.com'
    })

    const list = nodes.find(node => node[0] === 'ul')
    expect(list).toBeDefined()
    expect(list!.slice(2)).toEqual([['li', {}, ['a', { href: 'https://example.com/releases/2024' }, '2024']]])
  })

  it('appends nothing when no entry survives', () => {
    const nodes: DocNode[] = [['h1', {}, 'Title']]
    prepareDocumentTree(nodes, { title: 'Title', links: [null], siteUrl: 'https://example.com' })

    expect(nodes.some(node => node[0] === 'ul' || node[0] === 'hr')).toBe(false)
  })
})
