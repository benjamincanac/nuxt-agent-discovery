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

describe('prepareDocumentTree: links', () => {
  it('absolutizes site-relative links inside a JSON prop', () => {
    // `@nuxt/content` stores an array or object prop as a `:`-prefixed JSON
    // string, so a `to` inside it is not a prop of its own.
    const links = [{ label: 'Start', to: '/getting-started' }, { label: 'GitHub', to: 'https://github.com/nuxt/ui' }]
    const nodes: DocNode[] = [['u-page-cta', { ':links': JSON.stringify(links), 'to': '/docs' }]]
    prepareDocumentTree(nodes, { siteUrl: 'https://example.com' })

    expect(nodes[0]![1]).toEqual({
      ':links': JSON.stringify([{ label: 'Start', to: 'https://example.com/getting-started' }, { label: 'GitHub', to: 'https://github.com/nuxt/ui' }]),
      'to': 'https://example.com/docs'
    })
  })

  it('leaves a `:` prop that is not JSON alone', () => {
    const nodes: DocNode[] = [['u-button', { ':disabled': 'true', ':label': '[not json' }]]
    prepareDocumentTree(nodes, { siteUrl: 'https://example.com' })

    expect(nodes[0]![1]).toEqual({ ':disabled': 'true', ':label': '[not json' })
  })
})
