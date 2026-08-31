import { describe, it, expect } from 'vitest'
import { MCP_EXCLUDED_GROUPS, mcpExcludedGroups } from '../../src/runtime/shared/defaults'

// The build merges `MCP_EXCLUDED_GROUPS` into `runtimeConfig`, and
// `NUXT_AGENT_DISCOVERY_MCP_EXCLUDE_GROUPS` replaces that array wholesale. The
// card route applies the defaults again so a deploy setting its own list does
// not start publishing the admin tools.
describe('mcpExcludedGroups', () => {
  it('excludes the defaults with nothing configured', () => {
    expect(mcpExcludedGroups()).toEqual(new Set(MCP_EXCLUDED_GROUPS))
    expect(mcpExcludedGroups([])).toEqual(new Set(MCP_EXCLUDED_GROUPS))
  })

  it('keeps `admin` when the configured list drops it', () => {
    expect(mcpExcludedGroups(['internal'])).toEqual(new Set(['admin', 'internal']))
  })

  it('adds to the defaults rather than repeating them', () => {
    expect(mcpExcludedGroups(['admin', 'internal'])).toEqual(new Set(['admin', 'internal']))
  })

  it('returns a set of its own, so a caller cannot edit the defaults', () => {
    mcpExcludedGroups().add('internal')

    expect(MCP_EXCLUDED_GROUPS).toEqual(['admin'])
    expect(mcpExcludedGroups().has('internal')).toBe(false)
  })
})
