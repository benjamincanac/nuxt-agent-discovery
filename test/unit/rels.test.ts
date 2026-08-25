import { describe, it, expect } from 'vitest'
import { isValidRel } from '../../src/rels'

describe('isValidRel', () => {
  it('accepts registered relations', () => {
    expect(isValidRel('describedby')).toBe(true)
    expect(isValidRel('service-desc')).toBe(true)
    expect(isValidRel('service-doc')).toBe(true)
    expect(isValidRel('api-catalog')).toBe(true)
    expect(isValidRel('alternate')).toBe(true)
  })

  it('accepts sitemap, unregistered but universally understood', () => {
    expect(isValidRel('sitemap')).toBe(true)
  })

  it('rejects invented relations', () => {
    expect(isValidRel('llms')).toBe(false)
    expect(isValidRel('llms-full')).toBe(false)
    expect(isValidRel('mcp')).toBe(false)
    expect(isValidRel('design')).toBe(false)
  })

  it('accepts an extension relation as an absolute URI', () => {
    expect(isValidRel('https://example.com/rel/foo')).toBe(true)
    expect(isValidRel('urn:example:rel:foo')).toBe(true)
  })

  it('rejects a relative URI', () => {
    expect(isValidRel('/rel/foo')).toBe(false)
  })
})
