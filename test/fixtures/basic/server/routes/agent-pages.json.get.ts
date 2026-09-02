import { getAgentDocument, listAgentPages } from '#agent-discovery'

/**
 * The options neither built-in caller passes: `sitemap.md` lists every page
 * unfiltered and the raw route always asks for whole documents. An MCP tool is
 * what reaches for `search`, `prefix` and `sections`, so they only get
 * exercised from outside the module.
 */
export default defineEventHandler(async (event) => {
  const sectioned = await getAgentDocument(event, '/docs/components/badge', { sections: ['Usage'] })
  const missing = await getAgentDocument(event, '/docs/components/badge', { sections: ['Nowhere'] })
  // `/` through the helper, compared byte for byte against the raw route.
  const index = await getAgentDocument(event, '/')

  return {
    all: (await listAgentPages(event)).map(page => page.route),
    prefixed: (await listAgentPages(event, { prefix: '/docs/components/' })).map(page => page.route),
    // Both terms appear on the button page and neither pair appears anywhere
    // else, so this fails the moment matching goes back to "any term".
    everyTerm: (await listAgentPages(event, { search: 'button nested' })).map(page => page.route),
    oneTermMisses: (await listAgentPages(event, { search: 'button nowhere' })).map(page => page.route),
    combined: (await listAgentPages(event, { prefix: '/docs/', search: 'badge' })).map(page => page.route),
    entry: (await listAgentPages(event, { search: 'badge' }))[0],
    sectioned: sectioned && 'markdown' in sectioned ? sectioned.markdown : null,
    unmatchedSections: missing && 'markdown' in missing ? missing.markdown : null,
    index: index && 'markdown' in index ? index.markdown : null
  }
})
